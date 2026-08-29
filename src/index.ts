// ====================================================
// Entry point del Cloudflare Worker
// Router principal con Hono
// ====================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, AuthenticatedUser, CotizacionSheet } from './types';
import { firebaseAuthMiddleware } from './middleware/firebase-auth';
import { saveCotizacion, getHistorial } from './services/sheets';

// Tipado del contexto de Hono con nuestras variables
type Variables = {
  user: AuthenticatedUser;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// -------------------------------------------------------
// Security Headers — previene Clickjacking, MIME sniffing, etc.
// -------------------------------------------------------
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP: solo permite requests al propio worker y a Google APIs
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none';"
  );
});

// -------------------------------------------------------
// CORS — Ajustar el origin con el dominio real de Cloudflare Pages
// -------------------------------------------------------
app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = [
        'http://localhost:4200',    // Angular dev server
        'http://localhost:8787',    // Wrangler dev (pruebas internas)
      ];
      // Permitir cualquier subdominio de pages.dev y el dominio custom
      if (
        allowed.includes(origin) ||
        origin?.endsWith('.pages.dev') ||
        origin?.endsWith('.workers.dev')
      ) {
        return origin;
      }
      return null;
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  })
);

// -------------------------------------------------------
// Health check (sin auth — para verificar que el Worker está vivo)
// -------------------------------------------------------
app.get('/health', (c) => {
  return c.json({ ok: true, timestamp: new Date().toISOString() });
});

// -------------------------------------------------------
// Rutas protegidas — requieren Firebase ID Token
// -------------------------------------------------------
app.use('/api/*', firebaseAuthMiddleware);

/**
 * POST /api/cotizaciones
 * Guarda una cotización en el Google Sheet del abogado autenticado.
 *
 * Body: CotizacionSheet
 * Headers: Authorization: Bearer <firebase_id_token>
 */
app.post('/api/cotizaciones', async (c) => {
  const user = c.get('user');

  let raw: Record<string, unknown>;
  try {
    raw = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'Body inválido' }, 400);
  }

  // Validación estricta de tipos y límites (previene payloads maliciosos)
  if (
    typeof raw.tipoActo !== 'string' || raw.tipoActo.trim().length === 0 || raw.tipoActo.length > 500 ||
    typeof raw.referenciaInterna !== 'string' || raw.referenciaInterna.length > 200 ||
    typeof raw.moneda !== 'string' || !['DOLARES', 'SOLES'].includes(raw.moneda) ||
    typeof raw.totalPagar !== 'number' || !isFinite(raw.totalPagar) || raw.totalPagar < 0 ||
    typeof raw.costoNotarial !== 'number' || !isFinite(raw.costoNotarial) || raw.costoNotarial < 0 ||
    typeof raw.costoRegistral !== 'number' || !isFinite(raw.costoRegistral) || raw.costoRegistral < 0 ||
    typeof raw.cantidadInmuebles !== 'number' || raw.cantidadInmuebles < 0 || raw.cantidadInmuebles > 100
  ) {
    return c.json({ error: 'Datos de cotización inválidos' }, 400);
  }

  // Mass Assignment fix: construir el objeto explícitamente con SOLO los campos permitidos.
  // Cualquier campo extra que venga en el body (ej: __proto__, constructor, etc.) es ignorado.
  const body: CotizacionSheet = {
    fecha: typeof raw.fecha === 'string' ? raw.fecha : new Date().toISOString(),
    tipoActo: raw.tipoActo.trim(),
    referenciaInterna: raw.referenciaInterna.trim(),
    moneda: raw.moneda as 'DOLARES' | 'SOLES',
    cantidadInmuebles: raw.cantidadInmuebles,
    costoNotarial: raw.costoNotarial,
    costoRegistral: raw.costoRegistral,
    totalPagar: raw.totalPagar,
    notaria: typeof raw.notaria === 'string' ? raw.notaria.trim().slice(0, 200) : '',
  };

  try {
    await saveCotizacion(body, user.email, c.env);
    return c.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error guardando cotización:', msg);
    return c.json({ error: 'Error al guardar en Google Sheets' }, 500);
  }
});

/**
 * GET /api/historial?limit=100&offset=0
 * Devuelve el historial paginado del abogado autenticado.
 *
 * Query params:
 *   limit  — número de filas por página (default: 100)
 *   offset — desplazamiento desde el final (default: 0)
 *
 * Response: { data: CotizacionSheet[], hasMore: boolean }
 */
app.get('/api/historial', async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);

  try {
    const result = await getHistorial(user.email, limit, offset, c.env);
    return c.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo historial:', msg);
    return c.json({ error: 'Error al leer Google Sheets' }, 500);
  }
});

// -------------------------------------------------------
// 404 catch-all
// -------------------------------------------------------
app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404));

export default app;
