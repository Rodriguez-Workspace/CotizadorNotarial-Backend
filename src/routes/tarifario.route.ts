/**
 * tarifario.route.ts  —  GET /api/tarifario
 *
 * Returns the full list of TarifarioActo objects for the authenticated user's
 * notaría, with requisitos resolved from the requisitos_catalogo map.
 *
 * This mirrors the logic previously in DataService.getTarifarioActos().
 */

import { Hono } from 'hono';
import type { Env, Variables, TarifarioActo, Rango, Requisito } from '../types';
import { firestoreGetDoc } from '../services/firestore.service';

const tarifario = new Hono<{ Bindings: Env; Variables: Variables }>();

tarifario.get('/', async (c) => {
  const notariaId = c.get('notariaId');
  const notariaDoc = await firestoreGetDoc(c.env, `notarias/${notariaId}`);

  if (!notariaDoc) {
    return c.json({ error: 'Notaría no encontrada' }, 404);
  }

  // ── Resolve requisitos catalog ──
  const reqCatalog = (notariaDoc['requisitos_catalogo'] ?? {}) as Record<string, string>;

  // ── Parse tarifario_actos ──
  const rawActos = (notariaDoc['tarifario_actos'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  const actos: TarifarioActo[] = Object.entries(rawActos).map(([id, acto]) => {
    // Resolve rangos array (sorted by min ASC)
    const rawRangos = ((acto['rangos'] as unknown[]) ?? []) as Array<{
      min?: unknown;
      max?: unknown;
      valor?: unknown;
    }>;

    const rangos: Rango[] = rawRangos
      .map((r) => ({
        min:   Number(r.min   ?? 0),
        max:   r.max   != null ? Number(r.max)   : null,
        valor: r.valor != null ? Number(r.valor) : null,
      }))
      .sort((a, b) => a.min - b.min);

    // Resolve requisitos from catalog IDs
    const reqIds = ((acto['requisitos_asociados'] as string[]) ?? []);
    const requisitos: Requisito[] = reqIds
      .filter((rid) => rid in reqCatalog)
      .map((rid) => ({ id: rid, texto: reqCatalog[rid] }));

    return {
      id,
      nombre:                   String(acto['nombre'] ?? id),
      costo_tramite:            Number(acto['costo_tramite'] ?? 0),
      tasa_registral_por_mil:   Number(acto['tasa_registral_por_mil'] ?? 0),
      rangos,
      requisitos,
    };
  });

  // Sort alphabetically by nombre for a consistent UI order
  actos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return c.json({ actos });
});

export default tarifario;
