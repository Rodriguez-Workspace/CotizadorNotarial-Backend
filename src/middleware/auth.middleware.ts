/**
 * auth.middleware.ts
 *
 * Verifies Firebase ID Tokens (issued by Firebase Auth on the frontend).
 * Uses WebCrypto + Google's JWK endpoint — no Firebase Admin SDK needed.
 *
 * On success, sets `userEmail`, `userId`, `notariaId`, and `rol` in the
 * Hono context so routes can access them without repeating Firestore calls.
 */

import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { firestoreGetDoc } from '../services/firestore.service';

// ─── Firebase public key cache ─────────────────────────────────────────────

interface JwkKeySet {
  keys: Record<string, JsonWebKey>; // kid → JWK
  expiresAt: number;
}

let jwkCache: JwkKeySet | null = null;

async function getFirebasePublicKeys(): Promise<Record<string, JsonWebKey>> {
  const now = Date.now();
  if (jwkCache && jwkCache.expiresAt > now) return jwkCache.keys;

  const res = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    { cf: { cacheTtl: 3600 } } as RequestInit
  );

  // Honor Google's Cache-Control max-age for key rotation
  const cacheControl = res.headers.get('Cache-Control') ?? '';
  const match = cacheControl.match(/max-age=(\d+)/);
  const maxAge = match ? parseInt(match[1]) * 1000 : 3_600_000;

  const data = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const keys: Record<string, JsonWebKey> = {};
  for (const k of data.keys) keys[k.kid] = k;

  jwkCache = { keys, expiresAt: now + maxAge };
  return keys;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function b64urlDecode(str: string): string {
  const padded = str + '==='.slice((str.length % 4) || 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64urlToBytes(str: string): Uint8Array {
  return Uint8Array.from(b64urlDecode(str), (c) => c.charCodeAt(0));
}

// ─── Middleware ────────────────────────────────────────────────────────────

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized — missing Bearer token' }, 401);
  }

  const idToken = authHeader.slice(7);
  const parts = idToken.split('.');

  if (parts.length !== 3) {
    return c.json({ error: 'Unauthorized — malformed token' }, 401);
  }

  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header  = JSON.parse(b64urlDecode(headerB64));
    const payload = JSON.parse(b64urlDecode(payloadB64)) as {
      exp: number;
      iat: number;
      aud: string;
      iss: string;
      sub: string;
      email: string;
      uid?: string;
    };

    const now = Math.floor(Date.now() / 1000);

    // ── Claim validation ──
    if (payload.exp < now) {
      return c.json({ error: 'Token expired' }, 401);
    }
    if (payload.aud !== c.env.FIREBASE_PROJECT_ID) {
      return c.json({ error: 'Invalid audience' }, 401);
    }
    if (payload.iss !== `https://securetoken.google.com/${c.env.FIREBASE_PROJECT_ID}`) {
      return c.json({ error: 'Invalid issuer' }, 401);
    }

    // ── Signature verification ──
    const publicKeys = await getFirebasePublicKeys();
    const jwk = publicKeys[header.kid as string];
    if (!jwk) return c.json({ error: 'Unknown key ID' }, 401);

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );

    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    // ── Load user record from Firestore ──
    const userDoc = await firestoreGetDoc(
      c.env,
      `usuarios_autorizados/${payload.email}`
    );

    if (!userDoc) {
      return c.json({ error: 'Usuario no autorizado' }, 403);
    }

    if (userDoc['estado'] !== 'activo') {
      return c.json({ error: 'Cuenta inactiva' }, 403);
    }

    // Populate context variables for downstream routes
    c.set('userEmail',  payload.email);
    c.set('userId',     payload.sub);
    c.set('notariaId',  userDoc['notaria_id'] as string);
    c.set('rol',        userDoc['rol'] as string);

    await next();
  } catch (err) {
    console.error('[authMiddleware] error:', err);
    return c.json({ error: 'Authentication failed' }, 401);
  }
}
