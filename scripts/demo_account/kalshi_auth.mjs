// Kalshi DEMO account helper: request signing and authenticated GET/POST.
//
// Signing rules (official, verified 2026-11-20):
//   https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
//   https://docs.kalshi.com/getting_started/api_keys
//   - Headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-TIMESTAMP (ms), KALSHI-ACCESS-SIGNATURE
//   - Signed text = timestamp + METHOD + path-from-API-root, WITHOUT query string
//     e.g. "1703123456789GET/trade-api/v2/portfolio/balance"
//   - Ed25519 keys sign the text directly; RSA keys use RSA-PSS, SHA-256, MGF1-SHA256,
//     salt length = digest length. Signature is base64.
//
// Scope: DEMO environment only. The host is hard-coded and any other host is refused.
// No credentials are stored in the repository. Credentials are read from environment
// variables that come from GitHub Actions secrets:
//   KALSHI_DEMO_KEY_ID        API key ID (UUID shown by Kalshi when the key is created)
//   KALSHI_DEMO_PRIVATE_KEY   PEM private key text (Ed25519 or RSA)

import crypto from 'node:crypto';

export const DEMO_HOST = 'https://external-api.demo.kalshi.co';
export const API_ROOT = '/trade-api/v2';
export const DEMO_API = DEMO_HOST + API_ROOT;

/** Returns { keyId, pem } when both env vars are set, otherwise null. */
export function loadCredentials(env = process.env) {
  const keyId = (env.KALSHI_DEMO_KEY_ID || '').trim();
  const pem = (env.KALSHI_DEMO_PRIVATE_KEY || '').trim();
  if (!keyId || !pem) return null;
  return { keyId, pem: pem.includes('\\n') && !pem.includes('\n') ? pem.replace(/\\n/g, '\n') : pem };
}

/** Pre-sign text as defined by Kalshi: timestamp + METHOD + path (no query string). */
export function preSignText(timestampMs, method, pathWithOptionalQuery) {
  const pathOnly = pathWithOptionalQuery.split('?')[0];
  return `${timestampMs}${method.toUpperCase()}${pathOnly}`;
}

/** Signs text with the key type detected from the parsed PEM (not from the PEM header). */
export function signText(pem, text) {
  const key = crypto.createPrivateKey(pem);
  const data = Buffer.from(text, 'utf8');
  if (key.asymmetricKeyType === 'ed25519') {
    return crypto.sign(null, data, key).toString('base64');
  }
  if (key.asymmetricKeyType === 'rsa') {
    const sig = crypto.sign('sha256', data, {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });
    return sig.toString('base64');
  }
  throw new Error(`Unsupported Kalshi key type: ${key.asymmetricKeyType}`);
}

/** Builds the three authentication headers for one request. */
export function authHeaders({ keyId, pem }, method, pathWithOptionalQuery, nowMs = Date.now()) {
  const ts = String(nowMs);
  const sig = signText(pem, preSignText(ts, method, pathWithOptionalQuery));
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': sig,
  };
}

/**
 * Authenticated request to the DEMO Trade API.
 * @param creds  { keyId, pem }
 * @param method 'GET' | 'POST' | ...
 * @param path   path relative to API root, e.g. '/portfolio/balance?limit=10'
 * @param body   optional JSON body
 * Throws on non-2xx with the status and Kalshi's error body (never the credentials).
 */
export async function demoRequest(creds, method, path, body) {
  const fullPath = API_ROOT + path; // signed path = path from API root, without query
  const url = DEMO_HOST + fullPath;
  if (!url.startsWith(DEMO_HOST + API_ROOT + '/')) throw new Error('Refusing non-demo URL');
  const headers = { Accept: 'application/json', ...authHeaders(creds, method, fullPath) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`Kalshi demo ${method} ${path} -> HTTP ${res.status}: ${json?.error?.details || json?.code || json?.message || ''}`.trim());
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Public (unauthenticated) GET on the DEMO Trade API. */
export async function demoPublicGet(path) {
  const url = DEMO_HOST + API_ROOT + path;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Public GET ${path} -> HTTP ${res.status}`);
  return res.json();
}
