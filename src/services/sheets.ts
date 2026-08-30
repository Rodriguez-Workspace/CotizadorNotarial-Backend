import { getServiceAccountToken } from './google-auth';
import { CotizacionSheet, Env } from '../types';

const FILE_NAME = 'Cotizaciones Notariales';

async function getOrCreateSpreadsheet(
  userEmail: string,
  env: Env
): Promise<string> {
  const cached = await env.SHEETS_KV.get(`sheet:${userEmail}`);
  if (cached) return cached;

  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    { headers }
  );
  const searchData: any = await searchRes.json();

  if (searchData.files?.length > 0) {
    const spreadsheetId = searchData.files[0].id;
    await env.SHEETS_KV.put(`sheet:${userEmail}`, spreadsheetId);
    return spreadsheetId;
  }

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers,
    body: JSON.stringify({ properties: { title: FILE_NAME } }),
  });
  const createData: any = await createRes.json();
  const spreadsheetId = createData.spreadsheetId;

  await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'user',
      role: 'writer',
      emailAddress: userEmail,
    }),
  });

  await appendRowValues(spreadsheetId, token, [
    'Fecha', 'Referencia Interna', 'Tipo de Acto', 'Moneda',
    'Cantidad Inmuebles', 'Costo Notarial', 'Costo Registral', 'Total a Pagar', 'Notaría'
  ]);

  await env.SHEETS_KV.put(`sheet:${userEmail}`, spreadsheetId);
  return spreadsheetId;
}

async function appendRowValues(spreadsheetId: string, token: string, values: any[]) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error appendRowValues: ${res.status} ${errorText}`);
  }
}

export async function saveCotizacion(
  data: CotizacionSheet,
  userEmail: string,
  env: Env
): Promise<void> {
  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const spreadsheetId = await getOrCreateSpreadsheet(userEmail, env);
  
  await appendRowValues(spreadsheetId, token, [
    data.fecha, data.referenciaInterna, data.tipoActo, data.moneda,
    data.cantidadInmuebles.toString(), data.costoNotarial.toString(), data.costoRegistral.toString(),
    data.totalPagar.toString(), data.notaria || ''
  ]);
}

export async function getHistorial(
  userEmail: string,
  limit: number,
  offset: number,
  env: Env
): Promise<{ data: CotizacionSheet[]; hasMore: boolean }> {
  const spreadsheetId = await env.SHEETS_KV.get(`sheet:${userEmail}`);
  if (!spreadsheetId) return { data: [], hasMore: false };

  const token = await getServiceAccountToken(env.GOOGLE_SERVICE_ACCOUNT);
  const headers = { 'Authorization': `Bearer ${token}` };

  const countRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`,
    { headers }
  );
  
  if (!countRes.ok) {
    if (countRes.status === 404) {
      return { data: [], hasMore: false };
    }
    throw new Error(`Error contando historial: ${countRes.status}`);
  }

  const countData: any = await countRes.json();
  const totalRows = (countData.values || []).length;
  if (totalRows <= 1) return { data: [], hasMore: false };

  let endRow = totalRows - offset;
  if (endRow < 2) return { data: [], hasMore: false };
  let startRow = endRow - limit + 1;
  if (startRow < 2) startRow = 2;
  const hasMore = startRow > 2;

  const rangeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A${startRow}:I${endRow}`,
    { headers }
  );
  const rangeData: any = await rangeRes.json();
  const rows = rangeData.values || [];

  const data: CotizacionSheet[] = rows.reverse().map((row: any[]) => ({
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
