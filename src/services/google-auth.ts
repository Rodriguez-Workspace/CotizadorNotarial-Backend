// ====================================================
// Servicio: Obtiene un Access Token de Google usando
// la Service Account (nunca expira el workflow,
// el Worker renueva el token automáticamente)
// ====================================================

// Cache en memoria del token actual
let cachedToken: string | null = null;
let tokenExpiry = 0;

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
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

function encodeBase64Url(data: string): string {
  return btoa(data)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Obtiene un Access Token de Google OAuth2 firmando un JWT
 * con la clave privada de la Service Account.
 * Cachea el token durante 55 minutos (expira a los 60).
 */
export async function getServiceAccountToken(serviceAccountJson: string): Promise<string> {
  const now = Date.now();

  // Reutilizar el token si todavía es válido (con 5 min de margen de seguridad)
  if (cachedToken && now < tokenExpiry - 300_000) {
    return cachedToken;
  }

  const sa: ServiceAccountJson = JSON.parse(serviceAccountJson);
  const nowSec = Math.floor(now / 1000);

  // Construir el JWT assertion
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSec + 3600,
    iat: nowSec,
  }));

  const toSign = `${header}.${payload}`;

  // Importar la clave privada PKCS#8 de la Service Account
  const privateKeyDer = pemToDer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Firmar con RS256
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(toSign)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${toSign}.${signature}`;

  // Intercambiar el JWT por un Access Token de Google
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Error obteniendo token de Service Account: ${err}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string; expires_in: number };
  cachedToken = tokenData.access_token;
  tokenExpiry = now + tokenData.expires_in * 1000;

  return cachedToken;
}
