/**
 * jwt.utils.ts
 *
 * Handles Service Account JWT generation and Google OAuth2 token exchange.
 * Uses WebCrypto API exclusively — no Node.js dependencies.
 *
 * The SA access token is cached in module scope for the lifetime of the
 * Worker isolate (typically minutes), reducing unnecessary token exchanges.
 */

// Module-level token cache. Cleared when the isolate is recycled by Cloudflare.
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Parses a PEM-encoded PKCS#8 private key (from the Service Account JSON)
 * and imports it as a CryptoKey usable for RS256 signing.
 *
 * Cloudflare Workers store the private_key as a string with literal `\n`
 * characters. This function handles both real newlines and escaped ones.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Normalize escaped newlines that may appear when the secret is stored
  // as a single-line string in environment variables
  const normalized = pem.replace(/\\n/g, '\n');

  const pemBody = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  // Decode Base64 → binary → ArrayBuffer
  const binary = atob(pemBody);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    buffer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** Encodes a string or ArrayBuffer to Base64URL (no padding, URL-safe chars) */
function base64url(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Returns a valid Google OAuth2 access token for the given Service Account.
 * Caches the token and reuses it until 5 minutes before expiry.
 *
 * @param email       Service Account client_email from the JSON key file
 * @param privateKey  Service Account private_key from the JSON key file (PEM)
 * @param scopes      List of Google API OAuth scopes to request
 */
export async function getServiceAccountToken(
  email: string,
  privateKey: string,
  scopes: string[]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (5-minute buffer before expiry)
  if (tokenCache && tokenCache.expiresAt > now + 300) {
    return tokenCache.token;
  }

  // Clear any stale cache before attempting a new token
  tokenCache = null;

  try {
    const key = await importPrivateKey(privateKey);

    const header  = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss:   email,
      sub:   email,
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
      scope: scopes.join(' '),
    };

    const headerB64   = base64url(JSON.stringify(header));
    const payloadB64  = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(signingInput)
    );

    const jwt = `${signingInput}.${base64url(signature)}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`SA token exchange failed (${response.status}): ${err}`);
    }

    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    tokenCache = { token: access_token, expiresAt: now + expires_in };
    return access_token;
  } catch (err) {
    tokenCache = null; // Ensure stale cache is never used
    throw err;
  }
}

/** Scopes required for all Google APIs this Worker uses */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];
