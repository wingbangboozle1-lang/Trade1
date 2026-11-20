#!/usr/bin/env node
/* Fee-model test against the official Kalshi fee schedule's own table.
 *
 * Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf
 *         "Trading Fees", General Trading Fees Table (last updated 2026-07-07):
 *         fees = roundup(M x 0.07 x C x P x (1-P)); M default 1.
 *
 * Every row of that published table is reproduced below verbatim and asserted
 * against assets/model.js's fee function. This test is what caught the
 * float-ceiling bug (100 contracts @ $0.50 → $1.76 instead of $1.75).
 *
 * Usage: node scripts/test_fees.mjs      (exit 0 = all rows match)
 */
import { readFile } from 'node:fs/promises';

// [price, 1-contract fee, 100-contract price, 100-contract fee] — verbatim from the PDF table.
const PUBLISHED = [
  [0.01, 0.01, 1.00, 0.07], [0.05, 0.01, 5.00, 0.34], [0.10, 0.01, 10.00, 0.63],
  [0.15, 0.01, 15.00, 0.90], [0.20, 0.02, 20.00, 1.12], [0.25, 0.02, 25.00, 1.32],
  [0.30, 0.02, 30.00, 1.47], [0.35, 0.02, 35.00, 1.60], [0.40, 0.02, 40.00, 1.68],
  [0.45, 0.02, 45.00, 1.74], [0.50, 0.02, 50.00, 1.75], [0.55, 0.02, 55.00, 1.74],
  [0.60, 0.02, 60.00, 1.68], [0.65, 0.02, 65.00, 1.60], [0.70, 0.02, 70.00, 1.47],
  [0.75, 0.02, 75.00, 1.32], [0.80, 0.02, 80.00, 1.12], [0.85, 0.01, 85.00, 0.90],
  [0.90, 0.01, 90.00, 0.63], [0.95, 0.01, 95.00, 0.34], [0.99, 0.01, 99.00, 0.07],
];

// Load assets/model.js in a stub DOM so the browser IIFE can be evaluated in Node.
const src = await readFile(new URL('../assets/model.js', import.meta.url), 'utf8');
const store = new Map();
const sandbox = {
  window: {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
};
const fn = new Function('window', 'localStorage', src + '\nreturn window.KalshiModel;');
const M = fn(sandbox.window, sandbox.localStorage);

const fee = (price, qty) => {
  // model.js's DEFAULT_BOT enables fees; assert that so the test fails loudly
  // if the default ever changes to fees-off (which would silently report $0).
  if (!M.state.bot.fees) throw new Error('paper fee model is disabled by default — fee test cannot validate');
  return M.fee(price, qty);
};
let failures = 0;
const near = (a, b) => Math.abs(a - b) <= 1e-9;

for (const [p, one, hundredPrice, hundredFee] of PUBLISHED) {
  const got1 = fee(p, 1);
  const got100 = fee(p, 100);
  const tag = `price $${p.toFixed(2)}`;
  if (!near(got1, one)) { failures++; console.log(`  ✗ ${tag} · 1 contract: got $${got1.toFixed(4)}, table says $${one}`); }
  if (!near(got100, hundredFee)) { failures++; console.log(`  ✗ ${tag} · 100 contracts: got $${got100.toFixed(4)}, table says $${hundredFee}`); }
  if (!near(hundredPrice, +(p * 100).toFixed(2))) { failures++; console.log(`  ✗ ${tag} · 100-contract price column inconsistent`); }
}

// Guard rails: the fee function must never charge on non-positive inputs.
if (fee(0.5, 0) !== 0 || fee(0, 10) !== 0) { failures++; console.log('  ✗ zero/negative quantity or price did not return $0'); }

// Per-series taker multiplier M — official Non-Standard Fees table
// (https://kalshi.com/docs/kalshi-fee-schedule.pdf, cross-checked against
// https://kalshi.com/fee-schedule). Series published as "no fees" have M = 0.
const NO_FEE_SERIES = ['KXBTCY', 'KXETHY', 'KXELECTIRAN', 'KXPAHLAVIHEAD', 'KXCITRINI',
  'KXDOED', 'KXGAMBLINGREPEAL', 'KXGREENLAND', 'KXIRANDEMOCRACY', 'KXLAYOFFSYINFO'];
for (const s of NO_FEE_SERIES) {
  if (M.fee(0.5, 100, s) !== 0) {
    failures++;
    console.log(`  ✗ ${s} is published as "no fees" but the model charged $${M.fee(0.5, 100, s).toFixed(4)}`);
  }
}
for (const s of ['KXAAAGASM', 'KXPGATOUR', 'KXOSCARPIC', 'KXNOTLISTED']) {
  if (!near(M.fee(0.5, 100, s), 1.75)) {
    failures++;
    console.log(`  ✗ ${s} should use the default M = 1 (got $${M.fee(0.5, 100, s).toFixed(4)})`);
  }
}
if (!near(M.fee(0.5, 100, 'KXBTCY-27JAN0100-B47500'), 0)) {
  failures++;
  console.log('  ✗ a market ticker did not resolve to its series prefix for the fee lookup');
}
if (M.takerMultiplier('KXBTCY') !== 0 || M.takerMultiplier('KXAAAGASM') !== 1 || M.takerMultiplier('KXNEW') !== 1) {
  failures++;
  console.log('  ✗ takerMultiplier() does not follow the published table (default M = 1)');
}

const rows = PUBLISHED.length;
if (failures) {
  console.error(`FEE TEST FAILED: ${failures} mismatch(es) across ${rows} published rows (` +
    'source: https://kalshi.com/docs/kalshi-fee-schedule.pdf)');
  process.exitCode = 1;
} else {
  console.log(`Fee model matches all ${rows} published rows of the official General Trading Fees Table ` +
    `(1 and 100 contracts, ${rows * 2} assertions) plus ${NO_FEE_SERIES.length} per-series multipliers. ` +
    `Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf`);
}
