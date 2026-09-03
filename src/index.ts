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
  const secrets = {
    FIREBASE_PROJECT_ID:                !!c.env.FIREBASE_PROJECT_ID,
    GOOGLE_SERVICE_ACCOUNT_EMAIL:       !!c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    CORS_ORIGIN:                        !!c.env.CORS_ORIGIN,
  };
  const allPresent = Object.values(secrets).every(Boolean);
  return c.json({ status: allPresent ? 'ok' : 'misconfigured', service: 'cotizador-notarial-backend', secrets });
});

// ─── Diagnose (public, TEMPORAL) — prueba cada paso del SA token + Firestore ──
// Accede a: https://cotizador-notarial-backend.andres-dev.workers.dev/diagnose
app.get('/diagnose', async (c) => {
  const steps: Record<string, string> = {};

  // Paso 1: PEM key parse
  try {
    const pem    = c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '';
    const norm   = pem.replace(/\\n/g, '\n');
    const body   = norm
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    steps['1_pem_length']  = String(body.length);
    steps['1_pem_prefix']  = body.slice(0, 20);  // first 20 chars of base64

    const bin  = atob(body);
    const buf  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    steps['1_pem_bytes'] = String(buf.length);

    await crypto.subtle.importKey(
      'pkcs8', buf.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
    steps['1_import_key'] = 'ok';
  } catch (e: unknown) {
    steps['1_import_key'] = `ERROR: ${(e as Error).message ?? String(e)}`;
    return c.json({ ok: false, steps });
  }

  // Paso 2: SA token exchange
  let saToken = '';
  try {
    const { getServiceAccountToken, GOOGLE_SCOPES } = await import('./utils/jwt.utils');
    saToken = await getServiceAccountToken(
      c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      GOOGLE_SCOPES
    );
    steps['2_sa_token'] = saToken ? `ok (${saToken.slice(0, 20)}...)` : 'empty!';
  } catch (e: unknown) {
    steps['2_sa_token'] = `ERROR: ${(e as Error).message ?? String(e)}`;
    return c.json({ ok: false, steps });
  }

  // Paso 3: Firestore read (collection raíz)
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${c.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/notarias?pageSize=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${saToken}` } });
    steps['3_firestore_status'] = String(res.status);
    if (!res.ok) {
      steps['3_firestore_body'] = (await res.text()).slice(0, 300);
    } else {
      steps['3_firestore'] = 'ok';
    }
  } catch (e: unknown) {
    steps['3_firestore'] = `ERROR: ${(e as Error).message ?? String(e)}`;
  }

  return c.json({ ok: true, steps });
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
