/**
 * drive.service.ts
 *
 * Handles Google Drive & Sheets operations for the "one Sheet per abogado" strategy:
 *
 * 1. Create a new spreadsheet via Google Sheets API v4 using the Service Account.
 * 2. Share the spreadsheet with the abogado (writer/editor permission) via Drive API v3
 *    so it appears automatically in "Compartidos conmigo" (Shared with me).
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
 * with the standard column headers for cotizaciones.
 *
 * @returns The new spreadsheet ID
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
                  'Cantidad Bienes',
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
 * owned by the Service Account. The abogado sees it in "Compartidos conmigo" (Shared with me).
 */
export async function shareSpreadsheet(
  env: Env,
  spreadsheetId: string,
  abogadoEmail: string
): Promise<void> {
  const token = await getToken(env);

  const res = await fetch(
    `${DRIVE_API}/files/${spreadsheetId}/permissions?sendNotificationEmail=false`,
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
    console.error(`Drive: shareSpreadsheet failed (${res.status}): ${err}`);
  }
}
