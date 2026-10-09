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
      nombre_oficial:         perfil?.['nombre_oficial'] ?? '',
      ruc:                    perfil?.['ruc'] ?? '',
      color_marca:            perfil?.['color_marca'] ?? '#1e40af',
      color_membrete:         perfil?.['color_membrete'] ?? '#002855',
      logo_url:               perfil?.['logo_url'] ?? '',
      direccion:              perfil?.['direccion'] ?? '',
      distrito_ciudad:        perfil?.['distrito_ciudad'] ?? '',
      telefono_contacto:      perfil?.['telefono_contacto'] ?? '',
      membrete_izquierdo_url: perfil?.['membrete_izquierdo_url'] ?? '',
      membrete_centro_url:    perfil?.['membrete_centro_url'] ?? '',
      membrete_derecho_url:   perfil?.['membrete_derecho_url'] ?? '',
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

  // Validate spreadsheetId format (Google Sheets IDs are 30-60 alphanumeric chars with hyphens/underscores)
  const sheetIdPattern = /^[a-zA-Z0-9_-]{20,80}$/;
  if (!sheetIdPattern.test(body.spreadsheetId)) {
    return c.json({ error: 'Invalid spreadsheetId format' }, 400);
  }
  
  await firestoreUpdateDoc(
    c.env,
    `usuarios_autorizados/${userEmail}`,
    { spreadsheet_id: body.spreadsheetId },
    ['spreadsheet_id']
  );
  
  return c.json({ success: true });
});

tenant.get('/image-proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.text('URL is required', 400);
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Allow Firebase Storage and Google Cloud Storage domains
    if (
      !host.endsWith('firebasestorage.googleapis.com') &&
      !host.endsWith('firebasestorage.app') &&
      !host.endsWith('storage.googleapis.com') &&
      !host.endsWith('googleusercontent.com')
    ) {
      return c.text('Host not allowed for proxying', 403);
    }

    const res = await fetch(url);
    if (!res.ok) {
      return c.text(`Upstream error: ${res.status}`, 502);
    }

    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return c.text('Error proxying image: ' + (err.message || String(err)), 500);
  }
});

export default tenant;
