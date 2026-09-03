/**
 * variables.route.ts  —  GET /api/variables
 *
 * Returns UIT (Unidad Impositiva Tributaria) and exchange rate
 * from Firestore's global variables document.
 *
 * Mirrors ExchangeRateService.getExchangeRate() + DataService.getUIT().
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { firestoreGetDoc } from '../services/firestore.service';

const variables = new Hono<{ Bindings: Env; Variables: Variables }>();

variables.get('/', async (c) => {
  const doc = await firestoreGetDoc(
    c.env,
    'variables_globales/valores_actuales'
  );

  if (!doc) {
    return c.json({ error: 'Variables globales no encontradas' }, 404);
  }

  return c.json({
    UIT:    Number(doc['UIT']    ?? 5150),
    compra: Number(doc['compra'] ?? 3.7),
    venta:  Number(doc['venta']  ?? 3.75),
    moneda: String(doc['moneda'] ?? 'USD'),
    origen: String(doc['origen'] ?? 'SUNAT'),
    fecha_sunat: String(doc['fecha_sunat'] ?? ''),
  });
});

export default variables;
