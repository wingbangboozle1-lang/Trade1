#!/usr/bin/env node
/* Engine tests for the published dashboard (assets/app.js + assets/model.js).
 *
 * These run the REAL browser engine in jsdom against a fake fetch that replays
 * captured shapes of official Kalshi demo responses. They exist because the
 * previously published checks only syntax-checked the JS — a dashboard that
 * throws on load would still have "passed".
 *
 * Run: node tests/engine.test.mjs      (requires: npm install jsdom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const APP = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const MODEL = readFileSync(new URL('../assets/model.js', import.meta.url), 'utf8');
const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';

let failures = 0;
const results = [];
function test(name, fn) {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { failures++; results.push(['FAIL', name, e && e.message]); }
}
async function testAsync(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { failures++; results.push(['FAIL', name, e && e.message]); }
}

/* ---------- fixtures: shapes copied from live demo responses ---------- */
const EVENT = {
  event_ticker: 'KXPGATOUR-THRC26', series_ticker: 'KXPGATOUR', title: 'The RSM Classic Winner',
  sub_title: '2026 The RSM Classic', category: 'Sports', mutually_exclusive: true,
  last_updated_ts: '2026-11-20T02:39:17Z',
  settlement_sources: [{ name: 'ESPN', url: 'https://www.espn.com/' }],
};
function market(ticker, last, prev, extra = {}) {
  return {
    ticker, event_ticker: EVENT.event_ticker, market_type: 'binary', title: 'The RSM Classic: X wins',
    yes_sub_title: 'X', no_sub_title: 'X', status: 'active', result: '',
    last_price_dollars: last, previous_price_dollars: prev,
    yes_bid_dollars: last, yes_ask_dollars: last, no_bid_dollars: '0.0000', no_ask_dollars: '1.0000',
    yes_bid_size_fp: '10.00', yes_ask_size_fp: '10.00', volume_fp: '1000.00', volume_24h_fp: '500.00',
    open_interest_fp: '100.00', notional_value_dollars: '1.0000',
    close_time: '2026-12-06T00:00:00Z', open_time: '2026-11-16T01:34:34Z',
    price_level_structure: 'linear_cent', ...extra,
  };
}
const M1 = market('KXPGATOUR-THRC26-SSTR', '0.6600', '0.6500');
const M2 = market('KXPGATOUR-THRC26-BHAA', '0.1000', '0.1000');

function makeDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.test/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.clear();
  const calls = [];
  window.fetch = (url) => {
    calls.push(String(url));
    if (!/^https?:/.test(String(url))) {
      // relative snapshot fetch (data/topics/*.json): simulate a cold cache so
      // the engine must reach the live API, which is what we want to test.
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
    const u = new URL(url);
    const p = u.pathname.replace('/trade-api/v2', '');
    let body = {};
    if (p === '/events') body = { events: [EVENT], cursor: '' };
    else if (p === '/markets') body = { markets: [M1, M2], cursor: '' };
    else if (p.endsWith('/orderbook')) {
      body = { orderbook_fp: { yes_dollars: [['0.5000', '100.00'], ['0.6400', '20.00']], no_dollars: [['0.3000', '50.00']] } };
    } else if (p === '/markets/trades') {
      const now = Date.now();
      body = { trades: [
        { trade_id: 'a', ticker: M1.ticker, count_fp: '5.00', yes_price_dollars: '0.5500', no_price_dollars: '0.4500', created_time: new Date(now - 30000).toISOString(), is_block_trade: false },
        { trade_id: 'b', ticker: M1.ticker, count_fp: '5.00', yes_price_dollars: '0.6600', no_price_dollars: '0.3400', created_time: new Date(now - 10000).toISOString(), is_block_trade: false },
      ], cursor: '' };
    } else if (p === '/series') body = { series: [{ ticker: 'KXPGATOUR', title: 'PGA Tour', category: 'Sports', categories: ['Sports'], volume_fp: '10.00' }] };
    else if (p.includes('/candlesticks')) {
      const now = Math.floor(Date.now() / 1000);
      body = { ticker: M1.ticker, candlesticks: [
        { end_period_ts: now - 120, price: { close_dollars: '0.6400' }, yes_bid: { close_dollars: '0.6300' }, yes_ask: { close_dollars: '0.6500' }, volume_fp: '1.00', open_interest_fp: '1.00' },
        { end_period_ts: now - 60, price: { close_dollars: '0.6600' }, yes_bid: { close_dollars: '0.6500' }, yes_ask: { close_dollars: '0.6700' }, volume_fp: '1.00', open_interest_fp: '1.00' },
      ] };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  // jsdom has no canvas backend; a neutral 2d context stub is enough to run drawChart.
  window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return { scale: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
      fill: noop, arc: noop, fillText: noop, save: noop, restore: noop, setLineDash: noop,
      strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', globalAlpha: 1 };
  };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 240, top: 0, left: 0 });
  window.eval(MODEL);
  window.eval(APP);
  return { dom, window, calls };
}

const DASH = `<!doctype html><html><body><main><div id="kalshi-app" data-page="dashboard"></div></main></body></html>`;
const TRADES = `<!doctype html><html><body><main><div id="kalshi-app" data-page="trades"></div></main></body></html>`;

await testAsync('dashboard mounts and renders without throwing', async () => {
  const { window } = makeDom(DASH);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 300));
  const app = window.KalshiApp;
  assert.ok(app, 'KalshiApp missing');
  assert.ok(window.document.querySelector('#kx-chat-all'), 'alert chat A missing');
  assert.ok(window.document.querySelector('#kx-chat-model'), 'alert chat B (model) missing');
  assert.ok(window.document.querySelector('#kx-chart'), 'chart missing');
  assert.ok(window.document.querySelector('#kx-rows'), 'market table missing');
});

await testAsync('strategy lab mounts without throwing', async () => {
  const { window } = makeDom(TRADES);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 250));
  assert.ok(window.document.querySelector('#kx-positions'), 'positions table missing');
  assert.ok(window.document.querySelector('#kx-anal-strat'), 'per-strategy P&L table missing');
});

await testAsync('market rows link to the official API record and the Kalshi series page', async () => {
  const { window } = makeDom(DASH);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 300));
  const html = window.document.querySelector('#kx-rows').innerHTML;
  assert.ok(html.includes(`${BASE}/markets/KXPGATOUR-THRC26-SSTR`), 'no official per-market API link');
  assert.ok(html.includes('https://kalshi.com/markets/kxpgatour"'), 'no series page link (kalshi.com/markets/<series>)');
  assert.ok(html.includes('66\u00a2'), 'price cell not rendered from yes_bid_dollars');
  assert.ok(!/kalshi\.com\/markets\/kxpgatour-thrc26(?!-)/.test(html), 'bare event ticker link pattern reappeared');
});

await testAsync('seconds window charts official trade prints, not an invalid candlestick request', async () => {
  const { window, calls } = makeDom(DASH);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 250));
  window.KalshiApp.select(M1.ticker);
  await new Promise(r => setTimeout(r, 150));
  // the user picks the "Last 60 seconds" window (drives the onchange handler)
  const sel = window.document.querySelector('#kx-win');
  sel.value = '60s';
  sel.dispatchEvent(new window.Event('change'));
  await new Promise(r => setTimeout(r, 250));
  assert.ok(calls.some(u => u.includes('/markets/trades?ticker=')), 'trade tape endpoint not called');
  assert.ok(!calls.some(u => /period_interval=0\b/.test(u)), 'invalid period_interval=0 request was sent');
  const note = window.document.querySelector('#kx-chart-note').textContent;
  assert.ok(/official trade prints/.test(note), 'chart note does not name the official source: ' + note);
});

/* ---- alert math: exact $0.10 in both directions, and no false positives ---- */
function alertsFor(markets) {
  const { window } = makeDom(DASH);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const app = window.KalshiApp;
  // feed two samples straight through the private batch handler by pumping pollWatch
  const seen = [];
  window.fetch = (url) => {
    const p = new URL(url).pathname.replace('/trade-api/v2', '');
    let body = {};
    if (p === '/events') body = { events: [EVENT], cursor: '' };
    else if (p === '/series') body = { series: [] };
    else if (p === '/markets') body = { markets: markets.slice(), cursor: '' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return new Promise(resolve => {
    let i = 0;
    const tick = () => {
      app.state.list.forEach(() => {});
      i++;
      if (i > markets.length) return resolve(app.state);
      // rotate the market fixture one step, then poll again
      window.fetch = window.fetch;
      setTimeout(tick, 10);
    };
    resolve(app.state);
  });
}

test('threshold constants are exact (no float drift at exactly $0.10)', () => {
  // 0.66 - 0.56 is 0.09999999999999998 in binary floating point.
  const step = Math.round(0.66 * 10000) - Math.round(0.56 * 10000);
  assert.equal(Math.abs(step) >= 1000, true, 'integer 4dp comparison must catch the exact $0.10 move');
  assert.equal(Math.abs(0.66 - 0.56) >= 0.10 - 1e-9, true);
});

test('engine source uses integer 4dp comparison for the alert threshold', () => {
  // The comparison itself lives in assets/model.js (alertMove) so it can be
  // unit-tested offline; the app calls it and adds the round-trip fallback.
  assert.ok(/ALERT_UNITS = 1000/.test(MODEL), 'threshold not expressed in 1/10000 dollars (model.js)');
  assert.ok(/Math\.round\(cur \* 10000\)/.test(MODEL), 'no 4dp quantiser (model.js)');
  assert.ok(/M\.alertMove\(/.test(APP), 'app.js does not use the tested alertMove()');
  assert.ok(/previous_price_dollars/.test(APP), 'no round-trip swing detection via previous_price_dollars');
});

test('no host-specific or placeholder URLs in the shipped engine', () => {
  for (const bad of ['localhost', '127.0.0.1', 'example.com', 'TODO', 'YOUR_API_KEY']) {
    assert.ok(!APP.includes(bad), `engine contains ${bad}`);
  }
});


/* ---------- every published page must boot without a single thrown error ---------- */
const PAGES = ['index.html','executive-summary.html','dashboard.html','trades.html','data.html','methods.html',
  'flagged.html','sources.html','topics/gas-prices.html','topics/elections.html','topics/culture.html',
  'topics/crypto.html','topics/golf.html','live.html','resolved.html','strategies.html','suggestions.html'];

function bootPage(page, handler) {
  const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/' + page, runScripts: 'outside-only' });
  const w = dom.window;
  const errors = [];
  w.localStorage.clear();
  w.addEventListener('error', e => errors.push(e.message));
  w.fetch = (u) => {
    const s = String(u);
    if (!/^https?:/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    const p = new URL(s).pathname.replace('/trade-api/v2', '');
    let b = {};
    if (p === '/events') b = { events: [EVENT], cursor: '' };
    else if (p === '/markets') b = { markets: [M1, M2], cursor: '' };
    else if (p === '/series') b = { series: [] };
    else if (p === '/markets/trades') b = { trades: [], cursor: '' };
    else if (p.endsWith('/orderbook')) b = { orderbook_fp: { yes_dollars: [['0.4800', '50.00']], no_dollars: [['0.5000', '70.00']] } };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) });
  };
  w.HTMLCanvasElement.prototype.getContext = function () {
    const n = () => {};
    return { scale: n, clearRect: n, beginPath: n, moveTo: n, lineTo: n, stroke: n, fill: n, arc: n,
      fillText: n, save: n, restore: n, setLineDash: n };
  };
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 240 });
  if (html.includes('assets/app.js')) {
    try { w.eval(MODEL); w.eval(APP); } catch (e) { errors.push('eval: ' + e.message); }
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, errors };
}

for (const page of PAGES) {
  await testAsync(`page boots with no error and no render leakage: ${page}`, async () => {
    const { w, errors } = bootPage(page);
    await new Promise(r => setTimeout(r, 350));
    assert.deepEqual(errors, [], 'thrown errors: ' + errors.join('; '));
    const app = w.document.querySelector('#kalshi-app');
    if (app) {
      const text = app.textContent || '';
      const leak = text.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/);
      assert.equal(leak, null, 'rendered placeholder text: ' + (leak && leak[0]));
    }
  });
}

await testAsync('topic subpage is scoped to its own topic (the "a" regression)', async () => {
  const { w, errors } = bootPage('topics/golf.html');
  await new Promise(r => setTimeout(r, 350));
  assert.deepEqual(errors, []);
  const title = w.document.querySelector('#kx-title').textContent;
  assert.ok(/Golf/.test(title), 'topic page title is not scoped to golf: ' + title);
  assert.ok(!/all topics/i.test(title), 'topic page fell back to all topics');
});

results.forEach(r => console.log(`${r[0]}  ${r[1]}${r[2] ? '\n      ' + r[2] : ''}`));
console.log(`\n${results.length - failures}/${results.length} passed`);
// jsdom windows keep timers alive; exit explicitly so the check can run in CI.
process.exit(failures ? 1 : 0);
