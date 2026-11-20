#!/usr/bin/env node
/* Regression tests for three live-dashboard defects found and fixed in the
 * integration pass of session 6916270f (2026-11-20).
 *
 *   D1  alerts were built from the raw polled market, which carries no _topic,
 *       so every live alert lost its topic (no topic label in the chats, no
 *       topic on the stored alert).
 *   D2  only the first 200 watchlist tickers were ever polled, although the
 *       watchlist holds up to 400: everything past the 200th ticker kept its
 *       first-seen price forever (no alerts, no settlement detection).
 *   D3  only `finalized` markets were treated as resolved. The official market
 *       lifecycle also has `determined` (result known, settlement timer
 *       running) and `amended` (re-determined after a dispute) with an official
 *       yes/no result.
 *
 * Sources: https://docs.kalshi.com/getting_started/market_lifecycle
 * Run: node tests/live_fixes.test.mjs      (requires: npm install jsdom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const APP = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const MODEL = readFileSync(new URL('../assets/model.js', import.meta.url), 'utf8');
const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' — ' + (e && e.message)); }
}

const EVENT = {
  event_ticker: 'KXPGATOUR-THRC26', series_ticker: 'KXPGATOUR', title: 'The RSM Classic Winner',
  sub_title: '2026 The RSM Classic', category: 'Sports',
  settlement_sources: [{ name: 'ESPN', url: 'https://www.espn.com/' }],
};
function market(ticker, last, extra = {}) {
  return {
    ticker, event_ticker: EVENT.event_ticker, market_type: 'binary', title: 'The RSM Classic: X wins',
    yes_sub_title: 'X', no_sub_title: 'X', status: 'active', result: '',
    last_price_dollars: last, previous_price_dollars: last,
    yes_bid_dollars: last, yes_ask_dollars: last, no_bid_dollars: '0.0000', no_ask_dollars: '1.0000',
    yes_bid_size_fp: '10.00', yes_ask_size_fp: '10.00', volume_fp: '1000.00', volume_24h_fp: '500.00',
    open_interest_fp: '100.00', notional_value_dollars: '1.0000',
    close_time: '2026-12-06T00:00:00Z', open_time: '2026-11-16T01:34:34Z',
    price_level_structure: 'linear_cent', ...extra,
  };
}

const DASH = `<!doctype html><html><body><main><div id="kalshi-app" data-page="dashboard"></div></main></body></html>`;

function makeDom(state) {
  const dom = new JSDOM(DASH, { url: 'https://example.test/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.clear();
  const calls = [];
  window.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (!/^https?:/.test(u)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
    const p = new URL(u).pathname.replace('/trade-api/v2', '');
    let body = {};
    if (p === '/events') body = { events: [EVENT], cursor: '' };
    else if (p === '/markets') {
      const params = new URL(u).searchParams;
      if (params.get('event_ticker')) body = { markets: state.eventMarkets, cursor: '' };
      else body = { markets: state.quoteMarkets, cursor: '' };
    } else if (p.endsWith('/orderbook')) {
      body = { orderbook_fp: { yes_dollars: [['0.5000', '100.00']], no_dollars: [['0.3000', '50.00']] } };
    } else if (p === '/markets/trades') body = { trades: [], cursor: '' };
    else if (p === '/series') body = { series: [{ ticker: 'KXPGATOUR', title: 'PGA Tour', category: 'Sports', categories: ['Sports'], volume_fp: '10.00' }] };
    else if (p.includes('/candlesticks')) body = { candlesticks: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
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

await test('D1 — a live alert carries the topic of its market', async () => {
  const state = {
    eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
    quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
  };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 250));
  // the price jumps 15 cents on the next poll -> a >= $0.10 alert must fire
  state.quoteMarkets = [market('KXPGATOUR-THRC26-SSTR', '0.7500')];
  window.KalshiApp.pollWatch();
  await new Promise(r => setTimeout(r, 250));
  const alerts = window.KalshiModel.state.alerts;
  assert.ok(alerts.length >= 1, 'no alert was raised for a 15-cent move');
  assert.equal(alerts[alerts.length - 1].topic, 'golf', 'the alert lost its topic (got ' + JSON.stringify(alerts[alerts.length - 1].topic) + ')');
  const chat = window.document.querySelector('#kx-chat-all').textContent;
  assert.ok(/Golf/.test(chat), 'the topic label is missing from the alert chat');
});

await test('D2 — one poll cycle requests every chunk of the watchlist', async () => {
  const state = { eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')], quoteMarkets: [] };
  const { window, calls } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 250));
  const app = window.KalshiApp;
  const N = 250;
  app.state.list = [];
  for (let i = 0; i < N; i++) {
    const t = 'KXPGATOUR-THRC26-M' + i;
    app.state.watch[t] = market(t, '0.6000');
    app.state.list.push(t);
  }
  calls.length = 0;
  app.pollWatch();
  await new Promise(r => setTimeout(r, 250));
  const tickerCalls = calls.filter(c => c.includes('/markets?tickers='));
  const requested = new Set();
  for (const c of tickerCalls) {
    const raw = new URL(c).searchParams.get('tickers') || '';
    for (const t of raw.split(',')) if (t) requested.add(t);
  }
  assert.ok(tickerCalls.length >= 2, 'the watchlist was sent in a single request (' + tickerCalls.length + ')');
  assert.equal(requested.size, N, 'only ' + requested.size + ' of ' + N + ' tickers were polled');
});

await test('D3 — a `determined` market with an official result counts as resolved', async () => {
  const state = {
    eventMarkets: [
      market('KXPGATOUR-THRC26-SSTR', '0.6000'),
      market('KXPGATOUR-THRC26-BHAA', '0.1000', { status: 'determined', result: 'yes', settlement_ts: '2026-11-20T20:00:00.000Z' }),
    ],
    quoteMarkets: [
      market('KXPGATOUR-THRC26-SSTR', '0.6000'),
      market('KXPGATOUR-THRC26-BHAA', '0.1000', { status: 'determined', result: 'yes', settlement_ts: '2026-11-20T20:00:00.000Z' }),
    ],
  };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 400));
  const resolved = window.KalshiModel.state.resolved;
  assert.ok(resolved['KXPGATOUR-THRC26-BHAA'], 'a determined market with result=yes was not recorded as resolved');
  assert.equal(resolved['KXPGATOUR-THRC26-BHAA'].result, 'yes');
  const table = window.document.querySelector('#kx-resolved').textContent;
  assert.ok(/YES/.test(table), 'the resolved table does not show the outcome');
});

console.log('\n' + passed + ' passed, ' + failures + ' failed');
// jsdom windows keep timers alive; exit explicitly so the check can run in CI.
process.exit(failures ? 1 : 0);
