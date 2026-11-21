#!/usr/bin/env node
/* Regression tests for the live-dashboard defects repaired in session
 * `arena/aa7d3d27-trade1` (2026-11-21). Each test drives the REAL engine
 * (assets/app.js + assets/model.js) in jsdom against fixtures shaped from
 * official demo-API responses, and each rule is pinned to an official doc page.
 *
 *   A1  a market that closed (`status: closed` / `inactive` / `determined` /
 *       `finalized`) kept feeding the price sampler, so its frozen quote
 *       produced phantom "-$0.10" swing alerts and the paper broker could
 *       "fill" an exit at a stale bid.
 *   A2  the market table ranked closed markets ahead of markets a trader can
 *       actually trade; there was no status column, no best-price column and no
 *       resting-size column, and the KPI row had no "live now" count.
 *   A3  the order-book ladder printed only the last 6 array entries per side
 *       (the levels nearest the best bid) and never showed how many contracts
 *       sit at each price or what sweeping them costs.
 *   A4  a series sweep could not add settlement_sources to an event the
 *       /events call had already created, so the alert/source links lost the
 *       official settlement sources the Get Series schema publishes.
 *   A5  the alert chats were empty on first load even though alerts captured in
 *       earlier sessions were still in localStorage (no session note, no board).
 *
 * Sources (read 2026-11-21):
 *   https://docs.kalshi.com/getting_started/market_lifecycle
 *   https://docs.kalshi.com/getting_started/orderbook_responses
 *   https://docs.kalshi.com/api-reference/market/get-markets
 *   https://docs.kalshi.com/api-reference/market/get-series
 *   https://docs.kalshi.com/api-reference/market/get-series-list
 *
 * Run: node tests/live_dash.test.mjs      (requires: npm install jsdom)
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
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const EVENT = {
  event_ticker: 'KXPGATOUR-THRC26', series_ticker: 'KXPGATOUR', title: 'The RSM Classic Winner',
  sub_title: '2026 The RSM Classic', category: 'Sports',
  settlement_sources: [{ name: 'ESPN', url: 'https://www.espn.com/' }],
};
/* A market object with the exact field names of the official Get Markets schema. */
function market(ticker, last, extra = {}) {
  return {
    ticker, event_ticker: EVENT.event_ticker, series_ticker: 'KXPGATOUR', market_type: 'binary',
    title: 'The RSM Classic: X wins', yes_sub_title: 'X', no_sub_title: 'X',
    status: 'active', result: '',
    last_price_dollars: last, previous_price_dollars: last,
    yes_bid_dollars: last, yes_ask_dollars: last, no_bid_dollars: '0.0000', no_ask_dollars: '1.0000',
    yes_bid_size_fp: '100.00', yes_ask_size_fp: '120.00',
    volume_fp: '1000.00', volume_24h_fp: '500.00', open_interest_fp: '100.00',
    close_time: '2026-12-06T00:00:00Z', open_time: '2026-11-16T01:34:34Z',
    price_level_structure: 'linear_cent', ...extra,
  };
}

const DASH = '<!doctype html><html><body><main><div id="kalshi-app" data-page="dashboard"></div></main></body></html>';

function makeDom(state) {
  const dom = new JSDOM(DASH, { url: 'https://example.test/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.clear();
  const calls = [];
  if (state.seedAlerts) {
    window.localStorage.setItem('kalshiDemo.v2.alerts', JSON.stringify(state.seedAlerts));
  }
  window.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (!/^https?:/.test(u)) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
    const p = new URL(u).pathname.replace('/trade-api/v2', '');
    const params = new URL(u).searchParams;
    let body = {};
    if (p === '/events') body = { events: state.events || [EVENT], cursor: '' };
    else if (p === '/markets') {
      body = { markets: (params.get('event_ticker') || params.get('series_ticker') ? state.eventMarkets : state.quoteMarkets) || [], cursor: '' };
    } else if (p.endsWith('/orderbook')) {
      body = { orderbook_fp: state.orderbook || { yes_dollars: [], no_dollars: [] } };
    } else if (p === '/markets/trades') body = { trades: [], cursor: '' };
    else if (p === '/series') body = { series: state.series || [{ ticker: 'KXPGATOUR', title: 'PGA Tour', category: 'Sports', categories: ['Sports'], volume_fp: '10.00', settlement_sources: EVENT.settlement_sources }] };
    else if (p.includes('/candlesticks')) body = { candlesticks: [] };
    else if (p.startsWith('/series/')) body = { series: { ticker: 'KXPGATOUR', title: 'PGA Tour', fee_multiplier: 1, fee_type: 'quadratic' } };
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

/* ------------------------------------------------------------------ A1 */
await test('A1 — a market past close_time stops sampling prices (no phantom alert)', async () => {
  const state = {
    eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
    quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
  };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(300);
  assert.equal(window.KalshiModel.state.alerts.length, 0, 'a live market must not alert before its price moves');
  /* Past its close_time, the exchange keeps echoing the last quote (and often a
   * 0.00 bid). That must NOT be read as a -$0.10 move. */
  state.quoteMarkets = [market('KXPGATOUR-THRC26-SSTR', '0.6000', {
    close_time: '2020-01-01T00:00:00Z', yes_bid_dollars: '0.0000',
  })];
  window.KalshiApp.pollWatch();
  await wait(300);
  const alerts = window.KalshiModel.state.alerts;
  assert.equal(alerts.filter(a => a.ticker === 'KXPGATOUR-THRC26-SSTR').length, 0,
    'a phantom alert was raised for a market past close_time: ' + JSON.stringify(alerts));
  assert.ok(window.KalshiApp.state.watch['KXPGATOUR-THRC26-SSTR']._closed === true,
    'the closed market was not marked as no longer trading');
});

await test('A1b — a market that closes with an official result is still recorded as resolved', async () => {
  const closed = { status: 'finalized', result: 'no', settlement_ts: '2026-11-21T04:01:27Z' };
  const state = {
    eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
    quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000', closed)],
  };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(400);
  const r = window.KalshiModel.state.resolved['KXPGATOUR-THRC26-SSTR'];
  assert.ok(r, 'a finalized market with result=no was not recorded as resolved');
  assert.equal(r.result, 'no');
});

/* ------------------------------------------------------------------ A2 */
await test('A2 — the market table separates live markets, flags status and shows resting size', async () => {
  const stale = market('KXPGATOUR-THRC26-OLD', '0.5000', {
    close_time: '2020-01-01T00:00:00Z', volume_fp: '999999.00', yes_bid_dollars: '0.5000', yes_ask_dollars: '0.5100',
  });
  const live = market('KXPGATOUR-THRC26-SSTR', '0.6600', {
    yes_bid_dollars: '0.6600', yes_ask_dollars: '0.6800', no_ask_dollars: '0.3400',
    yes_bid_size_fp: '321.00', yes_ask_size_fp: '654.00', volume_fp: '10.00',
  });
  const state = { eventMarkets: [live, stale], quoteMarkets: [live, stale] };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(400);
  const rows = [...window.document.querySelectorAll('#kx-rows tr[data-t]')];
  assert.ok(rows.length >= 1, 'no table rows rendered');
  assert.equal(rows[0].getAttribute('data-t'), 'KXPGATOUR-THRC26-SSTR',
    'the market ranked first is not the tradeable one (closed rows must not outrank live rows)');
  const html = window.document.querySelector('#kx-rows').innerHTML;
  assert.ok(html.includes('321') && html.includes('654'), 'resting contract sizes (yes_bid_size_fp/yes_ask_size_fp) are not shown');
  assert.ok(/Best price/.test(window.document.querySelector('#kalshi-app').textContent), 'no best-price column');
  assert.ok(window.document.querySelector('#kpi-live'), 'no "live now" KPI');
  assert.equal(window.document.querySelector('#kpi-live').textContent, '1',
    'the live count should be 1 (one open market, one past close_time), got ' + window.document.querySelector('#kpi-live').textContent);
});

/* ------------------------------------------------------------------ A3 */
await test('A3 — the order-book ladder is best-first per side with contracts and cumulative cost', async () => {
  /* Official example response (orderbook_responses), verbatim shape: ascending
   * arrays, best bid last. */
  const orderbook = {
    yes_dollars: [['0.0100', '200.00'], ['0.1500', '100.00'], ['0.3000', '11.00'], ['0.4200', '13.00']],
    no_dollars: [['0.0100', '100.00'], ['0.2500', '50.00'], ['0.4400', '29.00'], ['0.5600', '17.00']],
  };
  const state = { eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.5000')], quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.5000')], orderbook };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(300);
  window.KalshiApp.select('KXPGATOUR-THRC26-SSTR');
  await wait(400);
  const box = window.document.querySelector('#kx-book');
  const text = box.textContent;
  /* best YES bid = 0.42 (last of yes_dollars); best NO bid = 0.56 (last of no_dollars)
   * -> derived best YES ask = 1 - 0.56 = 0.44, spread = 0.02 (the doc's own example). */
  assert.ok(/\$0\.42/.test(text), 'best YES bid $0.42 missing');
  assert.ok(/\$0\.44/.test(text), 'derived best YES ask $0.44 missing');
  assert.ok(/\$0\.02/.test(text), 'spread $0.02 missing');
  const tables = [...box.querySelectorAll('table.ladder')];
  assert.equal(tables.length, 4, 'expected four ladders (YES ask/bid, NO ask/bid), got ' + tables.length);
  const yesAskFirst = tables[0].querySelector('tbody tr td').textContent;
  assert.equal(yesAskFirst, '$0.44', 'the YES ask ladder is not cheapest-first (first row ' + yesAskFirst + ')');
  const yesBidFirst = tables[1].querySelector('tbody tr td').textContent;
  assert.equal(yesBidFirst, '$0.42', 'the YES bid ladder is not best-first (first row ' + yesBidFirst + ')');
  assert.ok(/Cum\./.test(tables[0].textContent), 'no cumulative contracts/cost columns');
  /* every printed level of the YES bid book must appear (the old panel cut to 6
   * entries per side but rendered the WRONG 6 — check the count explicitly) */
  assert.equal(tables[1].querySelectorAll('tbody tr').length, 4, 'not every YES bid level is shown');
});

/* ------------------------------------------------------------------ A4 */
await test('A4 — a series record can add settlement sources to an already-known event', async () => {
  /* /events is answered WITHOUT settlement_sources (the demo events list can
   * omit it); the /series record publishes them. The alert links must use them. */
  const bareEvent = { ...EVENT, settlement_sources: undefined };
  const state = {
    events: [bareEvent],
    eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
    quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')],
  };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(600);
  const ev = window.KalshiApp.state.events['KXPGATOUR-THRC26'];
  assert.ok(ev, 'event not discovered');
  assert.ok(ev.settlement_sources && ev.settlement_sources.length,
    'the series settlement_sources were dropped for an already-created event');
  assert.equal(ev.settlement_sources[0].url, 'https://www.espn.com/');
});

/* ------------------------------------------------------------------ A5 */
await test('A5 — the chats open with a session note and a persisted-moves board', async () => {
  const seed = [{
    t: Date.now() - 3600e3, ticker: 'KXPGATOUR-THRC26-SSTR', event: EVENT.event_ticker,
    title: 'The RSM Classic: X wins', topic: 'golf', from: 0.55, to: 0.70, delta: 0.15, dir: 'up',
    kind: 'sample', vol24: 500, estdv: 100, score: 0.62,
  }];
  const state = { eventMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')], quoteMarkets: [market('KXPGATOUR-THRC26-SSTR', '0.6000')], seedAlerts: seed };
  const { window } = makeDom(state);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await wait(350);
  const all = window.document.querySelector('#kx-chat-all').textContent;
  assert.ok(/Watching/.test(all), 'no session note at the top of the alert chat');
  const board = window.document.querySelector('#kx-board');
  assert.ok(board, 'no persisted-moves board');
  assert.ok(/0\.15|\+0.15/.test(board.textContent), 'the stored alert is missing from the board: ' + board.textContent.slice(0, 200));
  assert.ok(board.querySelector('a[href*="kalshi.co"]'), 'a board row has no official source link');
});

console.log('\n' + passed + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
