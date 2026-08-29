// ====================================================
// Servicio: Operaciones con Google Sheets API v4
// Usa la Service Account en vez del token OAuth del usuario
// — sin expiración de 1 hora
// ====================================================

import { getServiceAccountToken } from './google-auth';
import { CotizacionSheet, Env } from '../types';

// El título del sheet incluye el email del usuario para que la búsqueda en Drive
// sea siempre específica a ese usuario (previene IDOR/BOLA).
function sheetTitle(userEmail: string): string {
  return `Cotizaciones Notariales - ${userEmail}`;
}

// -------------------------------------------------------
// Helpers internos
// -------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function appendRowValues(
  spreadsheetId: string,
  token: string,
  values: (string | number)[]
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append error: ${err}`);
  }
}

// -------------------------------------------------------
// Obtener o crear el Spreadsheet del abogado
// El ID se cachea en Cloudflare KV para no buscar en Drive cada vez
// -------------------------------------------------------
async function getOrCreateSpreadsheet(
  userEmail: string,
  env: Env
): Promise<string> {
  // 1. Buscar en KV (caché permanente — el spreadsheetId no cambia)
  const cached = await env.SHEETS_KV.get(`sheet:${userEmail}`);
  if (cached) return cached;

  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const headers = authHeaders(token);

  // El título es único por usuario — la búsqueda en Drive siempre retorna el sheet correcto
  const title = sheetTitle(userEmail);

  // 2. Buscar en Google Drive por nombre único del usuario (seguro contra IDOR)
  const q = `name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`;
  const searchRes = await fetch(searchUrl, { headers });
  const searchData = await searchRes.json() as { files?: { id: string }[] };

  if (searchData.files && searchData.files.length > 0) {
    const spreadsheetId = searchData.files[0].id;
    await shareWithUser(spreadsheetId, userEmail, token);
    await env.SHEETS_KV.put(`sheet:${userEmail}`, spreadsheetId);
    return spreadsheetId;
  }

  // 3. Crear el spreadsheet con título único
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties: { title } }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Error creando spreadsheet: ${err}`);
  }

  const createData = await createRes.json() as { spreadsheetId: string };
  const spreadsheetId = createData.spreadsheetId;

  // 4. Compartir con el abogado (como editor — puede verlo en su Drive)
  await shareWithUser(spreadsheetId, userEmail, token);

  // 5. Insertar fila de cabeceras
  await appendRowValues(spreadsheetId, token, [
    'Fecha',
    'Referencia Interna',
    'Tipo de Acto',
    'Moneda',
    'Cantidad Inmuebles',
    'Costo Notarial',
    'Costo Registral',
    'Total a Pagar',
    'Notaría',
  ]);

  // 6. Cachear el ID en KV (sin expiración — el archivo no cambia)
  await env.SHEETS_KV.put(`sheet:${userEmail}`, spreadsheetId);

  return spreadsheetId;
}

async function shareWithUser(
  spreadsheetId: string,
  email: string,
  token: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`;
  await fetch(url, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      type: 'user',
      role: 'writer',
      emailAddress: email,
      sendNotificationEmail: false,
    }),
  });
  // No tiramos error si falla (puede ser un permiso duplicado)
}

// -------------------------------------------------------
// API Pública
// -------------------------------------------------------

/**
 * Guarda una cotización en el Google Sheet del abogado.
 * Crea el Sheet automáticamente si no existe.
 */
export async function saveCotizacion(
  data: CotizacionSheet,
  userEmail: string,
  env: Env
): Promise<void> {
  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const spreadsheetId = await getOrCreateSpreadsheet(userEmail, env);

  await appendRowValues(spreadsheetId, token, [
    data.fecha,
    data.referenciaInterna,
    data.tipoActo,
    data.moneda,
    data.cantidadInmuebles,
    data.costoNotarial,
    data.costoRegistral,
    data.totalPagar,
    data.notaria || '',
  ]);
}

/**
 * Obtiene el historial de cotizaciones del abogado con paginación inversa.
 * Retorna los más recientes primero.
 */
export async function getHistorial(
  userEmail: string,
  limit: number,
  offset: number,
  env: Env
): Promise<{ data: CotizacionSheet[]; hasMore: boolean }> {
  // Si no hay spreadsheet en KV, no hay historial todavía
  const spreadsheetId = await env.SHEETS_KV.get(`sheet:${userEmail}`);
  if (!spreadsheetId) {
    return { data: [], hasMore: false };
  }

  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const headers = authHeaders(token);

  // 1. Contar filas totales (leyendo solo columna A — más eficiente)
  const countUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`;
  const countRes = await fetch(countUrl, { headers });
  const countData = await countRes.json() as { values?: string[][] };
  const totalRows = (countData.values || []).length;

  // La fila 1 es la cabecera, necesitamos al menos fila 2
  if (totalRows <= 1) {
    return { data: [], hasMore: false };
  }

  // 2. Calcular rango de paginación inversa (más recientes primero)
  let endRow = totalRows - offset;
  if (endRow < 2) return { data: [], hasMore: false };

  let startRow = endRow - limit + 1;
  if (startRow < 2) startRow = 2;

  const hasMore = startRow > 2;

  // 3. Leer el rango calculado
  const rangeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A${startRow}:I${endRow}`;
  const rangeRes = await fetch(rangeUrl, { headers });
  const rangeData = await rangeRes.json() as { values?: string[][] };
  const rows = rangeData.values || [];

  // 4. Parsear y revertir (más reciente arriba)
  const data: CotizacionSheet[] = rows.reverse().map((row) => ({
    fecha: row[0] || '',
    referenciaInterna: row[1] || '',
    tipoActo: row[2] || '',
    moneda: row[3] || '',
    cantidadInmuebles: parseInt(row[4]) || 0,
    costoNotarial: parseFloat(row[5]) || 0,
    costoRegistral: parseFloat(row[6]) || 0,
    totalPagar: parseFloat(row[7]) || 0,
    notaria: row[8] || '',
  }));

  return { data, hasMore };
}
