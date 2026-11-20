// Executes an order PLAN against the Kalshi DEMO environment, with guardrails.
//
// Safety model:
//   1. Dry-run is the default. Orders are sent only when ALLOW_DEMO_ORDERS=true AND demo credentials exist.
//   2. Host is hard-coded to the demo environment (see kalshi_auth.mjs).
//   3. Every order is re-checked against live market data (status, price grid) and the hard limits in order_rules.mjs.
//   4. Only side=bid (buy YES) orders are placed. Each run is capped at 3 orders and $3.00 notional.
//
// Endpoints (official):
//   GET  /markets/{ticker}           https://docs.kalshi.com/api-reference/market/get-market
//   POST /portfolio/events/orders    https://docs.kalshi.com/api-reference/orders/create-order-v2
//   Request body fields: ticker, client_order_id, side, count (fixed-point), price (fixed-point dollars),
//   time_in_force, self_trade_prevention_type. Scope needed: write::trade.
//
// Output: appends to data/demo_account/execution_log.json (no credentials are logged).

import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadCredentials, demoRequest, demoPublicGet } from './kalshi_auth.mjs';
import { validatePlan } from './order_rules.mjs';

const PLAN = process.argv[2] || 'data/demo_account/order_plan.json';
const LOG = 'data/demo_account/execution_log.json';
const creds = loadCredentials();
const live = process.env.ALLOW_DEMO_ORDERS === 'true' && creds !== null;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

const plan = await readJson(PLAN, null);
if (!plan) {
  console.log(`No plan at ${PLAN}; nothing to do.`);
  process.exit(0);
}

// Fetch live market data for each planned ticker (public endpoint, no credentials needed).
const markets = {};
for (const o of plan.orders || []) {
  if (!o?.ticker || markets[o.ticker]) continue;
  try {
    const res = await demoPublicGet(`/markets/${encodeURIComponent(o.ticker)}`);
    markets[o.ticker] = res.market ?? res; // response wrapper verified in the guard below
  } catch (e) {
    console.log(`Could not load ${o.ticker}: ${e.message}`);
  }
}

const { accepted, rejected, runNotionalDollars } = validatePlan(plan, markets);
const attempts = [];
const at = new Date().toISOString();

for (const o of accepted) {
  const body = {
    ticker: o.ticker,
    client_order_id: crypto.randomUUID(),
    side: 'bid',
    count: `${o.count}.00`,
    price: o.price_dollars,
    time_in_force: 'good_till_canceled',
    self_trade_prevention_type: 'taker_at_cross',
    post_only: true, // rest only; never cross the book
    reduce_only: false,
    cancel_order_on_pause: true,
  };
  if (!live) {
    attempts.push({ at, mode: 'dry_run', ticker: o.ticker, request: body, status: 'not_sent' });
    continue;
  }
  try {
    const res = await demoRequest(creds, 'POST', '/portfolio/events/orders', body);
    attempts.push({
      at, mode: 'live', ticker: o.ticker, request: body, status: 'accepted',
      response: { order_id: res.order_id, fill_count: res.fill_count, remaining_count: res.remaining_count, average_fill_price: res.average_fill_price, ts_ms: res.ts_ms },
    });
  } catch (e) {
    attempts.push({ at, mode: 'live', ticker: o.ticker, request: body, status: 'error', error: e.message });
  }
}
for (const r of rejected) {
  attempts.push({ at, mode: live ? 'live' : 'dry_run', ticker: r.order?.ticker ?? null, status: 'rejected_by_rules', reason: r.reason });
}

const log = await readJson(LOG, { schema_version: 1, entries: [] });
log.entries.push(...attempts);
await mkdir(dirname(LOG), { recursive: true });
await writeFile(LOG, JSON.stringify(log, null, 2) + '\n');

console.log(`Mode: ${live ? 'LIVE DEMO ORDERS' : 'DRY RUN (no orders sent)'}`);
console.log(`Accepted by rules: ${accepted.length}; rejected: ${rejected.length}; run notional: $${runNotionalDollars.toFixed(2)}`);
for (const a of attempts) console.log(JSON.stringify({ ticker: a.ticker, status: a.status, reason: a.reason, error: a.error }));
