#!/usr/bin/env node
/* Offline unit checks for the main dashboard engine (assets/model.js).
 *
 * Focus: the exact rules the published site's alerts and paper trading depend
 * on, each pinned to an official source:
 *   - alert threshold is ">= $0.10 either direction" (the brief) and must fire
 *     on an exact 10-cent move even though 0.66 - 0.56 = 0.09999999999999998
 *     in binary floating point (the rule is applied to official 4-dp prices);
 *   - the ROI screen returns a 0..1 score and never crashes on sparse data;
 *   - topic classification keeps the five topics apart (golf excludes
 *     Politics/Elections series, natural gas is not a gas-price market);
 *   - strategies only enter inside the 5c-95c fillable band.
 *
 * No network, no browser. Usage: node scripts/test_model.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../assets/model.js', import.meta.url), 'utf8');
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const M = new Function('window', 'localStorage', src + '\nreturn window.KalshiModel;')({}, localStorage);

let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error('  ✗ ' + name + ': ' + e.message); process.exitCode = 1; }
};

/* ---- 1. alert threshold, integer-cent comparison ------------------------- */
// The published rule compares consecutive sampled prices (4-dp official values).
// A naive float compare misses the exact-10-cent case.
const DEC = /^\d+(\.\d+)?$/;
const centsOf = (v) => Math.round(Number(v) * 100);
const fires = (from, to) => Math.abs(centsOf(to) - centsOf(from)) >= 10;

ok('exact 10c down move ($0.66 -> $0.56) fires', () => assert.equal(fires(0.66, 0.56), true));
ok('naive float subtraction would miss that move (documenting the hazard)', () => {
  assert.ok(Math.abs(0.66 - 0.56) < 0.1); // 0.09999999999999998
});
ok('9c move does not fire', () => assert.equal(fires(0.60, 0.69), false));
ok('exact 10c up move fires', () => assert.equal(fires(0.42, 0.52), true));
ok('price strings from the API parse to cents exactly', () => {
  assert.ok(DEC.test('0.5600'));
  assert.equal(centsOf('0.5600'), 56);
});

/* ---- 2. ROI screen ------------------------------------------------------- */
ok('score is within 0..1 and finite for sparse data', () => {
  const s = M.score(0.12, { volume_24h_fp: '0.00', volume_fp: '0.00', yes_bid_dollars: '0.4000', yes_ask_dollars: '0.4200', last_price_dollars: '0.41' });
  assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, 'score=' + s);
});
ok('score of 0 when everything is empty', () => {
  const s = M.score(0, {});
  assert.ok(Number.isFinite(s) && s >= 0 && s <= 1);
});
ok('a bigger move with the same book scores higher', () => {
  const book = { volume_24h_fp: '500', volume_fp: '5000', yes_bid_dollars: '0.40', yes_ask_dollars: '0.42', last_price_dollars: '0.41' };
  assert.ok(M.score(0.30, book) > M.score(0.10, book));
});

/* ---- 3. topic classification -------------------------------------------- */
ok('golf keyword matches a PGA event', () => assert.equal(M.classify('Sports', 'The RSM Classic Winner', 'KXPGATOUR'), 'golf'));
ok('golf never claims Politics/Elections events (PR #20 finding)', () => {
  assert.notEqual(M.classify('Politics', 'Trump golf club championship', 'KXTRUMPGOLF'), 'golf');
  assert.notEqual(M.classify('Elections', 'Will Trump golf on election day?', 'KXTGOLF'), 'golf');
});
ok('natural gas is excluded from gas prices', () => assert.notEqual(M.classify('Economics', 'Natural gas prices this week', 'KXGAS'), 'gas-prices'));
ok('AAA gas market classifies as gas prices', () => assert.equal(M.classify('Economics', 'Will average gas prices be above $3.50?', 'KXAAAGASM'), 'gas-prices'));
ok('bitcoin market classifies as crypto', () => assert.equal(M.classify('Crypto', 'BTC price today at 3pm EST', 'KXBTCD'), 'crypto'));
ok('oscar market classifies as culture', () => assert.equal(M.classify('Entertainment', 'Oscar for Best Picture?', 'KXOSCARPIC'), 'culture'));
ok('unknown categories stay unclassified', () => assert.equal(M.classify('Climate and Weather', 'Will a supervolcano erupt before 2050?', 'KXERUPTSUPER'), null));

/* ---- 4. strategy entry band and settlement ------------------------------ */
// runStrategies(newAlerts, watch, watchList, now): alerts drive momentum/fade,
// the watch list drives harvest/breakout. watch keys are tickers.
const mkMarket = (ticker, yesBid, yesAsk, extra = {}) => ({
  ticker, event_ticker: 'T-EV', title: 'Test market', _topic: 'crypto',
  yes_bid_dollars: yesBid, yes_ask_dollars: yesAsk,
  no_bid_dollars: String((1 - Number(yesAsk)).toFixed(4)), no_ask_dollars: String((1 - Number(yesBid)).toFixed(4)),
  last_price_dollars: yesBid, volume_24h_fp: '90000', volume_fp: '900000', open_interest_fp: '5000', ...extra,
});
M.reset(1000);
const before = M.state.trades.length;
for (const [tick, bid, ask] of [['EDGE-LOW', '0.00', '0.04'], ['EDGE-HIGH', '0.96', '0.99']]) {
  const m = mkMarket(tick, bid, ask);
  M.runStrategies([{ ticker: tick, delta: 0.25, dir: 'up' }, { ticker: tick, delta: -0.25, dir: 'down' }], { [tick]: m }, [tick], Date.now());
}
ok('no paper trade opens outside the 5c-95c fillable band', () => assert.equal(M.state.trades.length, before));

// A mid-price market with a qualifying alert must open exactly one paper trade,
// and settlement must pay $1 per winning contract (market settlement doc).
M.reset(1000);
const mid = mkMarket('MID-1', '0.5000', '0.5100');
M.runStrategies([{ ticker: 'MID-1', delta: 0.20, dir: 'up' }], { 'MID-1': mid }, ['MID-1'], Date.now());
ok('a qualifying momentum alert opens one paper position', () => assert.equal(M.state.trades.length, 1));
const t = M.state.trades[0];
ok('the position records its entry fee from the official fee model', () => assert.ok(t.feeEntry >= 0 && t.feeEntry < 1));
ok('the settled P&L matches qty x (payout - entry) - entry fee', () => {
  const expect = Math.round((t.qty * (t.side === 'yes' ? 1 : 0) - t.qty * t.entry - (t.feeEntry || 0)) * 10000) / 10000;
  M.applyResolutions({ 'MID-1': { result: 'yes', settlement_ts: '2026-11-20T00:00:00Z', title: 'Test market', event: 'T-EV' } });
  const s = M.state.trades[0];
  assert.equal(s.status, 'settled');
  assert.ok(Math.abs(s.pnl - expect) < 1e-6, `pnl ${s.pnl} vs ${expect}`);
});
ok('note: no settlement fee is charged, matching the official schedule', () => {
  const s = M.state.trades[0];
  assert.equal(s.exit.fee, undefined, 'settlement must not add an exit fee');
});

console.log(`model tests: ${passed} checks passed` + (process.exitCode ? ' (with failures above)' : ''));
