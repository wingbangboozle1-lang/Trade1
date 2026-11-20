// demo-account/assets/engine.js — pure paper-trading + portfolio logic. No DOM, no network.
// Importable from the browser (type=module) and from Node tests (see ../package.json {"type":"module"}).
//
// Every price is carried in integer units of $0.0001 ("units", 1e-4 dollar) to avoid float error
// on the ≥ $0.10 threshold (lesson logged by session f6094c46: 0.66->0.56 renders as 0.09999...).
//
// OFFICIAL SOURCES (verified line-by-line 2026-11-20, see ../VERIFICATION.md):
// - Signing + auth headers: https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
// - Create Order (V2) body/enums: https://docs.kalshi.com/api-reference/orders/create-order-v2
// - Get Balance fields: https://docs.kalshi.com/api-reference/portfolio/get-balance
// - Get Positions fields/params: https://docs.kalshi.com/api-reference/portfolio/get-positions
// - Fees (taker = roundup(M*0.07*C*P*(1-P)); maker M default 0; no settlement fee):
//   https://kalshi.com/docs/kalshi-fee-schedule.pdf (effective 2026-07-07)
// - Fixed-point fields (_dollars/_fp): https://docs.kalshi.com/getting_started/fixed_point_migration

export const UNIT = 1e-4; // one unit = $0.0001

/** "0.5600" -> 5600 units. Accepts up to 4 decimals. Throws on malformed input. */
export function dollarsToUnits(s) {
  const str = String(s ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(str)) throw new Error(`Invalid dollar string: ${s}`);
  const [whole, frac = ''] = str.split('.');
  return Number(whole) * 10000 + Number((frac + '0000').slice(0, 4));
}

/** 5600 -> "0.5600" */
export function unitsToDollars(u) {
  const w = Math.floor(u / 10000);
  const f = String(Math.abs(u % 10000)).padStart(4, '0');
  return `${w}.${f}`;
}

/** Fixed-point quantity string ("10.00") -> contracts (integer, rounds to 2 decimals). */
export function fpToContracts(s) {
  const n = Number(String(s ?? '0').trim());
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// FEES (official fee schedule PDF, effective 2026-07-07)
//   taker: fees = round up (M * 0.07 * C * P * (1-P))
//   maker: fees = round up (M * 0.0175 * C * P * (1-P)), maker multiplier M defaults to 0
//   "round up" such that fee + positionCost is rounded up to a cent.
//   NOTE (flagged F-DA-5): the PDF's prose says "centicent", but every cell of the PDF's own
//   General Trading Fees Table is reproduced by rounding the total (cost + raw fee) UP TO THE
//   CENT. This implementation matches all 42 table cells (tests/demo-account.test.mjs) and is
//   therefore the rule used for paper P&L. The prose/table inconsistency is flagged for review.
// ---------------------------------------------------------------------------

/** Taker fee in units, integer-exact. priceUnits: 1e-4 $ units; count: contracts; multiplier M. */
export function takerFeeUnits(costUnits, priceUnits, count, multiplier = 1) {
  // taker rate = 0.07 = 7/100
  return feeUnitsExact(costUnits, priceUnits, count, multiplier, 7n, 100n);
}

/** Maker fee in units (multiplier defaults to 0 -> fee 0 unless a series overrides it). */
export function makerFeeUnits(costUnits, priceUnits, count, multiplier = 0) {
  // maker rate = 0.0175 = 175/10000
  return feeUnitsExact(costUnits, priceUnits, count, multiplier, 175n, 10000n);
}

// raw fee in units = M * rate * C * p * (10000-p) / 10000        [P = p/10000 dollars]
//                  = num / den  with num = M*rateNum*C*p*(10000-p), den = rateDen*10000
// fee = ceil_to_cent(cost + rawFee) - cost   (matches every cell of the official fee table)
function feeUnitsExact(costUnits, priceUnits, count, multiplier, rateNum, rateDen) {
  const M = BigInt(multiplier);
  const C = BigInt(count);
  const p = BigInt(priceUnits);
  if (p < 0n || p > 10000n) throw new Error('price out of range');
  const num = M * rateNum * C * p * (10000n - p); // exact (BigInt)
  const den = rateDen * 10000n;
  const cost = BigInt(costUnits);
  const totalScaled = cost * den + num; // (cost + rawFee) * den
  const centsCount = (totalScaled + den * 100n - 1n) / (den * 100n); // ceil(total / 100 units)
  return Number(centsCount * 100n) - costUnits;
}

// ---------------------------------------------------------------------------
// FEE MULTIPLIERS — the environment's own series metadata is the source.
//
// The official Get Series List schema returns two fee fields per series:
//   "fee_type": "quadratic"   and   "fee_multiplier": <int>
//   https://docs.kalshi.com/api-reference/market/get-series-list
// The API exposes ONE multiplier, which is the taker multiplier M in
//   fees = round up (M * 0.07 * C * P * (1-P)).
// Every in-scope series read live on the demo host on 2026-11-20 reports
//   fee_type "quadratic" and fee_multiplier 1 — INCLUDING KXBTCY and KXETHY:
//     https://external-api.demo.kalshi.co/trade-api/v2/series/KXBTCY
//     https://external-api.demo.kalshi.co/trade-api/v2/series/KXETHY
// The published PDF's "Non-Standard Fees" table lists KXBTCY / KXETHY as 0 / 0.
// Those are the PRODUCTION values; the demo feed reports 1 for them.
// We therefore follow the demo API (flagged F-DA-12) and keep the PDF
// transcription below only as a labelled production reference.
// Check https://kalshi.com/fee-schedule for scheduled changes.
// ---------------------------------------------------------------------------

/** Default taker multiplier M when the series metadata was not read
 *  ("M = the multiplier for each contract (default is 1 unless otherwise
 *  indicated)", official fee schedule PDF). */
export const DEFAULT_TAKER_MULTIPLIER = 1;

/** PRODUCTION multipliers transcribed from the official PDF's Non-Standard Fees
 *  table (both pages read 2026-11-20; [maker, taker]). REFERENCE ONLY — the
 *  demo engine uses the API's own `fee_multiplier`, not this table. */
export const SERIES_FEE_MULTIPLIERS_PDF = Object.freeze({
  KXAAAGASM: [1, 1], KXATPMATCH: [1, 1], KXBALLONDOR: [1, 1], KXBTCMAX150: [1, 1],
  KXBTCY: [0, 0], KXCITRINI: [0, 0], KXCPI: [1, 1], KXCPIYOY: [1, 1], KXDOED: [0, 0],
  KXEGGS: [1, 1], KXELECTIRAN: [0, 0], KXEMMYCACTO: [1, 1], KXEMMYCACTR: [1, 1],
  KXEMMYCSERIES: [1, 1], KXEMMYDACTO: [1, 1], KXEMMYDACTR: [1, 1], KXEMMYDSERIES: [1, 1],
  KXETHY: [0, 0], KXFED: [1, 1], KXFEDDECISION: [1, 1], KXGAMBLINGREPEAL: [0, 0],
  KXGDP: [1, 1], KXGREENLAND: [0, 0], KXHEISMAN: [1, 1], KXINXY: [1, 1], KXIPO: [1, 1],
  KXIRANDEMOCRACY: [0, 0], KXLALIGA: [1, 1], KXLAYOFFSYINFO: [0, 0], KXLLM1: [1, 1],
  KXPGARYDER: [1, 1], KXPGASOLHEIM: [1, 1], KXPGATOUR: [1, 1], KXRATECUTCOUNT: [1, 1],
  KXSUPERBOWLHEADLINE: [1, 1],
});

/**
 * Fee multipliers for one series in THIS environment.
 * @param seriesTicker          series ticker (kept for the reference table)
 * @param apiTakerMultiplier    `fee_multiplier` read from GET /series/{ticker};
 *                              undefined when that metadata was not read.
 * @returns {[maker, taker]}  maker fees are not modeled (0); the taker
 *          multiplier is the API value, or the documented default of 1.
 */
export function feeMultipliersForSeries(seriesTicker, apiTakerMultiplier) {
  const taker = (apiTakerMultiplier === undefined || apiTakerMultiplier === null)
    ? DEFAULT_TAKER_MULTIPLIER
    : Number(apiTakerMultiplier);
  return [0, Number.isFinite(taker) ? taker : DEFAULT_TAKER_MULTIPLIER];
}

// ---------------------------------------------------------------------------
// TOPIC CLASSIFICATION (heuristic — flagged F-DA-4; see ../VERIFICATION.md)
// Word-boundary matching (session ed8bbdf4 found "eth" inside "something" without \b).
// Golf excludes Politics/Elections series (session 10000a95 / f6094c46: Trump golf-club
// markets sat in Politics).
// ---------------------------------------------------------------------------

export const TOPICS = ['gas-prices', 'elections', 'culture', 'crypto', 'golf'];

const RULES = [
  { topic: 'gas-prices', re: /\b(gas|gasoline|oil|crude|opec|wti|brent|energy|aaagas)\b/i },
  { topic: 'elections', re: /\b(election|elections|senate|congress|house|governor|president|presidential|primary|nominee|electoral|mayor|parliament|nomination)\b/i },
  { topic: 'culture', re: /\b(oscar|oscars|grammy|grammys|emmy|emmys|billboard|box[- ]office|celebrity|met gala|album|box office|best picture|ballon d'?or)\b/i },
  { topic: 'crypto', re: /\b(btc|bitcoin|eth|ethereum|solana|dogecoin|doge|crypto|xrp|coinbase)\b/i },
  { topic: 'golf', re: /\b(golf|pga|masters|ryder cup|liv golf|open championship|us open|tour championship|fedex cup)\b/i },
];

const GOLF_EXCLUDE = /\b(election|senate|congress|house|governor|president|presidential|primary|nominee|electoral|mayor|parliament|politic)\b/i;

/**
 * Classify a market/series/event into one of TOPICS or 'other'.
 * @param obj { title, ticker/series_ticker/event_ticker, category, tags }
 */
export function classifyTopic(obj) {
  const hay = [obj.title, obj.sub_title, obj.ticker, obj.series_ticker, obj.event_ticker]
    .filter(Boolean).join(' ');
  const category = String(obj.category || '');
  const tags = Array.isArray(obj.tags) ? obj.tags.join(' ') : String(obj.tags || '');
  const cat = `${category} ${tags}`; // live category values seen: "Elections", "Entertainment", "Sports", "Climate and Weather", "Crypto"

  if (RULES[3].re.test(hay) || /\b(crypto)\b/i.test(cat)) return 'crypto';
  const golfHit = RULES[4].re.test(hay) || /\bgolf\b/i.test(cat);
  if (golfHit && !GOLF_EXCLUDE.test(hay) && !/politic|election/i.test(cat)) return 'golf';
  if (RULES[0].re.test(hay)) return 'gas-prices';
  if (RULES[1].re.test(hay) || /\b(politics|elections)\b/i.test(cat)) return 'elections';
  if (RULES[2].re.test(hay) || /\b(culture|entertainment)\b/i.test(cat)) return 'culture';
  return 'other';
}

// ---------------------------------------------------------------------------
// STRATEGY SIGNALS (fixed, documented rules; no manual input, no fitting)
// Each signal: { strategy, trigger, side: 'yes'|'no', priceUnits (limit), reason }
// side 'yes' = buy YES at yes_ask; side 'no' = buy NO at no_ask.
// ---------------------------------------------------------------------------

export const JUMP_THRESHOLD_UNITS = 1000; // $0.10 exactly, integer cents (brief: ">= $0.10")

const SIGNAL_STRATEGIES = {
  'momentum-jump': 'Buy the jump direction after a >= $0.10 last-price move between samples (ride momentum).',
  'fade-jump': 'Buy the opposite side after a >= $0.10 last-price move between samples (mean reversion).',
  'value-ask': 'Buy YES when the ask is <= $0.25 and 24h volume >= 100 contracts (cheap active contracts, high payoff multiple).',
};

export const STRATEGY_DEFINITIONS = SIGNAL_STRATEGIES;

/**
 * @param prev  previous market sample { lastUnits, tsMs }
 * @param curr  current market sample:
 *   { ticker, title, series_ticker, event_ticker, lastUnits, yesAskUnits, noAskUnits,
 *     vol24Units (contracts as number), status }
 * @returns array of signals (usually 0 or 1)
 */
export function generateSignals(prev, curr, alreadyHeld) {
  const out = [];
  if (!curr || curr.status !== 'active' || alreadyHeld) return out;

  const delta = prev && Number.isFinite(prev.lastUnits) && Number.isFinite(curr.lastUnits)
    ? curr.lastUnits - prev.lastUnits : null;

  if (delta !== null && Math.abs(delta) >= JUMP_THRESHOLD_UNITS) {
    const up = delta > 0;
    const canEnter = up ? curr.yesAskUnits > 0 && curr.yesAskUnits < 10000
      : curr.noAskUnits > 0 && curr.noAskUnits < 10000;
    if (canEnter) {
      out.push({
        strategy: 'momentum-jump',
        trigger: up ? 'jump-up' : 'jump-down',
        side: up ? 'yes' : 'no',
        priceUnits: up ? curr.yesAskUnits : curr.noAskUnits,
        reason: `last price moved ${up ? '+' : '−'}$${unitsToDollars(Math.abs(delta))} between samples (>= $0.10 threshold)`,
      });
      out.push({
        strategy: 'fade-jump',
        trigger: up ? 'jump-up-fade' : 'jump-down-fade',
        side: up ? 'no' : 'yes',
        priceUnits: up ? curr.noAskUnits : curr.yesAskUnits,
        reason: `fading the ${up ? '+' : '−'}$${unitsToDollars(Math.abs(delta))} jump (mean reversion)`,
      });
    }
  }
  if (curr.yesAskUnits > 0 && curr.yesAskUnits <= 2500 && (curr.vol24 || 0) >= 100) {
    out.push({
      strategy: 'value-ask',
      trigger: 'cheap-active',
      side: 'yes',
      priceUnits: curr.yesAskUnits,
      reason: `YES ask $${unitsToDollars(curr.yesAskUnits)} <= $0.25 with 24h volume ${curr.vol24}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAPER PORTFOLIO (positions held to resolution — the brief tracks events until resolved)
// ---------------------------------------------------------------------------

export function createPortfolio(startingCashUnits = 1000000) { // $100.00 demo paper money
  return {
    cashUnits: startingCashUnits,
    startingCashUnits,
    positions: [],   // open: { id, tsMs, ticker, eventTicker, title, topic, strategy, trigger, side, priceUnits, count, feeUnits, sourceUrl }
    trades: [],      // resolved/closed: position + { exitTsMs, result, payoutUnits, pnlUnits }
    equityCurve: [], // { tsMs, equityUnits }
  };
}

/** Open a paper position at `priceUnits` (taker). Returns the trade or null if blocked. */
export function openPosition(pf, signal, market, topic, tsMs, maxOpen = 8, maxPerTradeUnits = 30000) {
  const count = 1;
  const costUnits = signal.priceUnits * count;
  const series = market.series_ticker || '';
  const [makerM, takerM] = feeMultipliersForSeries(series, market.fee_multiplier);
  const feeUnits = signal.side === 'yes'
    ? takerFeeUnits(costUnits, signal.priceUnits, count, takerM)
    : takerFeeUnits(costUnits, signal.priceUnits, count, takerM); // taker both ways in paper
  if (pf.positions.length >= maxOpen) return null;
  if (costUnits + feeUnits > maxPerTradeUnits) return null;
  if (costUnits + feeUnits > pf.cashUnits) return null;
  pf.cashUnits -= costUnits + feeUnits;
  const pos = {
    id: `${market.ticker}-${tsMs}`,
    tsMs,
    ticker: market.ticker,
    eventTicker: market.event_ticker || '',
    title: market.title || market.ticker,
    topic,
    strategy: signal.strategy,
    trigger: signal.trigger,
    side: signal.side,
    priceUnits: signal.priceUnits,
    count,
    feeUnits,
    sourceUrl: market.sourceUrl || '',
  };
  pf.positions.push(pos);
  return pos;
}

/**
 * Settle every open position whose market has resolved.
 * @param resultByTicker map ticker -> 'yes' | 'no' (from the official `result` field)
 * @returns settled trade objects
 */
export function settlePositions(pf, resultByTicker, tsMs) {
  const settled = [];
  for (let i = pf.positions.length - 1; i >= 0; i--) {
    const pos = pf.positions[i];
    const result = resultByTicker[pos.ticker];
    if (result !== 'yes' && result !== 'no') continue;
    const won = (pos.side === 'yes' && result === 'yes') || (pos.side === 'no' && result === 'no');
    const payoutUnits = won ? 10000 * pos.count : 0; // $1 per winning contract (market settlement)
    pf.cashUnits += payoutUnits;
    const costUnits = pos.priceUnits * pos.count;
    const pnlUnits = payoutUnits - costUnits - pos.feeUnits;
    const trade = { ...pos, exitTsMs: tsMs, result, payoutUnits, pnlUnits, won };
    pf.trades.push(trade);
    pf.positions.splice(i, 1);
    settled.push(trade);
  }
  return settled;
}

/** Mark-to-market equity (cash + open positions valued at last price). */
export function equityUnits(pf, lastUnitsByTicker) {
  let eq = pf.cashUnits;
  for (const p of pf.positions) {
    const last = lastUnitsByTicker[p.ticker];
    eq += (Number.isFinite(last) ? last : p.priceUnits) * p.count;
  }
  return eq;
}

export function recordEquity(pf, tsMs, lastUnitsByTicker) {
  const eq = equityUnits(pf, lastUnitsByTicker);
  pf.equityCurve.push({ tsMs, equityUnits: eq });
  if (pf.equityCurve.length > 2000) pf.equityCurve.splice(0, pf.equityCurve.length - 2000);
  return eq;
}

// ---------------------------------------------------------------------------
// TRADE ANALYSIS / CATEGORISATION (the brief: "categorize trades and create strategies
// based on the type of trade")
// ---------------------------------------------------------------------------

/**
 * Group closed trades by a dimension ('topic' | 'strategy' | 'trigger') and compute stats.
 * ROI = pnl / cost-basis (cost + fees). Blank rows never invent values: 0 trades -> zeros.
 */
export function analyzeBy(trades, dimension) {
  const groups = new Map();
  for (const t of trades) {
    const key = t[dimension] || 'unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const wins = list.filter((t) => t.won).length;
    const cost = list.reduce((s, t) => s + t.priceUnits * t.count + t.feeUnits, 0);
    const pnl = list.reduce((s, t) => s + t.pnlUnits, 0);
    rows.push({
      key,
      trades: list.length,
      wins,
      losses: list.length - wins,
      winRate: list.length ? wins / list.length : 0,
      costUnits: cost,
      pnlUnits: pnl,
      roi: cost ? pnl / cost : 0,
    });
  }
  rows.sort((a, b) => b.pnlUnits - a.pnlUnits);
  return rows;
}

/** Overall stats block for the dashboard tiles. */
export function portfolioStats(pf) {
  const closed = pf.trades;
  const wins = closed.filter((t) => t.won).length;
  const realized = closed.reduce((s, t) => s + t.pnlUnits, 0);
  const fees = closed.reduce((s, t) => s + t.feeUnits, 0) + pf.positions.reduce((s, p) => s + p.feeUnits, 0);
  return {
    openPositions: pf.positions.length,
    closedTrades: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? wins / closed.length : 0,
    realizedPnlUnits: realized,
    feesUnits: fees,
    cashUnits: pf.cashUnits,
  };
}
