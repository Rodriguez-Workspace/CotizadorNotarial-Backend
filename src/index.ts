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

  // Paso 4: Firebase JWK fetch (el mismo endpoint que usa authMiddleware)
  try {
    const jwkUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
    const t0 = Date.now();
    const jwkRes = await fetch(jwkUrl);
    steps['4_jwk_fetch_ms']    = String(Date.now() - t0);
    steps['4_jwk_fetch_status'] = String(jwkRes.status);
    if (jwkRes.ok) {
      const data = await jwkRes.json() as { keys: unknown[] };
      steps['4_jwk_key_count'] = String(data.keys?.length ?? 0);
    } else {
      steps['4_jwk_body'] = (await jwkRes.text()).slice(0, 200);
    }
  } catch (e: unknown) {
    steps['4_jwk_fetch'] = `ERROR: ${(e as Error).message ?? String(e)}`;
  }

  // Paso 5: usuarios_autorizados collection (el que usa authMiddleware)
  try {
    const url5 = `https://firestore.googleapis.com/v1/projects/${c.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/usuarios_autorizados?pageSize=1`;
    const res5 = await fetch(url5, { headers: { Authorization: `Bearer ${saToken}` } });
    steps['5_usuarios_status'] = String(res5.status);
    if (!res5.ok) {
      steps['5_usuarios_body'] = (await res5.text()).slice(0, 300);
    } else {
      steps['5_usuarios'] = 'ok';
    }
  } catch (e: unknown) {
    steps['5_usuarios'] = `ERROR: ${(e as Error).message ?? String(e)}`;
  }

  // Paso 6: Firestore — documento exacto que usa tarifario.route.ts
  try {
    const url6 = `https://firestore.googleapis.com/v1/projects/${c.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/notarias/notaria_cruzado`;
    const res6 = await fetch(url6, { headers: { Authorization: `Bearer ${saToken}` } });
    steps['6_notaria_cruzado_status'] = String(res6.status);
    if (res6.ok) {
      const body6 = await res6.json() as { fields?: Record<string, unknown> };
      steps['6_notaria_cruzado'] = body6.fields ? 'ok (tiene fields)' : 'ok (sin fields!)';
    } else {
      steps['6_notaria_cruzado_body'] = (await res6.text()).slice(0, 200);
    }
  } catch (e: unknown) {
    steps['6_notaria_cruzado'] = `ERROR: ${(e as Error).message ?? String(e)}`;
  }

  // Paso 7: Firestore — documento exacto que usa variables.route.ts
  try {
    const url7 = `https://firestore.googleapis.com/v1/projects/${c.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/variables_globales/valores_actuales`;
    const res7 = await fetch(url7, { headers: { Authorization: `Bearer ${saToken}` } });
    steps['7_variables_globales_status'] = String(res7.status);
    if (res7.ok) {
      const body7 = await res7.json() as { fields?: Record<string, unknown> };
      steps['7_variables_globales'] = body7.fields ? 'ok (tiene fields)' : 'ok (sin fields!)';
    } else {
      steps['7_variables_globales_body'] = (await res7.text()).slice(0, 200);
    }
  } catch (e: unknown) {
    steps['7_variables_globales'] = `ERROR: ${(e as Error).message ?? String(e)}`;
  }

  return c.json({ ok: true, steps });
});

app.get('/diagnose-sheets', async (c) => {
  const steps: Record<string, string> = {};
  try {
    steps['1_msg'] = 'Testing Google Drive and Sheets API permissions';
    
    // Test 1: Generate Token
    const { getServiceAccountToken, GOOGLE_SCOPES } = await import('./utils/jwt.utils');
    const token = await getServiceAccountToken(c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_SCOPES);
    steps['2_token'] = `ok, generated`;

    // Test 2: Try creating via Drive API
    const driveRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TEST_DRIVE_API', mimeType: 'application/vnd.google-apps.spreadsheet' })
    });
    
    if (!driveRes.ok) {
      steps['3_drive_api_fail'] = await driveRes.text();
    } else {
      const driveData = await driveRes.json() as any;
      steps['3_drive_api_success'] = `Created ID: ${driveData.id}`;
    }

    // Test 3: Try creating via Sheets API
    const { createSpreadsheet } = await import('./services/drive.service');
    try {
      const newId = await createSpreadsheet(c.env, 'TEST_SHEETS_API');
      steps['4_sheets_api_success'] = `Created ID: ${newId}`;
    } catch (e: any) {
      steps['4_sheets_api_fail'] = String(e.message);
    }
    
    return c.json({ ok: true, steps });
  } catch (e: any) {
    steps['error'] = e.message ?? String(e);
    return c.json({ ok: false, steps });
  }
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
