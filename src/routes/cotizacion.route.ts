/**
 * cotizacion.route.ts  —  POST /api/cotizacion
 *
 * Saves one or more cotizacion rows to the abogado's Google Sheet.
 * If the abogado doesn't have a sheet yet, one is created automatically.
 *
 * Request body:
 * {
 *   items: CotizacionRow[]   // One row for simple cotización, multiple for carrito
 * }
 *
 * Response:
 * { success: true, spreadsheetId: string }
 */

import { Hono } from 'hono';
import type { Env, Variables, CotizacionRow } from '../types';
import { firestoreGetDoc } from '../services/firestore.service';
import { appendCotizaciones, getOrCreateSpreadsheet } from '../services/sheets.service';

const cotizacion = new Hono<{ Bindings: Env; Variables: Variables }>();

cotizacion.post('/', async (c) => {
  const email     = c.get('userEmail');
  const notariaId = c.get('notariaId');

  // Parse and validate body
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'items must be a non-empty array' }, 400);
  }

  // Validate each row minimally
  const rows: CotizacionRow[] = (body.items as Record<string, unknown>[]).map((item) => ({
    fecha:             String(item['fecha']             ?? new Date().toISOString()),
    referenciaInterna: String(item['referenciaInterna'] ?? ''),
    tipoActo:          String(item['tipoActo']          ?? ''),
    moneda:            String(item['moneda']            ?? 'SOLES'),
    cantidadInmuebles: Number(item['cantidadInmuebles'] ?? 1),
    costoNotarial:     Number(item['costoNotarial']     ?? 0),
    costoRegistral:    Number(item['costoRegistral']    ?? 0),
    totalPagar:        Number(item['totalPagar']        ?? 0),
  }));

  // Get notaría name for the spreadsheet title
  const notariaDoc   = await firestoreGetDoc(c.env, `notarias/${notariaId}`);
  const perfil       = (notariaDoc?.['perfil'] ?? {}) as Record<string, unknown>;
  const notariaNombre = String(perfil['nombre_oficial'] ?? notariaId);

  // Append to (or create) the abogado's spreadsheet
  await appendCotizaciones(c.env, email, notariaNombre, rows);

  // Return the spreadsheetId so the frontend can show a direct link if desired
  const spreadsheetId = await getOrCreateSpreadsheet(c.env, email, notariaNombre);

  return c.json({ success: true, spreadsheetId });
});

export default cotizacion;
