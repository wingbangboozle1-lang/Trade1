/* Trade1 — Kalshi Demo Dashboard
 * config.js — verified constants + topic definitions.
 * Sources: https://docs.kalshi.com/getting_started/demo_env.md (endpoints),
 *          https://docs.kalshi.com/api-reference/market/get-series-list.md (category/tags filters),
 *          live demo probes 2026-11-20 (KXGAS, KXETH, KXBTC, KXTIME, KXPGA, KXMASTERS, Elections category).
 */
"use strict";

const T1 = {
  API_BASE: "https://external-api.demo.kalshi.co/trade-api/v2", // official demo REST root (docs S1)
  DEMO_SITE_URL: "https://demo.kalshi.co/",                      // official demo UI (login required)
  DOCS_ENV_URL: "https://docs.kalshi.com/getting_started/demo_env.md",
  FEE_SCHEDULE_URL: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
  SETTLEMENT_DOC_URL: "https://docs.kalshi.com/getting_started/market_settlement.md",

  JUMP_THRESHOLD: 0.10,      // ≥ $0.10 in either direction (project requirement)
  PAPER_BANKROLL: 10000,     // simulated bankroll (mirrors demo mock-funds concept; labeled everywhere)

  // Polling cadence (staggered; unauthenticated requests have separate limits — docs rate_limits.md)
  POLL_MS: {
    selectedQuote: 2000,   // selected market: one /markets?event_ticker=... call refreshes its markets
    selectedBook: 4000,    // selected market orderbook
    selectedTrades: 6000,  // selected market trade tape
    table: 15000,          // tracked event quotes on a topic page
    index: 5000,           // index top-market batch via /markets?tickers=...
    watchlist: 60000,      // resolution watchlist batch
    rediscover: 600000,    // full topic rediscovery
  },

  // Topic definitions. `categories`/`tags`/`keywords`/`seeds` are used to match series & events.
  // Every seed series below was verified live on the demo API on 2026-11-20 (see docs/SOURCES.md probes).
  TOPICS: {
    "gas-prices": {
      label: "Gas Prices",
      icon: "⛽",
      accent: "#b45309",
      categories: ["Economics", "Energy and Environment"],
      tags: ["Gas", "Gasoline"],
      keywords: ["gas", "gasoline", "fuel", "eia"],
      seeds: ["KXGAS"],                 // verified: "Gas weekly", settles on U.S. EIA data
      blurb: "Weekly US average gasoline-price markets. Official settlement source: U.S. Energy Information Administration (EIA).",
    },
    "elections": {
      label: "Elections",
      icon: "🗳️",
      accent: "#1d4ed8",
      categories: ["Elections", "Politics"],
      tags: ["Elections"],
      keywords: ["election", "president", "senate", "house", "governor", "pope", "nato", "secretary"],
      seeds: [],
      blurb: "Election-category events on the demo exchange. Category \"Elections\" verified live 2026-11-20.",
    },
    "culture": {
      label: "Culture",
      icon: "🎬",
      accent: "#7c3aed",
      categories: ["Culture", "Entertainment"],
      tags: ["Culture", "Entertainment", "Awards"],
      keywords: ["time person", "box office", "celebrity", "grammy", "oscar", "emmy", "award", "movie", "met gala", "royal"],
      seeds: ["KXTIME"],                // verified: "TIME's Person of the Year", category Entertainment
      blurb: "Entertainment & culture markets (awards, celebrities, TIME's Person of the Year).",
    },
    "crypto": {
      label: "Crypto",
      icon: "₿",
      accent: "#047857",
      categories: ["Crypto", "Financials"],
      tags: ["Crypto", "Bitcoin", "Ethereum"],
      keywords: ["bitcoin", "btc", "ethereum", "eth", "solana", "crypto", "xrp"],
      seeds: ["KXBTC", "KXETH"],        // verified: "Bitcoin price range", "Ethereum range" (CF Benchmarks)
      blurb: "Bitcoin/Ethereum price-range markets. Official settlement source: CF Benchmarks RTI indices.",
    },
    "golf": {
      label: "Golf",
      icon: "⛳",
      accent: "#15803d",
      categories: ["Sports"],
      tags: ["Golf"],
      keywords: ["golf", "pga", "masters", "ryder cup", "open championship", "liv"],
      seeds: ["KXPGA", "KXMASTERS"],    // verified: "PGA Championship", "Masters Tournament", tags ["Golf"]
      blurb: "Golf markets (PGA Championship, Masters Tournament) — series carry the official \"Golf\" tag.",
    },
  },
  TOPIC_ORDER: ["gas-prices", "elections", "culture", "crypto", "golf"],

  // Max sizes to keep the browser light and API-friendly
  LIMITS: {
    seriesPerTopic: 10,
    eventsPerTopic: 12,
    marketsPerEventShown: 8,
    trackedPerTopic: 6,
    eventPages: 3,          // /events pages of 200
    historyPoints: 2400,    // per-market polled price points (≈ 80 min at 2s)
    jumpLog: 200,
    tradesRows: 60,
  },

  // Strategies (paper engine)
  STRATEGIES: {
    "momentum": {
      label: "Momentum Chase",
      desc: "Buys the YES side of a fast up-move (≥ trigger within the last few polls). Exits at profit target, stop, or timeout.",
      defaults: { trigger: 0.04, windowSec: 8, take: 0.05, stop: 0.06, timeoutSec: 300, stake: 15 },
    },
    "reversion": {
      label: "Mean Reversion",
      desc: "Buys YES when price drops ≥ trigger below its rolling baseline (bet on a bounce). Same exit rules.",
      defaults: { trigger: 0.08, baselineSec: 300, take: 0.05, stop: 0.06, timeoutSec: 300, stake: 15 },
    },
    "imbalance": {
      label: "Order-Book Imbalance",
      desc: "Buys the side whose book is deeper within $0.10 of the best bid (ratio ≥ trigger); flips side on strong opposite depth.",
      defaults: { ratio: 1.8, depthCents: 10, take: 0.05, stop: 0.06, timeoutSec: 300, stake: 15 },
    },
  },
};
