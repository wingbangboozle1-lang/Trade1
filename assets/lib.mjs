// Shared logic for the Kalshi demo monitor. Used by the browser app and by
// scripts/build_snapshot.mjs (Node 20+). No dependencies.
//
// Every number shown on the site comes from an official Kalshi Trade API
// response (docs: https://docs.kalshi.com/api-reference). Derived values are
// labelled as derived in the UI and the formula is stated in the code below.

export const API_BASES = {
  demo: 'https://external-api.demo.kalshi.co/trade-api/v2',
  prod: 'https://external-api.kalshi.com/trade-api/v2',
};

// Topic rules. A topic matches an event when (a) the official Kalshi
// `category` of the event is listed, or (b) a keyword regex matches the
// event/market text. Every match records its basis so it can be reviewed.
// These keyword rules are heuristics and are listed on the Flagged page.
export const TOPICS = [
  {
    id: 'gas-prices', label: 'Gas prices', categories: [],
    keywords: [/\bgas prices?\b/i, /\bgasoline\b/i, /\bdiesel\b/i],
  },
  {
    id: 'elections', label: 'Elections', categories: ['Elections'],
    keywords: [/\belection/i, /\bprimary (elections?|winners?|races?|votes?)\b/i, /\bprimaries\b/i, /\bsenat/i, /\bgovernor\b/i, /\bcongress/i, /\bpresiden/i, /\bmayor\b/i, /\bnominee\b/i],
  },
  {
    id: 'culture', label: 'Culture', categories: ['Entertainment'],
    keywords: [/\bmovie/i, /\bbox office\b/i, /\boscar/i, /\bgrammy/i, /\bemmy/i, /\balbum/i, /\bspotify\b/i, /\bbillboard\b/i, /\bnetflix\b/i, /\bmusic\b/i, /\bcelebrit/i, /\bbroadway\b/i],
  },
  {
    id: 'crypto', label: 'Crypto', categories: ['Crypto'],
    keywords: [/\bbitcoin\b/i, /\bbtc\b/i, /\bethereum\b/i, /\beth\b/i, /\bsolana\b/i, /\bxrp\b/i, /\bdogecoin\b/i, /\bcrypto/i],
  },
  {
    id: 'golf', label: 'Golf', categories: [],
    keywords: [/\bgolf\b/i, /\bpga\b/i, /\blpga\b/i, /\bryder cup\b/i, /\bmasters\b/i, /\baugusta\b/i],
  },
];

export const TOPIC_IDS = TOPICS.map(t => t.id);
export const topicById = id => TOPICS.find(t => t.id === id) || null;

export const ALERT_THRESHOLD = 0.10; // dollars, per the brief (>= $0.10 either direction)

const num = v => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// Classify one event. Returns [{topic, basis: [strings]}].
export function classifyEvent(event) {
  const parts = [event.title, event.sub_title, event.series_ticker, ...(Array.isArray(event.tags) ? event.tags : [])];
  for (const m of event.markets || []) parts.push(m.title, m.yes_sub_title, m.no_sub_title, m.subtitle);
  const text = parts.filter(Boolean).join(' | ');
  const out = [];
  for (const t of TOPICS) {
    const basis = [];
    if (event.category && t.categories.includes(event.category)) basis.push(`official category: ${event.category}`);
    for (const re of t.keywords) {
      const hit = text.match(re);
      if (hit) { basis.push(`keyword: "${hit[0]}"`); break; }
    }
    if (basis.length) out.push({ topic: t.id, basis });
  }
  return out;
}

// Turn one nested market into a flat, source-linked row.
export function marketRow(event, m, topicMatches, base = API_BASES.demo) {
  const oi = num(m.open_interest_fp);
  const notional = num(m.notional_value_dollars);
  const series = event.series_ticker || null;
  return {
    ticker: m.ticker,
    event_ticker: event.event_ticker || m.event_ticker || null,
    series_ticker: series,
    title: m.title || event.title || m.ticker,
    yes_label: m.yes_sub_title ?? null,
    category: event.category ?? null,
    topics: topicMatches.map(x => x.topic),
    match_basis: topicMatches.flatMap(x => x.basis.map(b => `${x.topic} · ${b}`)),
    status: m.status ?? null,
    result: m.result ? m.result : null,
    open_time: m.open_time ?? null,
    close_time: m.close_time ?? null,
    expected_expiration_time: m.expected_expiration_time ?? null,
    yes_bid: num(m.yes_bid_dollars),
    yes_ask: num(m.yes_ask_dollars),
    no_bid: num(m.no_bid_dollars),
    no_ask: num(m.no_ask_dollars),
    last_price: num(m.last_price_dollars),
    volume_contracts: num(m.volume_fp),
    volume_24h_contracts: num(m.volume_24h_fp),
    open_interest_contracts: oi,
    notional_value: notional,
    // DERIVED (not an official field): open interest x notional value per contract.
    // It is the dollar amount that would be paid out if every open contract settles.
    open_interest_notional_derived: oi != null && notional != null ? Math.round(oi * notional * 100) / 100 : null,
    settlement_value: num(m.settlement_value_dollars),
    settlement_ts: m.settlement_ts ?? null,
    updated_time: m.updated_time ?? null,
    // Official API endpoint for this exact market (verification link).
    source_url: `${base}/markets/${encodeURIComponent(m.ticker)}`,
    // Kalshi UI series page, pattern shown in the official Quick Start guide.
    kalshi_url: series ? `https://kalshi.com/markets/${series.toLowerCase()}` : null,
    // Official settlement sources Kalshi lists on the event (context links, not causes).
    event_settlement_sources: (event.settlement_sources || []).filter(s => s && s.url).map(s => ({ name: s.name, url: s.url })),
  };
}

// Flatten events into market rows. Only events that match at least one topic are kept.
export function rowsFromEvents(events, base = API_BASES.demo) {
  const rows = [];
  for (const ev of events) {
    const matches = classifyEvent(ev);
    if (!matches.length) continue;
    for (const m of ev.markets || []) rows.push(marketRow(ev, m, matches, base));
  }
  return rows;
}

// Cursor-paginated GET. Stops on empty cursor or maxPages. Retries 429 with backoff.
export async function fetchPaged(url, listKey, { maxPages = 20, pageDelayMs = 150, fetchImpl = fetch, log = () => {} } = {}) {
  const items = [];
  let cursor = '';
  let pages = 0;
  let truncated = false;
  for (;;) {
    const u = new URL(url);
    if (cursor) u.searchParams.set('cursor', cursor);
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetchImpl(u.toString(), { headers: { Accept: 'application/json' } });
      if (res.status !== 429 || attempt >= 6) break;
      const wait = 1000 * 2 ** attempt;
      log(`429 from ${u.pathname}; backing off ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.pathname}`);
    const data = await res.json();
    items.push(...(data[listKey] || []));
    pages += 1;
    cursor = data.cursor || '';
    if (!cursor) break;
    if (pages >= maxPages) { truncated = true; break; }
    if (pageDelayMs) await new Promise(r => setTimeout(r, pageDelayMs));
  }
  return { items, pages, truncated };
}

// Liquidity: orderbook levels. Kalshi returns bids only; arrays ascending, best bid last.
export function parseOrderbook(payload) {
  const ob = payload.orderbook_fp || payload.orderbook || {};
  const lv = arr => (Array.isArray(arr) ? arr : []).map(([p, q]) => ({ price: Number(p), contracts: Number(q) }));
  const yes = lv(ob.yes_dollars).sort((a, b) => b.price - a.price);
  const no = lv(ob.no_dollars).sort((a, b) => b.price - a.price);
  const bestNo = no[0] ? no[0].price : null;
  return {
    yes_bids: yes,          // YES buy orders, highest price first
    no_bids: no,            // NO buy orders, highest price first
    implied_yes_ask: bestNo == null ? null : Math.round((1 - bestNo) * 10000) / 10000, // DERIVED: $1.00 - best NO bid
  };
}

// Swing detection on a list of trades within one market, ascending by time.
// trades: [{t: seconds, p: yes price dollars}] . Returns null if no qualifying swing.
export function detectSwing(points, { windowSec = 300, threshold = ALERT_THRESHOLD, now = Date.now() / 1000 } = {}) {
  const pts = points.filter(x => x.t >= now - windowSec && Number.isFinite(x.p)).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const first = pts[0].p, last = pts[pts.length - 1].p;
  const hi = Math.max(...pts.map(x => x.p)), lo = Math.min(...pts.map(x => x.p));
  const net = Math.round((last - first) * 10000) / 10000;
  const range = Math.round((hi - lo) * 10000) / 10000;
  if (Math.abs(net) >= threshold - 1e-9) return { type: 'net move', direction: net > 0 ? 'up' : 'down', from: first, to: last, high: hi, low: lo, net, range, trades: pts.length, at: pts[pts.length - 1].t };
  if (range >= threshold - 1e-9) return { type: 'intra-window swing', direction: last >= first ? 'up' : 'down', from: first, to: last, high: hi, low: lo, net, range, trades: pts.length, at: pts[pts.length - 1].t };
  return null;
}

// Placeholder "high-ROI screen" rule. NOT a validated model and not backtested:
// it only encodes the user's threshold plus a payout test for the side taken.
// Thresholds are exported so they can be changed in one place after review.
export const SCREEN = { minTrades: 3, minPayoutMultiple: 2.0, maxSidePrice: 0.50 };
export function screenAlert(alert) {
  const sidePrice = alert.direction === 'up' ? alert.to : 1 - alert.to; // YES price, or NO price for a down move
  if (!(sidePrice > 0 && sidePrice < 1)) return { pass: false, sidePrice, payoutMultiple: null, reason: 'no valid side price' };
  const payoutMultiple = Math.round((1 / sidePrice) * 100) / 100; // DERIVED: $1 payout / price paid
  const pass = alert.trades >= SCREEN.minTrades && payoutMultiple >= SCREEN.minPayoutMultiple && sidePrice <= SCREEN.maxSidePrice;
  return { pass, sidePrice, payoutMultiple, reason: pass ? 'passes placeholder screen' : 'fails placeholder screen' };
}

export function fmtUsd(v, digits = 2) { return v == null ? '—' : '$' + Number(v).toFixed(digits); }
export function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
