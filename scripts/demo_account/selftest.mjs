// Offline self-tests for the demo-account track. No network and no credentials are needed.
// Run: node scripts/demo_account/selftest.mjs
// These tests check the local implementation against the documented rules. They cannot prove
// the live server accepts a signature; that needs demo credentials (see scripts/demo_account/README.md).

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signText, preSignText, authHeaders, loadCredentials, DEMO_HOST, DEMO_API } from './kalshi_auth.mjs';
import { dollarsToUnits, unitsToDollars, isOnPriceGrid, validatePlan, LIMITS } from './order_rules.mjs';

const results = [];
function test(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}

// --- Host and path rules ---
test('demo host is the documented demo REST host', () => {
  assert.equal(DEMO_HOST, 'https://external-api.demo.kalshi.co');
  assert.equal(DEMO_API, 'https://external-api.demo.kalshi.co/trade-api/v2');
});

test('pre-sign text is timestamp + METHOD + path without query', () => {
  assert.equal(
    preSignText('1703123456789', 'get', '/trade-api/v2/portfolio/orders?limit=5'),
    '1703123456789GET/trade-api/v2/portfolio/orders',
  );
});

// --- Signing: verify with Node's independent verifier ---
test('Ed25519 signature verifies against the public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const text = preSignText('1700000000000', 'GET', '/trade-api/v2/portfolio/balance');
  const sig = Buffer.from(signText(pem, text), 'base64');
  assert.equal(crypto.verify(null, Buffer.from(text), publicKey, sig), true);
  assert.equal(crypto.verify(null, Buffer.from(text + 'x'), publicKey, sig), false);
});

test('RSA-PSS (SHA-256, MGF1, salt=digest length) signature verifies', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const text = preSignText('1700000000000', 'POST', '/trade-api/v2/portfolio/events/orders');
  const sig = Buffer.from(signText(pem, text), 'base64');
  const ok = crypto.verify('sha256', Buffer.from(text), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, sig);
  assert.equal(ok, true);
});

test('authHeaders sends the three documented headers', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const h = authHeaders({ keyId: 'test-key-id', pem }, 'GET', '/trade-api/v2/portfolio/balance', 1700000000000);
  assert.deepEqual(Object.keys(h).sort(), ['KALSHI-ACCESS-KEY', 'KALSHI-ACCESS-SIGNATURE', 'KALSHI-ACCESS-TIMESTAMP']);
  assert.equal(h['KALSHI-ACCESS-TIMESTAMP'], '1700000000000');
  assert.equal(h['KALSHI-ACCESS-KEY'], 'test-key-id');
});

test('loadCredentials returns null when either secret is missing', () => {
  assert.equal(loadCredentials({}), null);
  assert.equal(loadCredentials({ KALSHI_DEMO_KEY_ID: 'x' }), null);
  assert.equal(loadCredentials({ KALSHI_DEMO_PRIVATE_KEY: 'x' }), null);
  const c = loadCredentials({ KALSHI_DEMO_KEY_ID: 'id', KALSHI_DEMO_PRIVATE_KEY: 'line1\\nline2' });
  assert.equal(c.pem, 'line1\nline2');
});

// --- Prices and price grid ---
test('dollar strings convert to 1e-4 units and back', () => {
  assert.equal(dollarsToUnits('0.5600'), 5600);
  assert.equal(dollarsToUnits('0.01'), 100);
  assert.equal(dollarsToUnits('1'), 10000);
  assert.equal(unitsToDollars(5600), '0.5600');
  assert.throws(() => dollarsToUnits('0.12345'));
  assert.throws(() => dollarsToUnits('abc'));
});

// Grid from a real market response shape (KXMVECROSSCATEGORY...): center 0.001, edges 0.0001.
const TAPERED = [
  { start: '0.0000', end: '0.0100', step: '0.0001' },
  { start: '0.0100', end: '0.9900', step: '0.0010' },
  { start: '0.9900', end: '1.0000', step: '0.0001' },
];
test('price grid accepts on-grid and rejects off-grid prices', () => {
  assert.equal(isOnPriceGrid(dollarsToUnits('0.5600'), TAPERED), true);
  assert.equal(isOnPriceGrid(dollarsToUnits('0.5605'), TAPERED), false);
  assert.equal(isOnPriceGrid(dollarsToUnits('0.0050'), TAPERED), true);
  assert.equal(isOnPriceGrid(dollarsToUnits('0.5600'), []), false);
});

// --- Order rules ---
const LINEAR = [{ start: '0.0000', end: '1.0000', step: '0.0100' }];
const open = (ticker) => ({ [ticker]: { ticker, status: 'active', price_ranges: LINEAR } });
const bidOrder = (over = {}) => ({ ticker: 'T1', side: 'bid', price_dollars: '0.4000', count: 1, ...over });

test('valid buy-YES order is accepted', () => {
  const r = validatePlan({ orders: [bidOrder()] }, open('T1'));
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.length, 0);
});

test('side=ask (sell YES) is rejected', () => {
  const r = validatePlan({ orders: [bidOrder({ side: 'ask' })] }, open('T1'));
  assert.equal(r.accepted.length, 0);
  assert.match(r.rejected[0].reason, /only side=bid/);
});

test('multi-contract order is rejected by the per-order cap', () => {
  const r = validatePlan({ orders: [bidOrder({ count: 2 })] }, open('T1'));
  assert.equal(r.accepted.length, 0);
});

test('price above $0.99 or below $0.01 is rejected', () => {
  assert.equal(validatePlan({ orders: [bidOrder({ price_dollars: '0.9950' })] }, open('T1')).accepted.length, 0);
  assert.equal(validatePlan({ orders: [bidOrder({ price_dollars: '0.0050' })] }, open('T1')).accepted.length, 0);
});

test('non-active market (closed/finalized) is rejected', () => {
  const m = { T1: { ticker: 'T1', status: 'closed', price_ranges: LINEAR } };
  assert.equal(validatePlan({ orders: [bidOrder()] }, m).accepted.length, 0);
});

test('unknown market (not fetched) is rejected', () => {
  assert.equal(validatePlan({ orders: [bidOrder()] }, {}).accepted.length, 0);
});

test('run caps: at most MAX_ORDERS_PER_RUN accepted and notional stays within the run cap', () => {
  const markets = { T1: { ticker: 'T1', status: 'active', price_ranges: LINEAR } };
  const orders = [1, 2, 3, 4, 5].map(() => bidOrder({ price_dollars: '0.9000' }));
  const r = validatePlan({ orders }, markets);
  assert.equal(r.accepted.length, LIMITS.MAX_ORDERS_PER_RUN);
  assert.ok(r.runNotionalDollars <= LIMITS.MAX_RUN_NOTIONAL_DOLLARS + 1e-9);
});

test('three $0.99 orders fit under the $3.00 run notional cap', () => {
  const markets = { T1: { ticker: 'T1', status: 'active', price_ranges: LINEAR } };
  const orders = [bidOrder({ price_dollars: '0.9900' }), bidOrder({ price_dollars: '0.9900' }), bidOrder({ price_dollars: '0.9900' })];
  const r = validatePlan({ orders }, markets);
  // 3 x $0.99 = $2.97 <= $3.00. With MAX_ORDERS_PER_RUN=3 and max price $0.99, the notional cap cannot bind.
  assert.equal(r.accepted.length, 3);
});

let failed = 0;
for (const [status, name, detail] of results) {
  console.log(`${status}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (status === 'FAIL') failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
