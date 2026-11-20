// Offline unit checks for assets/lib.mjs. Fixtures mirror the field names of
// official Kalshi responses (see docs.kalshi.com links on the Sources page).
import assert from 'node:assert/strict';
import { classifyEvent, marketRow, rowsFromEvents, detectSwing, screenAlert, parseOrderbook, fetchPaged, API_BASES } from '../assets/lib.mjs';

const ev = {
  event_ticker: 'KXGOLF-TEST', series_ticker: 'KXGOLF', category: 'Sports', title: 'Who wins the Masters?', tags: ['Golf'],
  settlement_sources: [{ name: 'PGA TOUR', url: 'https://www.pgatour.com' }],
  markets: [{ ticker: 'KXGOLF-TEST-A', title: 'Scottie Scheffler wins', yes_sub_title: 'Scottie Scheffler', status: 'active',
    yes_bid_dollars: '0.2000', yes_ask_dollars: '0.2200', last_price_dollars: '0.2100', volume_fp: '120.00', open_interest_fp: '50.00', notional_value_dollars: '1.0000', result: '' }],
};
const cls = classifyEvent(ev);
assert.deepEqual(cls.map(c => c.topic), ['golf']);
assert.ok(cls[0].basis[0].startsWith('keyword:'));

const row = rowsFromEvents([ev])[0];
assert.equal(row.ticker, 'KXGOLF-TEST-A');
assert.equal(row.yes_bid, 0.2);
assert.equal(row.open_interest_notional_derived, 50);
assert.equal(row.source_url, `${API_BASES.demo}/markets/KXGOLF-TEST-A`);
assert.equal(row.kalshi_url, 'https://kalshi.com/markets/kxgolf');
assert.equal(row.event_settlement_sources[0].url, 'https://www.pgatour.com');

// Non-matching event is dropped.
assert.equal(rowsFromEvents([{ ...ev, title: 'Snow in Boston', markets: ev.markets, category: 'Climate', tags: [], series_ticker: 'KXSNOW' }]).length, 0);
// "gas" must not match inside other words (e.g. Vegas) but must match natural gas.
assert.equal(classifyEvent({ title: 'Vegas odds', markets: [], category: 'Sports' }).length, 0);
assert.equal(classifyEvent({ title: 'Natural gas price', markets: [] })[0].topic, 'gas-prices');

// Swing: net move up 0.12 within window -> alert.
const now = 1_000_000;
const pts = [{ t: now - 200, p: 0.30 }, { t: now - 100, p: 0.36 }, { t: now - 10, p: 0.42 }];
const sw = detectSwing(pts, { now });
assert.equal(sw.type, 'net move');
assert.equal(sw.direction, 'up');
assert.ok(Math.abs(sw.net - 0.12) < 1e-9);
// Below threshold -> none.
assert.equal(detectSwing([{ t: now - 10, p: 0.5 }, { t: now - 5, p: 0.55 }], { now }), null);
// Old trades outside window are ignored.
assert.equal(detectSwing([{ t: now - 900, p: 0.1 }, { t: now - 10, p: 0.5 }], { now }), null);
// Intra-window swing that reverses: range >= .10 but net small.
const rev = detectSwing([{ t: now - 200, p: 0.40 }, { t: now - 150, p: 0.52 }, { t: now - 10, p: 0.42 }], { now });
assert.equal(rev.type, 'intra-window swing');

// Screen: up move to 0.42 -> YES side at 0.42, payout 2.38x, passes if >=3 trades.
const s1 = screenAlert({ ...sw, trades: 3 });
assert.equal(s1.pass, true);
assert.equal(screenAlert({ ...sw, trades: 2 }).pass, false);
// Down move: side is NO at 1 - to.
const sd = screenAlert({ direction: 'down', to: 0.8, trades: 5 });
assert.ok(Math.abs(sd.sidePrice - 0.2) < 1e-9);

// Orderbook: bids only, ascending arrays, best last. Implied YES ask = 1 - best NO bid.
const ob = parseOrderbook({ orderbook_fp: { yes_dollars: [['0.1500', '100.00'], ['0.4200', '13.00']], no_dollars: [['0.5600', '17.00'], ['0.0100', '200.00']] } });
assert.equal(ob.yes_bids[0].price, 0.42);
assert.equal(ob.no_bids[0].contracts, 17);
assert.equal(ob.implied_yes_ask, 0.44);

// Pagination: follows cursor until empty; passes filters; respects maxPages.
const pages = [{ events: [1], cursor: 'a' }, { events: [2], cursor: 'b' }, { events: [3], cursor: '' }];
let calls = 0;
const fake = async url => { const u = new URL(url); const i = calls++; return { ok: true, status: 200, json: async () => pages[i] }; };
const got = await fetchPaged('https://x.test/events?limit=1', 'events', { fetchImpl: fake, pageDelayMs: 0 });
assert.deepEqual(got.items, [1, 2, 3]);
assert.equal(got.truncated, false);
calls = 0;
const capped = await fetchPaged('https://x.test/events', 'events', { fetchImpl: fake, pageDelayMs: 0, maxPages: 2 });
assert.equal(capped.truncated, true);
assert.equal(capped.items.length, 2);

console.log('lib tests passed');
