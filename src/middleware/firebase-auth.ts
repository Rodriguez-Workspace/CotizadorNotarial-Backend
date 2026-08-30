import { Context, Next } from 'hono';
import { Env, AuthenticatedUser } from '../types';

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
  
  const cacheControl = res.headers.get('Cache-Control') || '';
  const maxAge = parseInt(cacheControl.match(/max-age=(\d+)/)?.[1] || '3600');
  cacheExpiry = now + maxAge * 1000;
  
  cachedKeys = await res.json();
  return cachedKeys;
}

function decodeB64Url(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

async function verifyFirebaseToken(
  token: string,
  projectId: string
): Promise<AuthenticatedUser | null> {
  try {
    const [headerB64] = token.split('.');
    const header = JSON.parse(decodeB64Url(headerB64));
    
    const keys = await getFirebasePublicKeys();
    const certPem = keys[header.kid];
    if (!certPem) throw new Error(`No cert found for kid: ${header.kid}`);

    const certDer = pemToDer(certPem);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      certDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const parts = token.split('.');
    const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToArrayBuffer(parts[2]);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      dataToVerify
    );

    if (!isValid) throw new Error("Invalid signature");

    const payload = JSON.parse(decodeB64Url(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) throw new Error(`Token expired. Exp: ${payload.exp}, Now: ${now}`);
    if (payload.iat > now + 300) throw new Error(`Token from future. Iat: ${payload.iat}`);
    if (payload.aud !== projectId) throw new Error(`Audience mismatch. Expected ${projectId}, got ${payload.aud}`);
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error(`Issuer mismatch. Expected https://securetoken.google.com/${projectId}, got ${payload.iss}`);

    return { email: payload.email, uid: payload.sub };
  } catch (error: any) {
    console.error('Token validation failed:', error);
    throw new Error(error.message || error.toString());
  }
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  const binary = decodeB64Url(b64url);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function firebaseAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No autorizado' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const user = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID);
    c.set('user', user);
    await next();
  } catch (err: any) {
    return c.json({ error: 'Token inválido o expirado', details: err.message }, 401);
  }
}
