#!/usr/bin/env node
/* Contract tests for the live data the dashboard consumes.
 *
 * Every fixture here is a VERBATIM response body from the official Kalshi DEMO
 * API, captured on 2026-11-21 by a page fetch of the exact URL recorded in the
 * fixture (the build sandbox has no route to kalshi.co, so the capture and the
 * CI probe in scripts/api_contract.py are the two sources of real traffic).
 * Nothing in these files is synthetic: field names, values and ordering are
 * whatever the exchange returned.
 *
 * What each test pins, and the official rule behind it:
 *   C1  the order-book ladder  — https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *                                ("sorted by price in ascending order, so the best
 *                                 (highest) bid is the last element")
 *   C2  the derived best ask   — https://docs.kalshi.com/getting_started/orderbook_responses
 *                                (YES ask = $1.00 − NO bid; asks are not published)
 *   C3  the trade tape         — https://docs.kalshi.com/api-reference/market/get-trades
 *                                (yes_price_dollars + created_time; the response
 *                                 arrives newest-first, so the chart must sort)
 *   C4  candlestick closes     — https://docs.kalshi.com/api-reference/market/get-market-candlesticks
 *                                (price.close_dollars, end_period_ts; period 60)
 *   C5  a resolution           — https://docs.kalshi.com/getting_started/market_lifecycle
 *                                (a settled market carries `result` and `settlement_ts`;
 *                                 result "no" must be recorded as NO, not skipped)
 *
 * Run: node tests/live_contract.test.mjs     (requires: npm install jsdom)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const GOV = readFileSync(new URL('../assets/governor.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const MODEL = readFileSync(new URL('../assets/model.js', import.meta.url), 'utf8');
const FIX = (n) => JSON.parse(readFileSync(new URL('../data/samples/' + n, import.meta.url), 'utf8'));

const BOOK = FIX('orderbook-live-sample.json');
const TRADES = FIX('trades-live-sample.json');
const CANDLES = FIX('candlesticks-live-sample.json');
const SETTLED = FIX('settled-markets-live-sample.json');
const TICKER = 'KXBTC50VS100-BTC-26DEC31';
/* jsdom windows own the dashboard's setInterval timers; they are closed in the
 * finalizer below so this file exits instead of idling with an open handle. */
const WINDOWS = [];
const SETTLED_EVENT = SETTLED.response.markets[0].event_ticker;

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' — ' + (e && e.message)); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* Two boots:
 *   A) with data/ served from disk — the page takes its real bootstrap path
 *      (loadSnapshot over the CI-collected data/topics/*.json), which is what puts a
 *      live market in the watchlist with its series ticker; then the selected
 *      market's book / tape / candles are answered from the verbatim fixtures.
 *   B) without data/ — the settled rows are brought into scope through a
 *      synthetic /events wrapper. The wrapper is a test fixture, NOT an API
 *      response; the market rows behind it are verbatim, and every assertion is
 *      about those rows.
 * A fixture is only served at the path it was fetched from, so a client asking for
 * something else gets an empty-but-valid answer, never a guess. */
const ROOT = new URL('../', import.meta.url);
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><main><div id="kalshi-app" data-page="dashboard"></div></main></body></html>',
    { url: 'https://example.test/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.clear();
  const asked = [];
  window.fetch = (url) => {
    const u = String(url);
    asked.push(u);
    if (!/^https?:/.test(u)) {
      if (!opts.serveData) {
        return Promise.resolve({ ok: false, status: 404, url: u, json: () => Promise.reject(new Error('404')) });
      }
      try {
        const body = JSON.parse(readFileSync(ROOT.pathname + u, 'utf8'));
        return Promise.resolve({ ok: true, status: 200, url: u, json: () => Promise.resolve(body) });
      } catch (e) {
        return Promise.resolve({ ok: false, status: 404, url: u, json: () => Promise.reject(new Error('404')) });
      }
    }
    const p = new URL(u).pathname.replace('/trade-api/v2', '');
    let body = { markets: [], cursor: '' };
    if (p === '/events') {
      body = { events: [{ event_ticker: SETTLED_EVENT, series_ticker: 'KXDOTA2GAME',
        title: 'TEST WRAPPER (synthetic, not an API response): brings the verbatim settled markets into scope',
        sub_title: '', category: 'Crypto' }], cursor: '' };
    } else if (p === '/markets') {
      body = SETTLED.response;                      // real fields, verbatim
    } else if (p.endsWith('/orderbook')) {
      body = BOOK.response;
    } else if (p === '/markets/trades') {
      body = TRADES.response;
    } else if (p.includes('/candlesticks')) {
      body = CANDLES.response;
    } else if (p === '/series') {
      body = { series: [], cursor: '' };
    } else if (p.startsWith('/series/')) {
      body = { series: { ticker: 'KXBTC50VS100', fee_multiplier: 1, fee_type: 'quadratic', settlement_sources: [] } };
    }
    return Promise.resolve({ ok: true, status: 200, url: u, json: () => Promise.resolve(body) });
  };
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.eval(GOV);
  window.eval(MODEL);
  window.eval(APP);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  WINDOWS.push(window);
  return { window, asked };
}

const book = boot({ serveData: true });
await wait(700);
book.window.KalshiApp.select(TICKER);
await wait(600);
/* The candles readout is captured before C3 switches the chart window: switching
 * to a seconds window clears S.candles on purpose (candlesticks only exist at
 * 1/60/1440-minute periods), so C4 must look at what the 60-minute window parsed. */
const CANDLE_READ = (book.window.KalshiApp.state.candles || []).slice();
function useTapeWindow() {
  const sel = book.window.document.querySelector('#kx-win');
  sel.value = '60s';
  sel.dispatchEvent(new book.window.Event('change'));
  return wait(600);
}

await test('C1 — the real order book is read as published: ascending, best bid last', async () => {
  const b = book.window.KalshiApp.state.book;
  assert.ok(b && b.yes_dollars, 'no order book was loaded for the selected market');
  const yes = b.yes_dollars.map(x => Number(x[0]));
  assert.deepEqual(yes, [0.24, 0.25, 0.39, 0.4, 0.41], 'the fixture ladder changed shape');
  assert.equal(Math.max.apply(null, yes), yes[yes.length - 1],
    'the client assumes the last element is the best bid; this response disagrees');
  const html = book.window.document.querySelector('#kx-book').textContent.replace(/\s+/g, ' ');
  assert.ok(html.includes('$0.41'), 'best YES bid not shown: ' + html.slice(0, 240));
  assert.ok(html.includes('$0.57') || html.includes('$0.43'),
    'the top NO bid (0.57) should drive the derived ask: ' + html.slice(0, 240));
});

await test('C2 — the best ask is derived by the reciprocal rule, never read from the API', async () => {
  const b = book.window.KalshiApp.state.book;
  assert.ok(!('yes_ask_dollars' in b) && !('no_ask_dollars' in b),
    'the exchange does not publish asks; the fixture must not contain them');
  const html = book.window.document.querySelector('#kx-book').textContent.replace(/\s+/g, ' ');
  /* $1.00 - 0.57 = 0.43, and the spread against the 0.41 bid is 0.02. */
  assert.ok(html.includes('$0.43'), 'derived best YES ask $0.43 missing: ' + html.slice(0, 240));
  assert.ok(html.includes('spread $0.02'), 'spread not derived from the published bids: ' + html.slice(0, 240));
});

await test('C3 — the trade tape is re-sorted ascending (the API answers newest first)', async () => {
  await useTapeWindow();
  const raw = TRADES.response.trades.map(t => t.created_time);
  assert.ok(raw[0] > raw[1] && raw[1] > raw[2], 'fixture is expected newest-first, as observed live');
  const pts = book.window.KalshiApp.state.trades;
  assert.equal(pts.length, TRADES.response.trades.length, 'not every print was loaded');
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].t >= pts[i - 1].t, 'chart series is not sorted by time at index ' + i);
    assert.equal(pts[i].p, Number(TRADES.response.trades[0].yes_price_dollars),
      'the chart must plot yes_price_dollars, the YES price of the print');
  }
  assert.equal(pts[0].p, 0.43);
});

await test('C4 — candlestick closes come from price.close_dollars at end_period_ts', async () => {
  const c = CANDLES.response.candlesticks[0];
  const pts = CANDLE_READ;
  assert.equal(pts.length, CANDLES.response.candlesticks.length, 'candle not parsed');
  assert.equal(pts[0].p, Number(c.price.close_dollars), 'wrong candle field used for the price');
  assert.equal(pts[0].t, c.end_period_ts * 1000, 'x axis must be the period end timestamp in ms');
});

await test('C5 — two finalized markets are recorded as resolved NO with their settlement time', async () => {
  const w = boot({});
  await wait(700);
  w.window.KalshiApp.pollWatch();
  await wait(600);
  const resolved = w.window.KalshiModel.state.resolved;
  const rows = w.window.document.querySelectorAll('#kx-resolved tr');
  const tickers = SETTLED.response.markets.map(m => m.ticker);
  tickers.forEach(t => {
    assert.ok(resolved[t], 'settled market ' + t + ' was not recorded as resolved');
    assert.equal(resolved[t].result, 'no', 'result must be recorded verbatim as the exchange returned it');
    assert.equal(resolved[t].settlement_ts, SETTLED.response.markets[0].settlement_ts,
      'settlement_ts was not carried through');
  });
  assert.ok(rows.length >= 2, 'the resolved strip rendered ' + rows.length + ' rows for 2 settled markets');
  assert.ok(/NO/.test(rows[0].textContent), 'the resolved row does not show NO: ' + rows[0].textContent);
  /* Both markets of this event settled "no" (the match was never played); the page
   * shows what the exchange returned and draws no conclusion about why. */
  assert.ok(tickers.length === 2 && SETTLED.response.markets.every(m => m.result === 'no'));
});

WINDOWS.forEach(w => { try { w.close(); } catch (e) { /* already torn down */ } });
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
