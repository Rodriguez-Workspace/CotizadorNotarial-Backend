/**
 * tenant.route.ts  —  GET /api/tenant
 *
 * Returns the notaría branding profile for the authenticated user.
 * The auth middleware has already loaded notariaId and rol into context.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { firestoreGetDoc, firestoreUpdateDoc } from '../services/firestore.service';

const tenant = new Hono<{ Bindings: Env; Variables: Variables }>();

tenant.get('/', async (c) => {
  const notariaId = c.get('notariaId');

  const notariaDoc = await firestoreGetDoc(c.env, `notarias/${notariaId}`);

  if (!notariaDoc) {
    return c.json({ error: `Notaría "${notariaId}" no encontrada` }, 404);
  }
  
  const userEmail = c.get('userEmail');
  const userDoc = await firestoreGetDoc(c.env, `usuarios_autorizados/${userEmail}`);
  const spreadsheetId = userDoc?.['spreadsheet_id'] as string | undefined;

  const perfil = notariaDoc['perfil'] as Record<string, unknown> | undefined;

  return c.json({
    notariaId,
    rol: c.get('rol'),
    perfil: {
      nombre_oficial: perfil?.['nombre_oficial'] ?? '',
      ruc:            perfil?.['ruc'] ?? '',
      color_marca:    perfil?.['color_marca'] ?? '#1e40af',
      logo_url:       perfil?.['logo_url'] ?? '',
    },
    spreadsheetId: spreadsheetId || null,
    serviceAccountEmail: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  });
});

tenant.post('/spreadsheet', async (c) => {
  const userEmail = c.get('userEmail');
  let body: { spreadsheetId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  
  if (!body.spreadsheetId) {
    return c.json({ error: 'spreadsheetId is required' }, 400);
  }
  
  await firestoreUpdateDoc(
    c.env,
    `usuarios_autorizados/${userEmail}`,
    { spreadsheet_id: body.spreadsheetId },
    ['spreadsheet_id']
  );
  
  return c.json({ success: true });
});

export default tenant;
