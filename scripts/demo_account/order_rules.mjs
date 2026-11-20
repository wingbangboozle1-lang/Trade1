// Pure order-validation rules for the DEMO executor. No network access, so they can be tested offline.
//
// Price and count formats (official, verified 2026-11-20):
//   https://docs.kalshi.com/getting_started/fixed_point_migration
//   - Prices: fixed-point dollar strings, up to 4 decimals ("0.5600").
//   - Valid prices are defined per market by price_ranges [{start,end,step}] in dollars.
//     Any off-grid price is rejected by the exchange.
//   - Counts: fixed-point strings with up to 2 decimals ("1.00").
// Side semantics (official):
//   https://docs.kalshi.com/api-reference/orders/create-order-v2 (BookSide)
//   bid = buy YES at price, ask = sell YES. This executor places ONLY bid (buy YES) orders.

// Hard limits. These are intentionally small and cannot be raised from the plan file.
export const LIMITS = Object.freeze({
  MAX_ORDERS_PER_RUN: 3,
  MAX_CONTRACTS_PER_ORDER: 1,
  MAX_RUN_NOTIONAL_DOLLARS: 3.0, // sum over orders of price * count, in dollars (demo money)
  MIN_PRICE_UNITS: 100, // $0.0100 in 1e-4 dollar units
  MAX_PRICE_UNITS: 9900, // $0.9900
});

/** "0.5600" -> 5600 (units of $0.0001). Throws on malformed or >4-decimal input. */
export function dollarsToUnits(s) {
  const str = String(s).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(str)) throw new Error(`Invalid dollar string: ${s}`);
  const [whole, frac = ''] = str.split('.');
  return Number(whole) * 10000 + Number((frac + '0000').slice(0, 4));
}

/** 5600 -> "0.5600" */
export function unitsToDollars(u) {
  const w = Math.floor(u / 10000);
  const f = String(u % 10000).padStart(4, '0');
  return `${w}.${f}`;
}

/**
 * True when `priceUnits` lies on the grid described by a market's price_ranges.
 * price_ranges entries are { start, end, step } as dollar strings.
 */
export function isOnPriceGrid(priceUnits, priceRanges) {
  if (!Array.isArray(priceRanges) || priceRanges.length === 0) return false;
  return priceRanges.some(({ start, end, step }) => {
    const s = dollarsToUnits(start), e = dollarsToUnits(end), st = dollarsToUnits(step);
    if (st <= 0) return false;
    return priceUnits >= s && priceUnits <= e && (priceUnits - s) % st === 0;
  });
}

/**
 * Validates an order plan against live market data.
 * @param plan    { orders: [{ ticker, side, price_dollars, count, rationale }] }
 * @param markets map ticker -> market object from GET /markets/{ticker} (the `market` field)
 * @returns { accepted: [...], rejected: [{ order, reason }], runNotionalDollars }
 */
export function validatePlan(plan, markets) {
  const orders = Array.isArray(plan?.orders) ? plan.orders : [];
  const accepted = [];
  const rejected = [];
  let notionalUnits = 0;

  for (const order of orders) {
    const reject = (reason) => rejected.push({ order, reason });
    if (accepted.length >= LIMITS.MAX_ORDERS_PER_RUN) { reject(`over MAX_ORDERS_PER_RUN=${LIMITS.MAX_ORDERS_PER_RUN}`); continue; }
    if (!order || typeof order.ticker !== 'string' || !order.ticker) { reject('missing ticker'); continue; }
    if (order.side !== 'bid') { reject('only side=bid (buy YES) is permitted by this executor'); continue; }

    let priceUnits, count;
    try { priceUnits = dollarsToUnits(order.price_dollars); } catch (e) { reject(e.message); continue; }
    if (priceUnits < LIMITS.MIN_PRICE_UNITS || priceUnits > LIMITS.MAX_PRICE_UNITS) { reject('price outside $0.01-$0.99'); continue; }
    count = Number(order.count);
    if (!Number.isInteger(count) || count < 1 || count > LIMITS.MAX_CONTRACTS_PER_ORDER) { reject(`count must be an integer 1..${LIMITS.MAX_CONTRACTS_PER_ORDER}`); continue; }

    const m = markets?.[order.ticker];
    if (!m) { reject('market not fetched from the API'); continue; }
    // REST status for a tradeable market is "active" (the "open" value is only a list filter).
    // Source: https://docs.kalshi.com/getting_started/market_lifecycle
    if (m.status !== 'active') { reject(`market status is "${m.status}", not active`); continue; }
    if (!isOnPriceGrid(priceUnits, m.price_ranges)) { reject('price is not on the market price_ranges grid'); continue; }

    const notional = (priceUnits * count) / 10000; // dollars
    if ((notionalUnits + priceUnits * count) / 10000 > LIMITS.MAX_RUN_NOTIONAL_DOLLARS) { reject(`run notional would exceed $${LIMITS.MAX_RUN_NOTIONAL_DOLLARS.toFixed(2)}`); continue; }
    notionalUnits += priceUnits * count;
    accepted.push({ ...order, price_dollars: unitsToDollars(priceUnits), count, notional_dollars: notional });
  }
  return { accepted, rejected, runNotionalDollars: notionalUnits / 10000 };
}
