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
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });
  return corsMiddleware(c, next);
});

// ─── Health check (public) ────────────────────────────────────────────────
app.get('/', (c) => {
  // Exposes which secrets are present — safe because values are not shown
  const secrets = {
    FIREBASE_PROJECT_ID:              !!c.env.FIREBASE_PROJECT_ID,
    GOOGLE_SERVICE_ACCOUNT_EMAIL:     !!c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    CORS_ORIGIN:                      !!c.env.CORS_ORIGIN,
  };
  const allPresent = Object.values(secrets).every(Boolean);
  return c.json({
    status: allPresent ? 'ok' : 'misconfigured',
    service: 'cotizador-notarial-backend',
    secrets,
  });
});

// ─── Protected API routes ─────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// Guard: fail fast if secrets are missing, instead of hanging 30s
api.use('*', async (c, next) => {
  const missing: string[] = [];
  if (!c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)     missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) missing.push('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (!c.env.FIREBASE_PROJECT_ID)              missing.push('FIREBASE_PROJECT_ID');

  if (missing.length > 0) {
    console.error('[Worker] Missing secrets:', missing.join(', '));
    return c.json({ error: `Worker misconfigured — missing secrets: ${missing.join(', ')}` }, 503);
  }
  return next();
});

api.use('*', authMiddleware);

api.route('/tenant',     tenantRoute);
api.route('/tarifario',  tarifarioRoute);
api.route('/variables',  variablesRoute);
api.route('/cotizacion', cotizacionRoute);
api.route('/historial',  historialRoute);

app.route('/api', api);

// ─── 404 catch-all ────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ─── Global error handler ─────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker error]', err.message, err.stack);
  return c.json({ error: 'Internal server error', detail: err.message }, 500);
});

export default app;
