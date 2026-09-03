/**
 * drive.service.ts
 *
 * Handles Google Drive operations for the "one Sheet per abogado" strategy:
 *
 * 1. Search if the abogado's spreadsheet already exists (by stored ID in Firestore)
 * 2. Create a new spreadsheet via Drive API if it doesn't exist
 * 3. Share the newly created spreadsheet with the abogado (editor permission)
 *
 * All operations use the Service Account. The Sheet lives in the SA's Drive
 * but is shared with the abogado so they can access it from "Shared with me".
 */

import type { Env } from '../types';
import { getServiceAccountToken, GOOGLE_SCOPES } from '../utils/jwt.utils';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3';

async function getToken(env: Env): Promise<string> {
  return getServiceAccountToken(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SCOPES
  );
}

/**
 * Creates a new Google Spreadsheet named after the abogado's notaría,
 * with the correct headers for the cotizaciones sheet.
 *
 * @returns The new spreadsheet's ID
 */
export async function createSpreadsheet(
  env: Env,
  notariaNombre: string
): Promise<string> {
  const token = await getToken(env);

  const body = {
    properties: { title: `Cotizaciones — ${notariaNombre}` },
    sheets: [
      {
        properties: { title: 'Cotizaciones', sheetId: 0 },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: [
                  'Fecha',
                  'Referencia Interna',
                  'Tipo de Acto',
                  'Moneda',
                  'Cantidad Inmuebles',
                  'Costo Notarial',
                  'Costo Registral',
                  'Total a Pagar',
                ].map((v) => ({ userEnteredValue: { stringValue: v } })),
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(SHEETS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive: createSpreadsheet failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { spreadsheetId: string };
  return data.spreadsheetId;
}

/**
 * Grants "writer" (editor) access to the abogado's email on a spreadsheet
 * owned by the Service Account. The abogado will see it in "Shared with me".
 */
export async function shareSpreadsheet(
  env: Env,
  spreadsheetId: string,
  abogadoEmail: string
): Promise<void> {
  const token = await getToken(env);

  const res = await fetch(
    `${DRIVE_API}/files/${spreadsheetId}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'user',
        role: 'writer',
        emailAddress: abogadoEmail,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    // Non-fatal: log but don't block the cotización save
    console.error(`Drive: shareSpreadsheet failed (${res.status}): ${err}`);
  }
}
