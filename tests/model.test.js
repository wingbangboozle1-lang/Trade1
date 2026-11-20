/* Unit tests for the deployed strategy model (assets/model.js), run in Node.
 * Fee expectations are taken from the OFFICIAL Kalshi fee schedule
 * (https://kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07),
 * including the "Non-Standard Fees" table of per-series taker multipliers.
 * Run: node tests/model.test.js */
const fs = require('fs');
const path = require('path');

/* ---- minimal browser stubs ---- */
const store = {};
global.window = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.document = { body: { dataset: {} } };

eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'model.js'), 'utf8'));
const M = global.window.KalshiModel;
if (!M) throw new Error('model.js did not expose window.KalshiModel');

let passed = 0, failed = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + ' — got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function approx(name, got, want, tol = 1e-9) {
  const ok = Math.abs(got - want) <= tol;
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + ' — got ' + got + ', want ' + want); }
}

console.log('1. Standard taker fee (M=1), official table:');
approx('fee(1 @ $0.10) = $0.01', M.fee(0.10, 1), 0.01);
approx('fee(1 @ $0.50) = $0.02', M.fee(0.50, 1), 0.02);
approx('fee(100 @ $0.05) = $0.34', M.fee(0.05, 100), 0.34);
approx('fee(100 @ $0.20) = $1.12', M.fee(0.20, 100), 1.12);
approx('fee(100 @ $0.50) = $1.75', M.fee(0.50, 100), 1.75);
approx('fee(100 @ $0.99) = $0.07', M.fee(0.99, 100), 0.07);

console.log('2. Non-standard taker multipliers (official Non-Standard Fees table):');
eq('KXBTCY (BTC EOY) taker multiplier = 0', M.fee(0.50, 100, 'KXBTCY'), 0);
eq('KXETHY (ETH EOY) taker multiplier = 0', M.fee(0.50, 100, 'KXETHY'), 0);
eq('KXBTCY-27JAN0100-B47500 (series prefix) fee = 0', M.fee(0.50, 100, 'KXBTCY-27JAN0100-B47500'), 0);
eq('KXELECTIRAN taker multiplier = 0', M.fee(0.50, 100, 'KXELECTIRAN'), 0);
approx('KXAAAGASM (gas) standard M=1 → $1.75', M.fee(0.50, 100, 'KXAAAGASM'), 1.75);
approx('KXPGATOUR (golf) standard M=1 → $1.75', M.fee(0.50, 100, 'KXPGATOUR'), 1.75);
approx('unlisted series defaults to M=1', M.fee(0.50, 100, 'KXSOMETHINGNEW'), 1.75);
approx('lowercase series normalized → M=1', M.fee(0.50, 100, 'kxaaagams'), 1.75);

console.log('3. Fee helpers:');
eq('seriesOf("KXBTCY-27JAN0100-B47500") = KXBTCY', M.seriesOf('KXBTCY-27JAN0100-B47500'), 'KXBTCY');
eq('seriesOf("KXAAAGASM-26NOV30-3.90") = KXAAAGASM', M.seriesOf('KXAAAGASM-26NOV30-3.90'), 'KXAAAGASM');
eq('seriesOf("KXPGATOUR-THRC26-SSTR") = KXPGATOUR', M.seriesOf('KXPGATOUR-THRC26-SSTR'), 'KXPGATOUR');
eq('takerMultiplier("KXBTCY") = 0', M.takerMultiplier('KXBTCY'), 0);
eq('takerMultiplier("KXAAAGASM") = 1', M.takerMultiplier('KXAAAGASM'), 1);
eq('takerMultiplier("UNLISTED") = 1', M.takerMultiplier('UNLISTED'), 1);
eq('fees disabled → 0', (function () {
  M.state.bot.fees = false; const v = M.fee(0.50, 100, 'KXBTCY'); M.state.bot.fees = true; return v;
})(), 0);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
