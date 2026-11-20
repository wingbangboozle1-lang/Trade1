/*
 * Kalshi Dashboard — central configuration.
 *
 * All values here are either (a) verified from official Kalshi sources listed in
 * docs/sources.md, or (b) clearly labeled as discovery hints. No market data is
 * hard-coded: every price/liquidity value shown in the UI is fetched live from the
 * Kalshi demo API by js/kalshi.js.
 */

/* Official Kalshi demo hosts (verified from Kalshi/kalshi-starter-code-python and
 * the task description). The dashboard tries the primary host first and falls back. */
const KALSHI_DEMO_BASES = [
  "https://external-api.demo.kalshi.co/trade-api/v2", // task-specified recommended demo endpoint
  "https://demo-api.kalshi.co/trade-api/v2",          // demo host used by official starter code
];

/* Public, no-auth market-data endpoints (verified from Kalshi official API reference). */
const PUBLIC_PATHS = {
  exchangeStatus: "/exchange/status",
  markets: "/markets",
  market: (ticker) => `/markets/${encodeURIComponent(ticker)}`,
  orderbook: (ticker, depth) =>
    `/markets/${encodeURIComponent(ticker)}/orderbook${depth ? `?depth=${depth}` : ""}`,
  events: "/events",
  event: (ticker) => `/events/${encodeURIComponent(ticker)}`,
  series: "/series",
  seriesByTicker: (ticker) => `/series/${encodeURIComponent(ticker)}`,
  candlesticks: "/markets/candlesticks",
  marketTrades: "/markets/trades",
  tagsByCategories: "/search/tags_by_categories",
};

/* Authenticated endpoints (RSA-PSS signed). Verified paths from the official
 * Kalshi API reference; used for portfolio tracking and optional demo execution. */
const PRIVATE_PATHS = {
  balance: "/portfolio/balance",
  positions: "/portfolio/positions",
  orders: "/portfolio/orders",
  fills: "/portfolio/fills",
  portfolioHistory: "/portfolio/history",
  createOrder: "/portfolio/events/orders",
  cancelOrder: (id) => `/portfolio/events/orders/${encodeURIComponent(id)}`,
  amendOrder: (id) => `/portfolio/events/orders/${encodeURIComponent(id)}/amend`,
  decreaseOrder: (id) => `/portfolio/events/orders/${encodeURIComponent(id)}/decrease`,
};

/* WebSocket endpoint (verified from official starter code). */
const KALSHI_WS_SUFFIX = "/trade-api/ws/v2";

/*
 * Topic keyword hints used to DISCOVER live Kalshi series for each topic.
 * These are discovery filters only — they are applied to series/tags returned
 * live by Kalshi. No series ticker is hard-coded as a fact; tickers shown in the
 * UI come from Kalshi's own /series response.
 */
const TOPIC_KEYWORDS = {
  gas: ["gas", "gasoline", "fuel", "crude", "oil", "wti", "natgas", "natural gas", "energy", "heating"],
  elections: [
    "election", "vote", "president", "senate", "congress", "governor", "primary",
    "campaign", "poll", "ballot", "debate", "candidate", "referendum",
  ],
  culture: [
    "culture", "movie", "film", "music", "album", "award", "oscar", "grammy",
    "tv", "show", "entertainment", "art", "book", "award", "festival", "concert",
  ],
  crypto: [
    "crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "doge",
    "cryptocurrency", "blockchain", "coin", "altcoin",
  ],
  golf: [
    "golf", "pga", "masters", "tournament", "lpx", "lpga", "ryder", "major", "open",
  ],
};

/* Topic display order for navigation. */
const TOPIC_ORDER = ["gas", "elections", "culture", "crypto", "golf"];

const TOPIC_META = {
  gas: { name: "Gas Prices", icon: "⛽", blurb: "Fuel, crude & energy markets" },
  elections: { name: "Elections", icon: "🗳️", blurb: "Votes, candidates & political outcomes" },
  culture: { name: "Culture", icon: "🎬", blurb: "Movies, music, awards & entertainment" },
  crypto: { name: "Crypto", icon: "₿", blurb: "Bitcoin, ETH & digital assets" },
  golf: { name: "Golf", icon: "⛳", blurb: "Tournaments, majors & player outcomes" },
};

/* Chart time windows: X axis is time, selectable in seconds / minutes / hours. */
const CHART_WINDOWS = [
  { label: "1 min", seconds: 60, unit: "seconds" },
  { label: "5 min", seconds: 300, unit: "minutes" },
  { label: "15 min", seconds: 900, unit: "minutes" },
  { label: "1 hour", seconds: 3600, unit: "hours" },
  { label: "6 hours", seconds: 21600, unit: "hours" },
];

/* Sharp-move threshold, in dollars (as stated in the task). */
const SHARP_MOVE_THRESHOLD_DOLLARS = 0.10;

/* Kalshi prices are expressed in cents (e.g. 45 = $0.45). */
const CENTS_PER_DOLLAR = 100;

window.KD_CONFIG = {
  KALSHI_DEMO_BASES,
  PUBLIC_PATHS,
  PRIVATE_PATHS,
  KALSHI_WS_SUFFIX,
  TOPIC_KEYWORDS,
  TOPIC_ORDER,
  TOPIC_META,
  CHART_WINDOWS,
  SHARP_MOVE_THRESHOLD_DOLLARS,
  CENTS_PER_DOLLAR,
};
