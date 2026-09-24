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
import { appendCotizaciones } from '../services/sheets.service';

const cotizacion = new Hono<{ Bindings: Env; Variables: Variables }>();

cotizacion.post('/', async (c) => {
  const email = c.get('userEmail');

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

  // Prevent resource exhaustion: limit batch size per request
  const MAX_ITEMS = 50;
  if (body.items.length > MAX_ITEMS) {
    return c.json({ error: `items array exceeds maximum allowed size of ${MAX_ITEMS}` }, 400);
  }

  // Validate each row minimally
  const rows: CotizacionRow[] = (body.items as Record<string, unknown>[]).map((item) => ({
    fecha:             String(item['fecha']             ?? new Date().toISOString()),
    referenciaInterna: String(item['referenciaInterna'] ?? ''),
    tipoActo:          String(item['tipoActo']          ?? ''),
    moneda:            String(item['moneda']            ?? 'SOLES'),
    cantidadBienes:    Number(item['cantidadBienes']    ?? 1),
    costoNotarial:     Number(item['costoNotarial']     ?? 0),
    costoRegistral:    Number(item['costoRegistral']    ?? 0),
    totalPagar:        Number(item['totalPagar']        ?? 0),
  }));

  // Insert rows at top of the abogado's spreadsheet and retrieve the spreadsheet ID
  const spreadsheetId = await appendCotizaciones(c.env, email, rows);

  return c.json({ success: true, spreadsheetId });
});

export default cotizacion;
