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
import { firestoreGetDoc } from './firestore.service';

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
export async function getSpreadsheetId(
  env: Env,
  email: string
): Promise<string> {
  const userDoc = await firestoreGetDoc(env, `usuarios_autorizados/${email}`);
  const existingId = userDoc?.['spreadsheet_id'] as string | undefined;

  if (existingId) return existingId;

  throw new Error('No spreadsheet_id found for user. Please login through the Frontend to initialize the Google Sheet.');
}

// ─── Write ─────────────────────────────────────────────────────────────────

/**
 * Inserts one or more cotizacion rows at row 2 (immediately below header)
 * so that the most recent cotizaciones are always at the top of the spreadsheet.
 *
 * @param email Abogado's email
 * @param rows  One or more rows to insert
 * @returns The spreadsheet ID
 */
export async function appendCotizaciones(
  env: Env,
  email: string,
  rows: CotizacionRow[]
): Promise<string> {
  const spreadsheetId = await getSpreadsheetId(env, email);
  const token = await getToken(env);

  const values = rows.map((r) => [
    r.fecha,
    r.referenciaInterna,
    r.tipoActo,
    r.moneda,
    r.cantidadBienes,
    r.costoNotarial,
    r.costoRegistral,
    r.totalPagar,
  ]);

  // 1. Insert empty rows at Row 2 (startIndex: 1) using batchUpdate
  const batchRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: 0,
              dimension: 'ROWS',
              startIndex: 1,
              endIndex: 1 + rows.length,
            },
            inheritFromBefore: false,
          },
        },
      ],
    }),
  });

  if (!batchRes.ok) {
    // Fallback: standard append to end of sheet if batchUpdate fails
    const appendUrl = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const appendRes = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    if (!appendRes.ok) {
      const err = await appendRes.text();
      throw new Error(`Sheets: append failed (${appendRes.status}): ${err}`);
    }
  } else {
    // 2. Populate newly inserted rows starting at Row 2
    const updateUrl = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A2:H${1 + rows.length}?valueInputOption=USER_ENTERED`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`Sheets: update failed (${updateRes.status}): ${err}`);
    }
  }

  return spreadsheetId;
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
    cantidadBienes:  Number(r[4] ?? 1),
    costoNotarial:      Number(r[5] ?? 0),
    costoRegistral:     Number(r[6] ?? 0),
    totalPagar:         Number(r[7] ?? 0),
  }));

  return { data, hasMore };
}
