/* Unit tests for the site engine's pure logic, run in Node with DOM/network stubs.
 * Fee expectations are taken from the OFFICIAL Kalshi fee schedule table
 * (https://kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07).
 * Run: node tests/engine.test.js  */
const fs = require('fs');
const path = require('path');

/* ---- minimal browser stubs ---- */
const listeners = {};
const elements = new Map();
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', value: '', style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, onclick: null,
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => new Proxy({}, { get: () => () => {} }),
    parentElement: { getBoundingClientRect: () => ({ width: 800, height: 300 }) },
    getBoundingClientRect: () => ({ width: 800, height: 300 }),
    dataset: {}, href: '', click(){}, appendChild(){}
  };
}
global.window = {
  addEventListener: (t, fn) => { (listeners['w:' + t] = listeners['w:' + t] || []).push(fn); },
  devicePixelRatio: 1,
  location: { origin: 'https://test.local', pathname: '/live.html' }
};
global.location = global.window.location;
global.document = {
  body: { dataset: { page: 'live' } },
  addEventListener: (t, fn) => { (listeners['d:' + t] = listeners['d:' + t] || []).push(fn); },
  getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
  querySelectorAll: () => [], createElement: () => makeEl('tmp')
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.fetch = async () => { throw new Error('network disabled in tests'); };
global.AbortController = class { constructor(){ this.signal = {}; } abort(){} };

/* ---- load engine ---- */
const src = fs.readFileSync(path.join(__dirname, '..', 'monitor', 'assets', 'app.js'), 'utf8');
global.URL = URL; global.Blob = class {}; setTimeout(() => {}, 0);
eval(src);
const K = global.window.__KDM__;
if (!K) throw new Error('engine did not expose __KDM__');

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

console.log('1. Official fee-schedule table (taker, M=1):');
eq('fee(1 contract @$0.10) = $0.01', K.takerFee(0.10, 1), 0.01);
approx('fee(100 contracts @$0.50) = $1.75', K.takerFee(0.50, 100), 1.75);
approx('fee(100 contracts @$0.05) = $0.34', K.takerFee(0.05, 100), 0.34);
approx('fee(100 contracts @$0.99) = $0.07', K.takerFee(0.99, 100), 0.07);
approx('fee(100 contracts @$0.20) = $1.12', K.takerFee(0.20, 100), 1.12);
approx('fee(1 contract @$0.50) = $0.02', K.takerFee(0.50, 1), 0.02);
eq('maker fee on quadratic series = $0', K.makerFee(0.5, 100), 0);
eq('fee guards: qty 0 → 0', K.takerFee(0.5, 0), 0);

console.log('2. Parsing & hydration:');
const raw = {
  ticker: 'TEST-1', event_ticker: 'EV-1', title: 'Test market',
  last_price_dollars: '0.4500', yes_bid_dollars: '0.4400', yes_ask_dollars: '0.4600',
  yes_bid_size_fp: '10.00', yes_ask_size_fp: '20.00', volume_fp: '1000.00',
  volume_24h_fp: '100.00', open_interest_fp: '500.00', previous_price_dollars: '0.4000',
  no_bid_dollars: '0.5400', no_ask_dollars: '0.5600', status: 'active', result: ''
};
const m = K.hydrateMarket(raw);
approx('last parsed', m.last, 0.45);
approx('mid parsed', m.mid, 0.45);
approx('spread parsed', m.spread, 0.02, 1e-9);
approx('est dollars = volume × last', m.estDollars, 450, 1e-9);
approx('est OI = oi × mid', m.estOI, 225, 1e-9);
eq('null price → null (never 0)', K.hydrateMarket({ ticker: 'X', event_ticker: 'E' }).last, null);

console.log('3. Alert engine ($0.10 threshold):');
K.state.settings.threshold = 0.10;
const m2 = K.hydrateMarket({ ...raw, last_price_dollars: '0.5600' });
K.checkAlerts(m2, 0.45);            // +0.11 → must alert
eq('up-alert recorded', K.state.alerts.filter(a => a.ticker === 'TEST-1' && a.kind === 'up').length, 1);
K.checkAlerts(m2, 0.50);            // +0.06 → below threshold → no new alert
eq('no alert below threshold', K.state.alerts.filter(a => a.ticker === 'TEST-1').length, 1);
K.checkAlerts(m2, 0.66);            // cooldown active (just alerted) → suppressed
eq('cooldown suppresses immediate re-alert', K.state.alerts.filter(a => a.ticker === 'TEST-1').length, 1);
m2.lastAlertTs = Date.now() - 60000; // age the cooldown
K.checkAlerts(m2, 0.66);            // 0.66 → 0.56 = $0.10 move → new alert
eq('second alert after cooldown', K.state.alerts.filter(a => a.ticker === 'TEST-1').length, 2);
const m3 = K.hydrateMarket({ ...raw, ticker: 'TEST-2', last_price_dollars: '0.3000', previous_price_dollars: '0.4200' });
K.checkAlerts(m3, null);            // no observed history; exchange-reported −0.12 → alert
eq('exchange-reported signal fires', K.state.alerts.filter(a => a.ticker === 'TEST-2' && a.src === 'exchange-reported').length, 1);

console.log('4. Topic classifier:');
K.state.seriesSets = { crypto: new Set(['KXBTCD']), golf: new Set(['KXPGA3BALL']), gas: new Set(['KXGAS', 'KXAAAGASM']) };
eq('crypto by series whitelist', K.topicOf({ series_ticker: 'KXBTCD', title: 'Bitcoin price on Nov 21, 2026?' }), 'crypto');
eq('crypto by keyword', K.topicOf({ series_ticker: 'OTHER', title: 'Will ethereum hit $10,000?' }), 'crypto');
eq('golf by tags whitelist', K.topicOf({ series_ticker: 'KXPGA3BALL', title: 'PGA 3-Ball' }), 'golf');
eq('gas by prefix', K.topicOf({ series_ticker: 'KXGASX-NEW', title: 'Gas weekly' }), 'gas');
eq('elections by category', K.topicOf({ series_ticker: 'ZZZ', category: 'Elections', title: 'Special election' }), 'elections');
eq('culture by category', K.topicOf({ series_ticker: 'ZZZ', category: 'Culture', title: 'Something else' }), 'culture');
eq('out-of-scope → null', K.topicOf({ series_ticker: 'KXNFLGAME', category: 'Sports', title: 'NFL game' }), null);

console.log('5. Paper bot P&L:');
K.state.settings.botOn = true; K.state.settings.bankroll = 10000; K.state.settings.riskPct = 2;
const bm = K.hydrateMarket({ ...raw, ticker: 'BOT-1', event_ticker: 'EV-B', yes_ask_dollars: '0.4600', yes_ask_size_fp: '50.00' });
bm._topic = 'crypto';
K.state.positions = []; K.state.closed = [];
K.enter(bm, 'YES', 0.46, 'momentum', 'Momentum Rider', 'test entry');
const pos = K.state.positions[0];
approx('entry fee = takerFee(0.46, qty)', pos.feeEntry, K.takerFee(0.46, pos.qty));
eq('position open', pos.status, 'open');
pos.mark = 0.54;
K.closePos(pos, 0.54, 'target', K.takerFee(0.54, pos.qty));
const closed = K.state.closed[0];
approx('gross pnl', closed.pnl + closed.feeEntry + closed.feeExit, (0.54 - 0.46) * closed.qty, 1e-9);
eq('closed status', closed.status, 'closed');
// settlement payout: YES position with result yes → exit 1
const bm2 = K.hydrateMarket({ ...raw, ticker: 'BOT-2', event_ticker: 'EV-B' });
bm2._topic = 'crypto';
K.state.positions = []; K.state.closed = [];
K.enter(bm2, 'YES', 0.05, 'extreme', 'Extreme Value', 'test');
K.settlePositions('BOT-2', 'yes');
eq('settled YES pays $1', K.state.closed[0].exit, 1);
K.enter(bm2, 'YES', 0.05, 'extreme', 'Extreme Value', 'test2');
K.settlePositions('BOT-2', 'no');
eq('settled NO pays $0', K.state.closed[K.state.closed.length - 1].exit, 0);

console.log('6. Model scoring sanity:');
const m4 = K.hydrateMarket({ ...raw, ticker: 'TEST-1', yes_bid_dollars: '0.4900', yes_ask_dollars: '0.5100' });
K.state.samples.set('TEST-1', [
  { t: 1, mid: 0.45 }, { t: 2, mid: 0.46 }, { t: 3, mid: 0.47 }, { t: 4, mid: 0.48 }
]);
K.state.markets.set('TEST-1', m4);
const sc = K.scoreMarket(m4);
eq('score present & in range', sc.score >= 0 && sc.score <= 1, true);
eq('direction up', sc.dir, 'up');

console.log('7. Portfolio stats grouping:');
K.state.positions = []; K.state.closed = closed ? [closed] : [];
const st = K.portfolioStats();
eq('closed count', st.closed, 1);
eq('equity numeric', typeof st.equity, 'number');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
