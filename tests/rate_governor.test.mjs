#!/usr/bin/env node
/* Tests for assets/governor.js — the request governor that keeps the live
 * dashboard inside the exchange's documented rate limits — and for the wiring
 * in assets/app.js that routes every Kalshi call through it.
 *
 * Rules pinned to official sources (https://docs.kalshi.com/getting_started/rate_limits,
 * read 2026-11-21):
 *   · "Apply exponential backoff on 429."                  -> G1 (doubling cooldown)
 *   · "429 responses carry the rate limit headers below,   -> G2 (no Retry-After use)
 *      but not Retry-After."
 *   · "Most GET requests are counted in batches, so only  -> G3 (absence is normal)
 *      some GET responses include X-RateLimit-Remaining
 *      and X-RateLimit-Reset."
 *   · "Publicly cacheable responses (Cache-Control:        -> G3
 *      public), which include most market data, carry none
 *      of these headers."
 *   · "X-RateLimit-Remaining and X-RateLimit-Reset are     -> G4 (only a drained
 *      omitted when the server has no current reading."       reading is acted on)
 * The pacing numbers are OUR client-side choice (no official unauthenticated
 * figure exists), so G5 pins them as configured behaviour, not as an API limit.
 *
 * Run: node tests/rate_governor.test.mjs     (jsdom needed only for W1/W2)
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const GOV = readFileSync(new URL('../assets/governor.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const MODEL = readFileSync(new URL('../assets/model.js', import.meta.url), 'utf8');

/* Load the governor the way a <script> does: it attaches itself to the global
 * object (window in a browser, globalHere in Node). */
(0, eval)(GOV);
const KalshiGovernor = globalThis.KalshiGovernor;
const create = KalshiGovernor.create;

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' — ' + (e && e.message)); }
}
const settle = async (n = 25) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/* Deterministic clock: the governor is injected with now/schedule, so no test
 * ever sleeps in real time and the timings below are exact assertions. */
function clock() {
  let t = 0, seq = 0;
  const timers = new Map();
  const api = {
    now: () => t,
    schedule(fn, ms) { const id = ++seq; timers.set(id, { at: t + Math.max(0, Math.ceil(ms || 0)), fn }); return id; },
    cancel(id) { timers.delete(id); },
    async advance(ms) {
      const target = t + ms;
      for (let guard = 0; guard < 100000; guard++) {
        let due = null;
        for (const [id, tm] of timers) {
          if (tm.at <= target && (!due || tm.at < due.tm.at)) due = { id, tm };
        }
        if (!due) break;
        t = due.tm.at; timers.delete(due.id); due.tm.fn();
        await settle();
      }
      t = target;
      await settle();
    },
  };
  return api;
}

function mk(clock, over) {
  return create(Object.assign({
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    ratePerSec: 100, burst: 100, maxInFlight: 4, queueCap: 50,
    backoffMs: 1000, backoffMaxMs: 8000, priorities: 4, dropFloor: 1,
  }, over || {}));
}
const ok = () => Promise.resolve({ status: 200, ok: true, headers: { get: () => null } });

/* ------------------------------------------------------------------ G5/G6 pacing */
await test('G5 — dispatch is paced by the token bucket and capped by maxInFlight', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 5, burst: 2, maxInFlight: 2 });
  const times = [];
  let live = 0, maxLive = 0;
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(g.submit({ pri: 0, worker: () => {
      times.push(c.now()); live++; maxLive = Math.max(maxLive, live);
      return ok().then(() => { live--; });
    } }));
  }
  await c.advance(4000);
  await Promise.all(jobs);
  assert.ok(maxLive <= 2, 'concurrency exceeded maxInFlight (' + maxLive + ')');
  assert.equal(times.length, 10, 'not every job ran');
  /* burst 2 at t=0, then one request per 200 ms (1/5 s) as the bucket refills. */
  assert.deepEqual(times.slice(0, 4), [0, 0, 200, 400], 'unexpected pacing: ' + times.join(','));
  assert.equal(times[9], 1600, 'last request should drain at (10-2)/5 s = 1600 ms, got ' + times[9]);
  assert.equal(g.stats().sent, 10);
});

/* ------------------------------------------------------------------ priority */
await test('G6 — strict priority: the watchlist poll overtakes queued discovery work', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 1000, burst: 1, maxInFlight: 1 });
  const order = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const job = (name, pri, worker) => g.submit({ pri, worker: worker || (() => { order.push(name); return ok(); }) });
  const first = job('j1', 3, () => { order.push('j1'); return gate.then(() => ({ status: 200, ok: true, headers: { get: () => null } })); });
  await c.advance(0);   // let j1 occupy the single in-flight slot
  await settle();
  const a = job('j2a', 3); const b = job('j2b', 3); const urgent = job('j3', 0);
  release();
  await c.advance(200);
  await Promise.all([first, a, b, urgent]);
  assert.deepEqual(order, ['j1', 'j3', 'j2a', 'j2b'], 'priority ordering broken: ' + order.join(','));
});

/* ------------------------------------------------------------------ coalescing */
await test('G7 — identical URLs in flight are coalesced into one request', async () => {
  const c = clock();
  const g = mk(c, { maxInFlight: 1 });
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const worker = () => { calls++; return gate.then(() => ({ status: 200, ok: true, body: 'shared', headers: { get: () => null } })); };
  const five = [0, 1, 2, 3, 4].map(() => g.submit({ pri: 0, key: '/markets?tickers=A,B', worker }));
  await settle();
  release();
  await c.advance(50);
  const res = await Promise.all(five);
  assert.equal(calls, 1, 'the same URL was requested ' + calls + ' times');
  assert.ok(res.every(r => r.body === 'shared'), 'callers did not all receive the single response');
  assert.equal(g.stats().coalesced, 4, 'coalesced count wrong');
});

/* ------------------------------------------------------------------ 429 backoff */
await test('G1 — a 429 doubles the cooldown: retries are exponentially spaced, not hammered', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 1000, burst: 1000, maxInFlight: 2, backoffMs: 1000, backoffMaxMs: 8000 });
  const times = [];
  let err = null;
  const p = g.submit({
    pri: 0, retry429: 2,
    worker: () => { times.push(c.now()); return Promise.resolve({ status: 429, ok: false, headers: { get: () => null } }); },
  }).catch(e => { err = e; });
  await c.advance(20000);
  await p;
  /* 1000 ms, then 2000 ms more: exponential growth, per "Apply exponential
   * backoff on 429." The retry waits for the cooldown the governor opened — it
   * does not fire immediately, and it does not switch demo hosts either. */
  assert.deepEqual(times, [0, 1000, 3000], '429 retries were not exponentially spaced: ' + times.join(','));
  assert.equal(err && err.code, 'throttled', 'caller was not told the request was throttled');
  const st = g.stats();
  assert.equal(st.throttled429, 3, 'throttle count wrong');
  assert.equal(st.requeued, 2, 'requeue count wrong');
  assert.equal(st.sent, 3, 'the governor sent ' + st.sent + ' requests for one job');
});

await test('G1b — work submitted during a cooldown waits for it instead of adding load', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 1000, burst: 1000, maxInFlight: 2, backoffMs: 1000, backoffMaxMs: 8000 });
  const first = g.submit({ pri: 0, worker: () => Promise.resolve({ status: 429, ok: false, headers: { get: () => null } }) }).catch(() => '429');
  await c.advance(500);
  await first;                       // cooldown runs to t=1000
  const at = [];
  const p2 = g.submit({ pri: 2, worker: () => { at.push(c.now()); return ok(); } });
  await c.advance(400);
  assert.deepEqual(at, [], 'the queued job jumped the exchange backoff');
  await c.advance(700);
  await p2;
  assert.deepEqual(at, [1000], 'the queued job did not resume exactly at the end of the cooldown: ' + at.join(','));
});

await test('G8 — a clean response decays the backoff streak instead of holding it', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 1000, burst: 1000, maxInFlight: 1, backoffMs: 1000, backoffMaxMs: 8000 });
  const throttle = async () => {
    await c.advance(g.stats().cooldownMs + 5);   // a retry must wait for the cooldown it caused
    const p = g.submit({ pri: 0, worker: () => Promise.resolve({ status: 429, ok: false, headers: { get: () => null } }) }).catch(() => '429');
    await c.advance(50);
    await p;
  };
  await throttle();                                     // streak 1 -> 1000 ms
  assert.equal(g.stats().backoffStreak, 1);
  assert.ok(g.stats().cooldownMs > 0, 'no cooldown opened after a 429');
  await throttle();                                     // streak 2 -> 2000 ms
  assert.equal(g.stats().backoffStreak, 2);
  const wide = g.stats().cooldownMs;
  const clean = g.submit({ pri: 0, worker: ok });       // one clean answer
  await c.advance(g.stats().cooldownMs + 50);
  await clean;
  assert.equal(g.stats().backoffStreak, 1, 'streak did not decay after a clean response');
  g.noteThrottle();                                     // 1000 * 2^1 = 2000, not the 4000 a bare streak-3 would give
  assert.equal(g.stats().backoffStreak, 2);
  assert.ok(g.stats().cooldownMs <= 2000, 'cooldown ignored the decay: ' + g.stats().cooldownMs);
  assert.ok(g.stats().cooldownMs > 1000, 'cooldown collapsed the exponential step: ' + g.stats().cooldownMs);
  assert.ok(wide > 1000 && wide <= 2000, 'second-step cooldown out of range: ' + wide);
});

/* ------------------------------------------------------------------ headers */
await test('G3 — no X-RateLimit headers at all is the normal case, never a throttle', async () => {
  const c = clock();
  const g = mk(c);
  const p = g.submit({ pri: 0, worker: () => Promise.resolve({ status: 200, ok: true, headers: { get: () => null } }) });
  await c.advance(10);
  const r = await p;
  assert.equal(r.status, 200);
  const s = g.stats();
  assert.equal(s.remaining, null, 'invented a budget reading from an absent header');
  assert.equal(s.limit, null);
  assert.equal(s.cooldownMs, 0, 'a clean, header-less response must not open a cooldown');
  assert.equal(s.throttled429, 0);
});

await test('G4 — Remaining: 0 with a Reset reading is honoured; a partial budget is display only', async () => {
  const c = clock();
  const g = mk(c, { ratePerSec: 1000, burst: 1000, maxInFlight: 4, backoffMaxMs: 8000 });
  const hdr = (v) => ({ get: (k) => (k in v ? String(v[k]) : null) });
  const gp = g.submit({ pri: 0, worker: () => Promise.resolve({ status: 200, ok: true, headers: hdr({ 'x-ratelimit-limit': 200, 'x-ratelimit-remaining': 0, 'x-ratelimit-reset': 2.5 }) }) });
  await c.advance(5);
  await gp;
  let s = g.stats();
  assert.equal(s.remaining, 0);
  assert.equal(s.limit, 200);
  assert.ok(s.cooldownMs > 2000 && s.cooldownMs <= 2500, 'drained bucket not respected: ' + s.cooldownMs);
  const at = [];
  const p2 = g.submit({ pri: 0, worker: () => { at.push(c.now()); return ok(); } });
  await c.advance(3000);
  await p2;
  assert.deepEqual(at, [2500], 'the queued request did not wait for the bucket: ' + at.join(','));
  /* A bucket with tokens left is a display value only — no artificial wait. */
  const c2 = clock();
  const g2 = mk(c2, { ratePerSec: 1000, burst: 1000, maxInFlight: 4 });
  const q1 = g2.submit({ pri: 0, worker: () => Promise.resolve({ status: 200, ok: true, headers: hdr({ 'x-ratelimit-limit': 200, 'x-ratelimit-remaining': 40, 'x-ratelimit-reset': 0.8 }) }) });
  const q2 = g2.submit({ pri: 0, worker: ok });
  await c2.advance(50);
  await Promise.all([q1, q2]);
  assert.equal(g2.stats().remaining, 40);
  assert.equal(g2.stats().cooldownMs, 0, 'a non-empty budget must not pause the page');
});

/* ------------------------------------------------------------------ shedding */
await test('G9 — a full queue sheds background work and never the alert path', async () => {
  const c = clock();
  const g = mk(c, { maxInFlight: 1, queueCap: 2 });
  let release;
  const gate = new Promise(r => { release = r; });
  const held = g.submit({ pri: 3, worker: () => gate.then(() => ({ status: 200, ok: true, headers: { get: () => null } })) });
  await settle();
  const outcomes = [];
  const bg = [0, 1, 2, 3].map(i => g.submit({ pri: 3, worker: ok }).then(() => 'done', e => e.code));
  const urgent = g.submit({ pri: 0, worker: ok }).then(() => 'done', e => e.code);
  await settle();
  release();
  await c.advance(300);
  const bgRes = await Promise.all(bg);
  const urgentRes = await urgent;
  await held;
  outcomes.push(urgentRes);
  assert.ok(bgRes.indexOf('dropped') !== -1, 'a queue at queueCap shed nothing: ' + bgRes.join(','));
  assert.equal(urgentRes, 'done', 'the alert path was shed under queue pressure');
  assert.ok(g.stats().dropped >= 1, 'no shed was recorded');
  /* Priority 0 is exempt from shedding even when the queue is over the cap. */
  const again = g.submit({ pri: 0, worker: ok }).then(() => 'done', e => e.code);
  await c.advance(300);
  assert.equal(await again, 'done');
});

await test('G10 — a network failure is reported and the bucket keeps running', async () => {
  const c = clock();
  const g = mk(c, { maxInFlight: 1 });
  let err = null;
  const p = g.submit({ pri: 0, worker: () => Promise.reject(new Error('offline')) }).catch(e => { err = e; });
  await c.advance(20);
  await p;
  assert.ok(err, 'the caller never saw the failure');
  const p2 = g.submit({ pri: 0, worker: ok });
  await c.advance(20);
  const r = await p2;
  assert.equal(r.status, 200, 'a rejected worker wedged the governor');
  assert.ok(g.stats().failed >= 1);
});

/* ------------------------------------------------------------------ config */
await test('G2/G11 — no Retry-After is read (429s carry none) and the shipped pacing stays far below the published authenticated rate', async () => {
  /* Assert on code, not prose: the docs quote in the header comment is allowed to
   * name Retry-After (to say it is absent); nothing may READ such a header. */
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/retry-after/i.test(strip(GOV)), 'the governor must not expect a Retry-After header: 429 responses carry none');
  assert.ok(!/retry-after/i.test(strip(APP)), 'the client must not expect a Retry-After header');
  const d = KalshiGovernor.DEFAULTS;
  /* Basic-tier Read budget = 200 tokens/s at 10 tokens/request = 20 req/s. */
  assert.ok(d.ratePerSec <= 5, 'client pacing must stay well under the smallest published budget');
  assert.ok(d.burst <= 10 && d.maxInFlight <= 4, 'burst/in-flight must stay modest: ' + JSON.stringify(d));
  assert.ok(d.backoffMaxMs >= d.backoffMs * 4, 'backoff must be able to grow exponentially');
  const m = APP.match(/ratePerSec:\s*(\d+),\s*rateBurst:\s*(\d+),\s*maxInFlight:\s*(\d+)/);
  assert.ok(m, 'app.js must state its pacing values in one readable place');
  assert.ok(Number(m[1]) <= 5 && Number(m[2]) <= 10 && Number(m[3]) <= 4, 'app.js pacing out of range: ' + m[0]);
  assert.ok(/priority|pri/i.test(GOV) && typeof d.priorities === 'number');
});

/* ------------------------------------------------------------------ wiring */
async function boot(opts) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><main><div id="kalshi-app" data-page="dashboard"></div></main></body></html>',
    { url: 'https://example.test/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.clear();
  const calls = [];
  let live = 0, maxLive = 0;
  window.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (!/^https?:/.test(u)) {
      // same-origin files (data/meta.json, data/topics/*.json) are not part of this test
      return Promise.resolve({ ok: false, status: 404, url: u, json: () => Promise.reject(new Error('404')) });
    }
    live++; maxLive = Math.max(maxLive, live);
    const done = () => { live--; };
    const p = new URL(u).pathname.replace('/trade-api/v2', '');
    const params = new URL(u).searchParams;
    let body = {};
    if (opts.every429) return Promise.resolve({ ok: false, status: 429, url: u, json: () => Promise.resolve({ error: { code: 'too_many_requests' } }) }).then(r => { done(); return r; });
    if (p === '/events') body = { events: [{ event_ticker: 'KXBTCD-26NOV21', series_ticker: 'KXBTCD', title: 'Bitcoin price on Nov 21, 2026 at 12pm EDT?', sub_title: '', category: 'Crypto' }], cursor: '' };
    else if (p === '/markets') body = { markets: [{ ticker: 'KXBTCD-26NOV21-T68000', event_ticker: 'KXBTCD-26NOV21', series_ticker: 'KXBTCD', title: 'Bitcoin price on Nov 21, 2026 at 12pm EDT?', status: 'active', result: '', last_price_dollars: '0.5200', previous_price_dollars: '0.4000', yes_bid_dollars: '0.5100', yes_ask_dollars: '0.5300', yes_bid_size_fp: '1000.00', yes_ask_size_fp: '900.00', volume_fp: '5000.00', volume_24h_fp: '2500.00', open_interest_fp: '4000.00', close_time: '2026-11-21T17:00:00Z', open_time: '2026-11-21T00:00:00Z' }], cursor: '' };
    else if (p.endsWith('/orderbook')) body = { orderbook_fp: { yes_dollars: [['0.5000', '100.00'], ['0.5100', '200.00']], no_dollars: [['0.4800', '150.00']] } };
    else if (p === '/markets/trades') body = { trades: [], cursor: '' };
    else if (p === '/series') body = { series: [] };
    else if (p.includes('/candlesticks')) body = { candlesticks: [] };
    else if (p.startsWith('/series/')) body = { series: { ticker: 'KXBTCD', fee_multiplier: 1, fee_type: 'quadratic', settlement_sources: [] } };
    return Promise.resolve({ ok: true, status: 200, url: u, json: () => Promise.resolve(body) }).then(r => { done(); return r; });
  };
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.eval(GOV);
  window.eval(MODEL);
  window.eval(APP);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { dom, window, calls, peakConcurrency: () => maxLive };
}

await test('W1 — app.js routes every call through the governor (concurrency is capped)', async () => {
  const b = await boot({});
  await new Promise(r => setTimeout(r, 400));
  const app = b.window.KalshiApp;
  assert.ok(app, 'the dashboard did not mount');
  assert.ok(b.calls.length >= 2, 'no API requests were made');
  assert.ok(b.peakConcurrency() <= app.CFG.maxInFlight,
    'the page issued ' + b.peakConcurrency() + ' concurrent requests (cap ' + app.CFG.maxInFlight + ') — governor not wired');
  assert.ok(b.calls.every(u => /^https:\/\/(external-api\.demo\.kalshi\.co|demo-api\.kalshi\.co)\/trade-api\/v2\//.test(u) || !/^https?:/.test(u)),
    'a request left the two documented demo hosts');
  b.window.close();
});

await test('W2 — a throttled exchange does not fall back to snapshot mode, and the pill says so', async () => {
  const b = await boot({ every429: true });
  await new Promise(r => setTimeout(r, 500));
  const pill = b.window.document.querySelector('#kx-mode');
  const rate = b.window.document.querySelector('#kx-ratelimit');
  const txt = (pill && pill.textContent) || '';
  assert.ok(!/SNAPSHOT/i.test(txt), '429s wrongly reported as an outage: "' + txt + '"');
  assert.ok(/throttl|backing off|backing-off/i.test(txt), 'the pill does not say the page is yielding: "' + txt + '"');
  assert.ok(/throttled/.test((rate && rate.textContent) || ''), 'the governor readout is missing the throttle count');
  assert.ok(b.window.KalshiApp.state.mode !== 'snapshot', 'S.mode fell back to snapshot on a 429');
  b.window.close();
});

await test('W3 — the watchlist poll path is the highest priority and re-queues through a throttle', async () => {
  /* priFor()/retryFor() are internal; pin them through the shipped source so a
   * rename cannot silently re-rank the alert path behind discovery. */
  const body = APP.slice(APP.indexOf('function priFor'), APP.indexOf('function httpErr'));
  assert.ok(/\/markets\?tickers=.*PRI\.poll/s.test(body), 'the watchlist poll is no longer priority 0');
  assert.ok(/\/orderbook.*PRI\.book/s.test(body), 'the book is not ahead of chart/discovery work');
  assert.ok(/return PRI\.discover;/.test(body), 'discovery is not the lowest priority');
  assert.ok(/pri === PRI\.poll \? 2/.test(APP), 'the alert path lost its extra 429 retries');
  assert.ok(/if \(err && !isYield\(err\)\) \{ failed\+\+/.test(APP), 'pollWatch counts yields as outages again');
  assert.ok(/if \(cooling\(\)\) \{ S\.modeNote = 'Discovery paused/.test(APP), 'discovery no longer pauses while throttled');
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
