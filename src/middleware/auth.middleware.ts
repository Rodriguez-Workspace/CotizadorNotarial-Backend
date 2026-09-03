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
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

function b64urlToBytes(str: string): Uint8Array {
  return Uint8Array.from(b64urlDecode(str), (c) => c.charCodeAt(0));
}

// ─── Middleware ────────────────────────────────────────────────────────────

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const t0 = Date.now();
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
    console.log('[auth] step1: parsing token');
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

    if (payload.exp < now) {
      return c.json({ error: 'Token expired' }, 401);
    }
    if (payload.aud !== c.env.FIREBASE_PROJECT_ID) {
      return c.json({ error: 'Invalid audience' }, 401);
    }
    if (payload.iss !== `https://securetoken.google.com/${c.env.FIREBASE_PROJECT_ID}`) {
      return c.json({ error: 'Invalid issuer' }, 401);
    }

    console.log(`[auth] step2: fetching JWK for kid=${header.kid} (+${Date.now()-t0}ms)`);
    const publicKeys = await getFirebasePublicKeys();
    const jwk = publicKeys[header.kid as string];
    if (!jwk) return c.json({ error: 'Unknown key ID' }, 401);

    console.log(`[auth] step3: importing JWK key (+${Date.now()-t0}ms)`);
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    console.log(`[auth] step4: verifying RSA signature (+${Date.now()-t0}ms)`);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );

    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    const normalizedEmail = (payload.email || '').toLowerCase();
    console.log(`[auth] step5: loading user from Firestore (${normalizedEmail}) (+${Date.now()-t0}ms)`);
    const userDoc = await firestoreGetDoc(
      c.env,
      `usuarios_autorizados/${normalizedEmail}`
    );
    console.log(`[auth] step5 done: userDoc=${userDoc ? 'found' : 'null'} (+${Date.now()-t0}ms)`);

    if (!userDoc) {
      return c.json({ error: 'Usuario no autorizado' }, 403);
    }

    if (userDoc['estado'] !== 'activo') {
      return c.json({ error: 'Cuenta inactiva' }, 403);
    }

    c.set('userEmail',  payload.email);
    c.set('userId',     payload.sub);
    c.set('notariaId',  userDoc['notaria_id'] as string);
    c.set('rol',        userDoc['rol'] as string);

    console.log(`[auth] step6: calling next (+${Date.now()-t0}ms)`);
    await next();
    console.log(`[auth] done (+${Date.now()-t0}ms)`);
  } catch (err) {
    console.error('[authMiddleware] error:', (err as Error).message, (err as Error).stack);
    return c.json({ error: 'Authentication failed', detail: (err as Error).message }, 401);
  }
}
