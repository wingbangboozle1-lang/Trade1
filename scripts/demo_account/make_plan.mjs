// Builds an order PLAN (no orders are sent here) from public DEMO market data.
//
// Strategy "join-best-yes-bid" (passive, test strategy):
//   - Candidate: open (status=active) market with a two-sided YES quote, spread between
//     $0.01 and $0.03 inclusive, and a non-zero resting YES bid size.
//   - Order: buy 1 YES contract at the current best YES bid (join the queue, do not cross).
// Ranking: tightest spread first, then largest 24h volume.
//
// Data sources (official):
//   GET /markets?status=open  https://docs.kalshi.com/api-reference/market/get-markets
//   Market fields yes_bid_dollars, yes_ask_dollars, yes_bid_size_fp, volume_24h_fp (fixed-point strings):
//     https://docs.kalshi.com/getting_started/fixed_point_migration
//
// Output: data/demo_account/order_plan.json. The executor applies hard limits and the price grid
// before anything is sent.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { demoPublicGet, DEMO_API } from './kalshi_auth.mjs';
import { LIMITS, dollarsToUnits } from './order_rules.mjs';

const OUT = 'data/demo_account/order_plan.json';
const SOURCES = [
  'https://docs.kalshi.com/api-reference/market/get-markets',
  'https://docs.kalshi.com/getting_started/fixed_point_migration',
  'https://docs.kalshi.com/getting_started/market_lifecycle',
];

const markets = [];
let cursor = '';
for (let page = 0; page < 10; page++) {
  const q = `/markets?status=open&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const res = await demoPublicGet(q);
  markets.push(...(res.markets || []));
  cursor = res.cursor || '';
  if (!cursor) break;
}

const candidates = markets
  .filter((m) => m.status === 'active' && m.yes_bid_dollars && m.yes_ask_dollars)
  .map((m) => {
    const bid = dollarsToUnits(m.yes_bid_dollars);
    const ask = dollarsToUnits(m.yes_ask_dollars);
    return { m, bid, ask, spread: ask - bid, bidSize: Number(m.yes_bid_size_fp || 0), vol24: Number(m.volume_24h_fp || 0) };
  })
  .filter((c) => c.bid > 0 && c.ask < 10000 && c.spread >= 100 && c.spread <= 300 && c.bidSize > 0)
  .sort((a, b) => a.spread - b.spread || b.vol24 - a.vol24)
  .slice(0, LIMITS.MAX_ORDERS_PER_RUN);

const plan = {
  generated_at: new Date().toISOString(),
  environment: 'demo',
  strategy: 'join-best-yes-bid',
  strategy_definition: 'Buy 1 YES contract at the current best YES bid when the YES spread is $0.01-$0.03 and a YES bid is resting.',
  markets_scanned: markets.length,
  sources: SOURCES,
  orders: candidates.map(({ m, bid, ask, spread, bidSize, vol24 }) => ({
    ticker: m.ticker,
    side: 'bid', // buy YES (BookSide bid = YES leg)
    price_dollars: m.yes_bid_dollars,
    count: 1,
    rationale: `YES bid ${m.yes_bid_dollars}, YES ask ${m.yes_ask_dollars}, spread ${(spread / 10000).toFixed(4)}, resting YES bid size ${bidSize}, 24h volume ${vol24}.`,
    source: `${DEMO_API}/markets/${m.ticker}`,
  })),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(plan, null, 2) + '\n');
console.log(`Plan written: ${plan.orders.length} order(s) from ${markets.length} open demo markets.`);
