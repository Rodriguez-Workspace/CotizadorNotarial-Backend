/**
 * sheets.service.ts
 *
 * Google Sheets API v4 operations for cotizaciones history.
 *
 * Strategy:
 *   - Each abogado has ONE spreadsheet, identified by `spreadsheet_id`
 *     stored in Firestore at `usuarios_autorizados/{email}.spreadsheet_id`.
 *   - If no spreadsheet exists yet, this service creates one via drive.service.ts,
 *     shares it with the abogado, and persists the ID to Firestore.
 *   - Subsequent calls reuse the stored ID — no Drive search needed.
 */

import type { Env, CotizacionRow } from '../types';
import { getServiceAccountToken, GOOGLE_SCOPES } from '../utils/jwt.utils';
import { firestoreGetDoc, firestoreUpdateDoc } from './firestore.service';
import { createSpreadsheet, shareSpreadsheet } from './drive.service';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_NAME  = 'Cotizaciones';

async function getToken(env: Env): Promise<string> {
  return getServiceAccountToken(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SCOPES
  );
}

// ─── Spreadsheet provisioning ──────────────────────────────────────────────

/**
 * Returns the spreadsheet ID for the given abogado.
 * If one doesn't exist yet, creates and shares it, then persists the ID.
 *
 * @param email         Abogado's email (used as Firestore document key)
 * @param notariaNombre Display name of the notaría (used in the Sheet title)
 */
export async function getOrCreateSpreadsheet(
  env: Env,
  email: string,
  notariaNombre: string
): Promise<string> {
  // 1. Check if the ID is already stored in Firestore
  const userDoc = await firestoreGetDoc(env, `usuarios_autorizados/${email}`);
  const existingId = userDoc?.['spreadsheet_id'] as string | undefined;

  if (existingId) return existingId;

  // 2. Create a new spreadsheet owned by the Service Account
  const newId = await createSpreadsheet(env, notariaNombre);

  // 3. Share it with the abogado (non-fatal if it fails)
  await shareSpreadsheet(env, newId, email);

  // 4. Persist the ID to Firestore for future requests
  await firestoreUpdateDoc(
    env,
    `usuarios_autorizados/${email}`,
    { spreadsheet_id: newId },
    ['spreadsheet_id']
  );

  return newId;
}

// ─── Write ─────────────────────────────────────────────────────────────────

/**
 * Appends one or more cotizacion rows to the abogado's spreadsheet.
 * If the Sheet doesn't exist yet, it is created automatically.
 *
 * @param email         Abogado's email
 * @param notariaNombre Notaría name (used only if creating a new Sheet)
 * @param rows          One or more rows to append
 */
export async function appendCotizaciones(
  env: Env,
  email: string,
  notariaNombre: string,
  rows: CotizacionRow[]
): Promise<void> {
  const spreadsheetId = await getOrCreateSpreadsheet(env, email, notariaNombre);
  const token = await getToken(env);

  const values = rows.map((r) => [
    r.fecha,
    r.referenciaInterna,
    r.tipoActo,
    r.moneda,
    r.cantidadInmuebles,
    r.costoNotarial,
    r.costoRegistral,
    r.totalPagar,
  ]);

  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets: append failed (${res.status}): ${err}`);
  }
}

// ─── Read (historial) ──────────────────────────────────────────────────────

export interface HistorialResult {
  data: CotizacionRow[];
  hasMore: boolean;
}

/**
 * Reads paginated rows from the abogado's spreadsheet.
 * Row 1 is the header — data starts from row 2.
 *
 * @param email   Abogado's email
 * @param limit   Max rows to return per page
 * @param offset  Zero-based row offset (0 = first data row)
 */
export async function getHistorial(
  env: Env,
  email: string,
  limit: number,
  offset: number
): Promise<HistorialResult> {
  const userDoc = await firestoreGetDoc(env, `usuarios_autorizados/${email}`);
  const spreadsheetId = userDoc?.['spreadsheet_id'] as string | undefined;

  // If no sheet exists yet, return empty
  if (!spreadsheetId) return { data: [], hasMore: false };

  const token = await getToken(env);

  // Rows are 1-indexed in Sheets; row 1 is the header; data starts at row 2
  const startRow = offset + 2;
  const endRow   = startRow + limit; // fetch one extra to detect hasMore
  const range    = `${SHEET_NAME}!A${startRow}:H${endRow}`;

  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets: getHistorial failed (${res.status}): ${err}`);
  }

  const body  = (await res.json()) as { values?: (string | number)[][] };
  const allRows = body.values ?? [];

  // The extra row signals there are more pages
  const hasMore = allRows.length > limit;
  const pageRows = allRows.slice(0, limit);

  const data: CotizacionRow[] = pageRows.map((r) => ({
    fecha:              String(r[0] ?? ''),
    referenciaInterna:  String(r[1] ?? ''),
    tipoActo:           String(r[2] ?? ''),
    moneda:             String(r[3] ?? 'SOLES'),
    cantidadInmuebles:  Number(r[4] ?? 1),
    costoNotarial:      Number(r[5] ?? 0),
    costoRegistral:     Number(r[6] ?? 0),
    totalPagar:         Number(r[7] ?? 0),
  }));

  return { data, hasMore };
}
