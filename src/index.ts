import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { Env, AuthenticatedUser } from './types';
import { firebaseAuthMiddleware } from './middleware/firebase-auth';
import { saveCotizacion, getHistorial } from './services/sheets';

type Variables = { user: AuthenticatedUser };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders({ crossOriginOpenerPolicy: false }));

app.use('*', cors({
  origin: (origin) => origin, // Permite cualquier origen de forma dinámica. Ajustar a los de cloudflare en producción si se desea.
  allowHeaders: ['Authorization', 'Content-Type', 'x-google-oauth-token'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

app.use('/api/*', firebaseAuthMiddleware);

app.get('/health', (c) => c.json({ ok: true }));

app.post('/api/cotizaciones', async (c) => {
  const user = c.get('user');
  const googleToken = c.req.header('x-google-oauth-token');
  if (!googleToken) {
    return c.json({ error: 'Falta token de Google OAuth' }, 401);
  }
  const body = await c.req.json();
  
  try {
    await saveCotizacion(body, user.email, googleToken, c.env);
    return c.json({ success: true });
  } catch (error: any) {
    console.error('Error saving cotización:', error.message || error);
    return c.json({ error: 'Error al guardar', details: error.message || 'Desconocido' }, 500);
  }
});

app.get('/api/historial', async (c) => {
  const user = c.get('user');
  const googleToken = c.req.header('x-google-oauth-token');
  if (!googleToken) {
    return c.json({ error: 'Falta token de Google OAuth' }, 401);
  }
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const result = await getHistorial(user.email, limit, offset, googleToken, c.env);
    return c.json(result);
  } catch (error: any) {
    console.error('Error fetching historial:', error.message || error);
    return c.json({ error: 'Error al obtener historial' }, 500);
  }
});

export default app;
