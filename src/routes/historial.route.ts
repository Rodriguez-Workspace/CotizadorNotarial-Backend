/**
 * historial.route.ts  —  GET /api/historial
 *
 * Returns paginated cotizacion history from the abogado's Google Sheet.
 *
 * Query parameters:
 *   limit  (default: 100)  — rows per page
 *   offset (default: 0)    — zero-based row offset
 *
 * Response:
 * {
 *   data: CotizacionRow[],
 *   hasMore: boolean
 * }
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getHistorial } from '../services/sheets.service';

const historial = new Hono<{ Bindings: Env; Variables: Variables }>();

historial.get('/', async (c) => {
  const email  = c.get('userEmail');
  const limit  = Math.min(Number(c.req.query('limit')  ?? 100), 500); // max 500
  const offset = Math.max(Number(c.req.query('offset') ?? 0),   0);

  const result = await getHistorial(c.env, email, limit, offset);

  return c.json(result);
});

export default historial;
