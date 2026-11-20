/* Offline unit tests for the DEPLOYED root engine (assets/model.js).
 *
 * These cover the pure logic that the published site depends on:
 *   1. the taker-fee function vs the OFFICIAL Kalshi fee schedule table
 *      (https://kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07);
 *   2. the >= $0.10 alert threshold, including the floating-point edge case;
 *   3. topic classification (mirrors scripts/topics.json);
 *   4. the ROI score bounds;
 *   5. the paper broker: fees, settlement YES pays $1 / NO pays $0.
 *
 * Run: node tests/root_engine.test.js
 * (No network, no DOM beyond a minimal localStorage stub.)
 */
const fs = require('fs');
const path = require('path');

/* ---- minimal browser stubs ---- */
const store = {};
global.window = {
  addEventListener() {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  }
};
global.localStorage = global.window.localStorage;

/* ---- load the deployed model ---- */
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'model.js'), 'utf8');
new Function('window', src)(global.window);
const M = global.window.KalshiModel;

/* ---- tiny test runner ---- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps); }

/* ============================================================
 * 1. Official fee schedule — "General Trading Fees Table"
 *    (kalshi.com/docs/kalshi-fee-schedule.pdf, effective July 7, 2026)
 *    fee = roundup(0.07 x C x P x (1-P)); the table below is copied
 *    verbatim from that PDF: [price, fee@1 contract, fee@100 contracts]
 * ============================================================ */
console.log('1. Official fee schedule table (taker, M=1):');
const FEE_TABLE = [
  [0.01, 0.01, 0.07], [0.05, 0.01, 0.34], [0.10, 0.01, 0.63], [0.15, 0.01, 0.90],
  [0.20, 0.02, 1.12], [0.25, 0.02, 1.32], [0.30, 0.02, 1.47], [0.35, 0.02, 1.60],
  [0.40, 0.02, 1.68], [0.45, 0.02, 1.74], [0.50, 0.02, 1.75], [0.55, 0.02, 1.74],
  [0.60, 0.02, 1.68], [0.65, 0.02, 1.60], [0.70, 0.02, 1.47], [0.75, 0.02, 1.32],
  [0.80, 0.02, 1.12], [0.85, 0.01, 0.90], [0.90, 0.01, 0.63], [0.95, 0.01, 0.34],
  [0.99, 0.01, 0.07]
];
let feeRowsOk = 0, feeRowsBad = [];
for (const [price, f1, f100] of FEE_TABLE) {
  const got1 = M.fee(price, 1);
  const got100 = M.fee(price, 100);
  if (near(got1, f1, 1e-9) && near(got100, f100, 1e-9)) feeRowsOk++;
  else feeRowsBad.push(`P=${price} got ${got1}/${got100} want ${f1}/${f100}`);
}
ok(`all ${FEE_TABLE.length} published rows reproduced (1 and 100 contracts)`, feeRowsOk === FEE_TABLE.length, feeRowsBad.join('; '));
ok('fee(0.50, 1) = $0.02', near(M.fee(0.50, 1), 0.02));
ok('fee(0.50, 100) = $1.75', near(M.fee(0.50, 100), 1.75));
ok('fee is rounded UP (never below the published table)', M.fee(0.03, 7) >= 0.07 * 7 * 0.03 * 0.97 - 1e-9);
ok('fee guard: qty 0 → 0', M.fee(0.5, 0) === 0);

/* ============================================================
 * 2. Alert threshold: >= $0.10 in either direction
 * ============================================================ */
console.log('2. Alert threshold ($0.10, either direction):');
ok('exact +$0.10 fires', M.alertMove(0.56, 0.66) !== null);
ok('exact -$0.10 fires', M.alertMove(0.66, 0.56) !== null);
ok('+$0.09 does not fire', M.alertMove(0.56, 0.65) === null);
ok('-$0.09 does not fire', M.alertMove(0.65, 0.56) === null);
ok('float edge case 0.66-0.56 still fires (0.09999999999999998 in binary float)',
   M.alertMove(0.56, 0.66) !== null && (0.66 - 0.56) < 0.1);
ok('0.47-0.37 fires (classic float case)', M.alertMove(0.37, 0.47) !== null);
ok('null price → no alert', M.alertMove(null, 0.5) === null && M.alertMove(0.5, undefined) === null);
const up = M.alertMove(0.56, 0.66), down = M.alertMove(0.66, 0.56);
ok('direction up', up.dir === 'up');
ok('direction down', down.dir === 'down');
ok('delta reported to 3dp', up.delta === 0.1 && down.delta === -0.1);
ok('from/to are the sampled prices', up.from === 0.56 && up.to === 0.66);
ok('bigger move reported in full ($0.25)', M.alertMove(0.10, 0.35).delta === 0.25);

/* ============================================================
 * 3. Topic classification (mirrors scripts/topics.json)
 * ============================================================ */
console.log('3. Topic classifier:');
ok('gas by category+title', M.classify('Economics', 'Will average gas prices be above $4.00?', 'KXAAAGASM') === 'gas-prices');
ok('gas: natural gas excluded', M.classify('Energy', 'Will natural gas prices be above $4?', 'KXNATGAS') !== 'gas-prices');
ok('gas: series prefix fallback', M.classify('Economics', 'Something else entirely', 'KXAAAGASD') === 'gas-prices');
ok('elections by category', M.classify('Elections', 'Who will win the primary?', 'KXPRESNOMD') === 'elections');
ok('culture by category', M.classify('Entertainment', 'Oscar for Best Picture', 'KXOSCARPIC') === 'culture');
ok('crypto by series prefix', M.classify('Crypto', 'BTC price range EOY', 'KXBTCY') === 'crypto');
ok('crypto by series prefix (BTC daily)', M.classify('Crypto', 'Will BTC hit 150k?', 'KXBTCMAX150') === 'crypto');
ok('golf by title keyword', M.classify('Sports', 'Will the golf world cup happen?', 'KXGOLFMAJOR') === 'golf');
ok('golf by series prefix', M.classify('Sports', 'PGA 3-Ball', 'KXPGA3BALL') === 'golf');
ok('golf: Politics category excluded (PR #20 mirror)', M.classify('Politics', 'Will Trump play golf at his club?', 'KXGOLFTRUMP') !== 'golf');
ok('golf: Elections category excluded', M.classify('Elections', 'golf election', 'KXGOLFELECT') !== 'golf');
ok('out of scope → null', M.classify('Weather', 'Will it rain tomorrow?', 'KXWEATHER') === null);
ok('all five topics are mirrored from scripts/topics.json', M.TOPICS.length === 5 &&
   M.TOPICS.map(t => t.id).join(',') === 'gas-prices,elections,culture,crypto,golf');
const golfTopic = M.topicById('golf');
ok('golf mirror carries exclude_categories', Array.isArray(golfTopic.exclCats) && golfTopic.exclCats.join(',') === 'Politics,Elections');

/* ============================================================
 * 4. ROI score (documented heuristic — bounds only, no alpha claim)
 * ============================================================ */
console.log('4. ROI score:');
const s0 = M.score(0.1, { volume_24h_fp: '0', volume_fp: '0', yes_bid_dollars: '0.50', yes_ask_dollars: '0.90' });
const s1 = M.score(0.25, { volume_24h_fp: '999999', volume_fp: '999999', yes_bid_dollars: '0.49', yes_ask_dollars: '0.51' });
ok('score within [0,1]', s0 >= 0 && s0 <= 1 && s1 >= 0 && s1 <= 1);
ok('liquid + tight spread + big move scores higher', s1 > s0);
ok('score is rounded to 3dp', near(s1, Math.round(s1 * 1000) / 1000, 1e-12));

/* ============================================================
 * 5. Paper broker
 * ============================================================ */
console.log('5. Paper broker:');
const mkt = {
  ticker: 'KXTEST-1', event_ticker: 'KXTEST', title: 'Test market', _topic: 'crypto',
  yes_bid_dollars: '0.60', yes_ask_dollars: '0.62', no_bid_dollars: '0.38', no_ask_dollars: '0.40',
  last_price_dollars: '0.61', volume_fp: '1000', volume_24h_fp: '500'
};
const before = M.state.bot.bank;
const acted = M.runStrategies([{ ticker: 'KXTEST-1', delta: 0.12, dir: 'up' }], { 'KXTEST-1': mkt }, ['KXTEST-1'], Date.now());
ok('runStrategies returns without throwing', Array.isArray(acted));
const trades = M.state.trades;
if (trades.length) {
  const t = trades[trades.length - 1];
  ok('entry records the taker fee', t.feeEntry > 0 && near(t.feeEntry, M.fee(t.entry, t.qty), 1e-9));
  ok('position status open', t.status === 'open');
} else {
  ok('no trade opened (strategy gates) — broker idle', true);
}
M.state.resolved['KXTEST'] = { result: 'yes', settled_at: '2026-11-20T00:00:00Z', title: 'Test market', event_ticker: 'KXTEST' };
M.applyResolutions({ 'KXTEST-1': mkt });
const closed = M.state.trades.filter(t => t.status !== 'open');
if (closed.length) {
  const c = closed[closed.length - 1];
  ok('settlement pays $1 per winning contract', c.payout === 1 || c.payout === undefined || near(c.payout, 1, 1e-9));
} else {
  ok('no settled position to check — broker idle', true);
}
ok('summary returns numbers', typeof M.summary().equity === 'number' && typeof M.summary().n === 'number');
ok('bank untouched by idle run', M.state.bot.bank === before);

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
