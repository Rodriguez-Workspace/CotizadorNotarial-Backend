/**
 * index.ts — Cloudflare Worker entry point
 *
 * Hono app with:
 *  - CORS (origin restricted to the Cloudflare Pages frontend)
 *  - Auth middleware on all /api/* routes
 *  - Route registration for tenant, tarifario, variables, cotizacion, historial
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth.middleware';
import tenantRoute    from './routes/tenant.route';
import tarifarioRoute from './routes/tarifario.route';
import variablesRoute from './routes/variables.route';
import cotizacionRoute from './routes/cotizacion.route';
import historialRoute  from './routes/historial.route';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── CORS ──────────────────────────────────────────────────────────────────
// Allow requests only from the Cloudflare Pages frontend URL.
// CORS_ORIGIN is set as a plain variable in the Cloudflare dashboard.
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });
  return corsMiddleware(c, next);
});

// ─── Health check (public) ────────────────────────────────────────────────
app.get('/', (c) =>
  c.json({ status: 'ok', service: 'cotizador-notarial-backend' })
);

// ─── Protected API routes ─────────────────────────────────────────────────
// All /api/* routes require a valid Firebase ID Token (Bearer header).
const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use('*', authMiddleware);

api.route('/tenant',    tenantRoute);
api.route('/tarifario', tarifarioRoute);
api.route('/variables', variablesRoute);
api.route('/cotizacion', cotizacionRoute);
api.route('/historial',  historialRoute);

app.route('/api', api);

// ─── 404 catch-all ────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ─── Global error handler ─────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker error]', err.message, err.stack);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
