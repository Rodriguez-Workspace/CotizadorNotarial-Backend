// ====================================================
// Middleware: Verifica el Firebase ID Token enviado
// por el frontend en el header Authorization: Bearer <token>
// ====================================================

import { Context, Next } from 'hono';
import { Env, AuthenticatedUser } from '../types';

// Cache de claves públicas de Firebase (se renueva según Cache-Control)
let cachedKeys: Record<string, string> = {};
let cacheExpiry = 0;

async function getFirebasePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < cacheExpiry && Object.keys(cachedKeys).length > 0) {
    return cachedKeys;
  }

  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );

  // Parsear el header Cache-Control para saber cuánto tiempo cachear las claves
  const cacheControl = res.headers.get('Cache-Control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 3600;
  cacheExpiry = now + maxAge * 1000;

  cachedKeys = await res.json() as Record<string, string>;
  return cachedKeys;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlDecode(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  return atob(padded);
}

async function verifyFirebaseToken(
  token: string,
  projectId: string
): Promise<AuthenticatedUser | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decodificar header para obtener el key ID
    const header = JSON.parse(base64UrlDecode(parts[0]));
    if (header.alg !== 'RS256') return null;

    const keys = await getFirebasePublicKeys();
    const certPem = keys[header.kid];
    if (!certPem) return null;

    // Importar la clave pública del certificado X.509
    const certDer = pemToDer(certPem);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      certDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Verificar la firma del JWT
    const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToArrayBuffer(parts[2]);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      dataToVerify
    );
    if (!isValid) return null;

    // Verificar claims del payload
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const nowSec = Math.floor(Date.now() / 1000);

    if (payload.exp < nowSec) return null;
    if (payload.iat > nowSec + 300) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!payload.email) return null;

    return { email: payload.email, uid: payload.sub };
  } catch (e) {
    console.error('Error verifying Firebase token:', e);
    return null;
  }
}

// Middleware de Hono — adjunta el usuario verificado al contexto
export async function firebaseAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: { user: AuthenticatedUser } }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No autorizado: falta el token' }, 401);
  }

  const token = authHeader.slice(7);
  const user = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID);

  if (!user) {
    return c.json({ error: 'Token inválido o expirado' }, 401);
  }

  c.set('user', user);
  await next();
}
