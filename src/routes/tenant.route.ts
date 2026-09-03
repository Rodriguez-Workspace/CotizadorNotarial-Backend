/**
 * tenant.route.ts  —  GET /api/tenant
 *
 * Returns the notaría branding profile for the authenticated user.
 * The auth middleware has already loaded notariaId and rol into context.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { firestoreGetDoc } from '../services/firestore.service';

const tenant = new Hono<{ Bindings: Env; Variables: Variables }>();

tenant.get('/', async (c) => {
  const notariaId = c.get('notariaId');

  const notariaDoc = await firestoreGetDoc(c.env, `notarias/${notariaId}`);

  if (!notariaDoc) {
    return c.json({ error: `Notaría "${notariaId}" no encontrada` }, 404);
  }

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
  });
});

export default tenant;
