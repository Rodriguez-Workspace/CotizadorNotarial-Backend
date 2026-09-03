/**
 * firestore.service.ts
 *
 * Thin wrapper around the Firestore REST API.
 * Authenticates via Service Account token (getServiceAccountToken).
 * All operations return plain JS objects — Firestore typed values are
 * transparently converted by firestore.utils.ts.
 */

import type { Env } from '../types';
import { getServiceAccountToken, GOOGLE_SCOPES } from '../utils/jwt.utils';
import { fromFirestoreFields, toFirestoreFields } from '../utils/firestore.utils';

function firestoreBaseUrl(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function getAuthHeaders(env: Env): Promise<HeadersInit> {
  const token = await getServiceAccountToken(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SCOPES
  );
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ─── Read ──────────────────────────────────────────────────────────────────

/**
 * Fetches a single Firestore document.
 * @param path  Document path, e.g. "notarias/notaria-cruzado"
 * @returns Plain JS object of the document fields, or null if not found.
 */
export async function firestoreGetDoc(
  env: Env,
  path: string
): Promise<Record<string, unknown> | null> {
  const url = `${firestoreBaseUrl(env.FIREBASE_PROJECT_ID)}/${path}`;
  const headers = await getAuthHeaders(env);

  const res = await fetch(url, { headers });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore GET ${path} failed (${res.status}): ${body}`);
  }

  const doc = (await res.json()) as { fields?: Record<string, unknown> };
  return doc.fields ? fromFirestoreFields(doc.fields as never) : {};
}

// ─── Write ─────────────────────────────────────────────────────────────────

/**
 * Creates or fully replaces a Firestore document.
 * @param path    Document path, e.g. "usuarios_autorizados/user@email.com"
 * @param data    Plain JS object to store
 */
export async function firestoreSetDoc(
  env: Env,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const url = `${firestoreBaseUrl(env.FIREBASE_PROJECT_ID)}/${path}`;
  const headers = await getAuthHeaders(env);

  const body = JSON.stringify({ fields: toFirestoreFields(data) });

  const res = await fetch(url, { method: 'PATCH', headers, body });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Firestore SET ${path} failed (${res.status}): ${errBody}`);
  }
}

/**
 * Updates specific fields in an existing document without overwriting others.
 * @param path         Document path
 * @param data         Fields to update (partial object)
 * @param fieldPaths   List of field names to update (for the updateMask)
 */
export async function firestoreUpdateDoc(
  env: Env,
  path: string,
  data: Record<string, unknown>,
  fieldPaths: string[]
): Promise<void> {
  const mask = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url  = `${firestoreBaseUrl(env.FIREBASE_PROJECT_ID)}/${path}?${mask}`;
  const headers = await getAuthHeaders(env);

  const body = JSON.stringify({ fields: toFirestoreFields(data) });

  const res = await fetch(url, { method: 'PATCH', headers, body });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Firestore UPDATE ${path} failed (${res.status}): ${errBody}`);
  }
}
