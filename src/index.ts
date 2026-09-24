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

// ─── In-memory rate limit store ───────────────────────────────────────────
// Keyed by IP. Cleared on isolate recycle (every few minutes on Cloudflare).
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX   = 30;   // requests
const RATE_LIMIT_WINDOW = 60_000; // 1 minute in ms

// ─── CORS ──────────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN;
  if (!origin) {
    console.error('[Worker] CORS_ORIGIN secret is not configured');
    return c.json({ error: 'Worker misconfigured — CORS_ORIGIN not set' }, 503);
  }
  const corsMiddleware = cors({
    origin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });
  return corsMiddleware(c, next);
});

// ─── Security Headers ──────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
});

// ─── Rate Limiting (per IP) ────────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  const rawIp = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const ip = rawIp.split(',')[0].trim();
  const now = Date.now();

  // Prune expired entries if the store grows to prevent memory leaks in isolates
  if (rateLimitStore.size > 100) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now - v.windowStart > RATE_LIMIT_WINDOW) {
        rateLimitStore.delete(k);
      }
    }
  }

  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return c.json({ error: 'Too many requests — slow down' }, 429);
    }
  }
  return next();
});

// ─── Health check (public) ────────────────────────────────────────────────
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'cotizador-notarial-backend' });
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
  // Do not leak internal error details in production responses
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
