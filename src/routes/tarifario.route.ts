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

  // ── Parse actos from categorias_actos ──
  const rawCategorias = notariaDoc['categorias_actos'] as Record<
    string,
    {
      nombre?: string;
      requisitos_base?: string[];
      actos?: Record<string, Record<string, unknown>>;
    }
  > | undefined;

  const actos: TarifarioActo[] = [];

  if (rawCategorias && Object.keys(rawCategorias).length > 0) {
    for (const [_catId, cat] of Object.entries(rawCategorias)) {
      const baseReqIds = Array.isArray(cat.requisitos_base) ? cat.requisitos_base : [];
      const catActos = cat.actos ?? {};

      for (const [id, acto] of Object.entries(catActos)) {
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

        // Resolve requisitos:
        // 1. Primero: requisitos base de la categoría en su orden exacto
        // 2. Después: requisitos específicos del acto (sin duplicar los base)
        const specificReqIds = ((acto['requisitos_asociados'] ?? acto['reqs'] ?? []) as string[]);

        const combinedReqIds: string[] = [];
        for (const bid of baseReqIds) {
          if (!combinedReqIds.includes(bid)) {
            combinedReqIds.push(bid);
          }
        }
        for (const sid of specificReqIds) {
          if (!combinedReqIds.includes(sid)) {
            combinedReqIds.push(sid);
          }
        }

        const requisitos: Requisito[] = combinedReqIds
          .filter((rid) => rid in reqCatalog)
          .map((rid) => ({ id: rid, texto: reqCatalog[rid] }));

        actos.push({
          id,
          nombre:                 String(acto['nombre'] ?? id),
          costo_tramite:          Number(acto['costo_tramite'] ?? acto['costo'] ?? 0),
          tasa_registral_por_mil: Number(acto['tasa_registral_por_mil'] ?? acto['tasa'] ?? 0),
          rangos,
          requisitos,
        });
      }
    }
  }

  // Sort alphabetically by nombre for a consistent UI order
  actos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return c.json({ actos });
});

export default tarifario;
