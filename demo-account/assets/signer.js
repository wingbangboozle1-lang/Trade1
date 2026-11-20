// demo-account/assets/signer.js — browser-side Kalshi request signing with WebCrypto.
// Algorithm (official, verified 2026-11-20):
//   https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
//   pre-sign text = timestamp(ms) + METHOD + path-from-API-root (query string stripped)
//   RSA keys: RSA-PSS, SHA-256, MGF1-SHA256, salt length = digest length (WebCrypto RSA-PSS
//   uses salt length = hash length, so SHA-256 gives salt 32 = DIGEST_LENGTH — matches).
//   Ed25519 keys: sign the text directly (browser support varies; flagged F-DA-3).
//   Signature: base64.
// Credentials live ONLY in the browser's localStorage (never in the repository).

const te = new TextEncoder();

/** "1703123456789GET/trade-api/v2/portfolio/balance" (query stripped, method uppercased). */
export function preSignText(timestampMs, method, pathWithOptionalQuery) {
  return `${timestampMs}${method.toUpperCase()}${pathWithOptionalQuery.split('?')[0]}`;
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function detectKeyType(pem) {
  const s = String(pem);
  if (/BEGIN (RSA )?PRIVATE KEY/.test(s)) return 'rsa';
  if (/BEGIN OPENSSH PRIVATE KEY|BEGIN PRIVATE KEY/.test(s)) return 'unknown'; // parsed after import
  return 'unknown';
}

/**
 * Import a PKCS#8 PEM private key (RSA or Ed25519) for signing.
 * Returns { key, type: 'rsa'|'ed25519', subtle } or throws with a readable message.
 */
export async function importPrivateKey(pem) {
  const buf = pemToArrayBuffer(pem);
  // Try RSA-PSS first when it looks like an RSA key; fall back to Ed25519.
  const attempts = [];
  if (detectKeyType(pem) !== 'rsa') attempts.push({ name: 'Ed25519' }, { name: 'RSA-PSS', hash: 'SHA-256' });
  else attempts.push({ name: 'RSA-PSS', hash: 'SHA-256' }, { name: 'Ed25519' });
  let lastErr;
  for (const algo of attempts) {
    try {
      const key = await crypto.subtle.importKey('pkcs8', buf, algo, false, ['sign']);
      return { key, type: algo.name === 'Ed25519' ? 'ed25519' : 'rsa' };
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Could not import private key (${lastErr?.message || lastErr}). Expected a PKCS#8 PEM RSA or Ed25519 key as downloaded from Kalshi.`);
}

/** Sign pre-sign text -> base64 signature. */
export async function signText(imported, text) {
  const sig = await crypto.subtle.sign(
    imported.type === 'rsa' ? { name: 'RSA-PSS', saltLength: 32 } : 'Ed25519',
    imported.key,
    te.encode(text),
  );
  let bin = '';
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** The three official auth headers for one request. */
export async function authHeaders(imported, keyId, method, path, nowMs = Date.now()) {
  const ts = String(nowMs);
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': await signText(imported, preSignText(ts, method, path)),
  };
}
