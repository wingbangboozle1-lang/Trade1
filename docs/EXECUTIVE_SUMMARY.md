# Executive Summary — Kalshi Demo Trading Dashboard (Trade1)

**Prepared by:** session `sess-a1-9a0ad587` · **Date:** 2026-11-20 · **Environment:** Kalshi Demo (`https://external-api.demo.kalshi.co/trade-api/v2`)

## 1. What was built

A live, interactive prediction-market dashboard on GitHub Pages that:

1. **Tracks the highest-dollar live events** on the Kalshi demo exchange, restricted to five topics:
   **gas prices, elections, culture, crypto, and golf** (one subpage per topic; events within a topic
   stay grouped together; topics are never mixed).
2. **Follows live events until they resolve**, then displays **how each resolved — YES or NO** — using the
   market's `result` and `settlement_ts` fields ($1/contract to holders of the winning side per the
   official settlement rules).
3. **Automates simulated trades** ("paper engine") that executes three strategies against live demo
   quotes/orderbooks with Kalshi's official fee formula, so strategy performance can be measured
   without needing an authenticated demo account.
4. **Tracks portfolio performance** — equity curve, P&L by strategy, by topic, win rate, max drawdown,
   and a fully categorized trade log (every simulated trade is tagged with strategy + topic + outcome).
5. **Charts price movement over time** with an X axis of time and selectable granularity — **seconds,
   minutes, or hours** — and a Y axis of contract price (USD 0–1); second-level points are captured
   from live polls, minute/hour candles come from the official candlestick endpoint.
6. **Shows liquidity and depth** — contracts available at each price level (orderbook depth bars for
   YES and NO bids, per the official orderbook format).
7. **Detects price jumps ≥ $0.10 in either direction** and surfaces them in a live feed with links to
   the official Kalshi market page, the event's official settlement sources, and a news search query.

## 2. Why the demo environment and what it means

Kalshi's demo is a **separate practice exchange with mock funds**; credentials are separate from
production, and Kalshi warns that demo prices/behavior "may not be reflective of real markets."
All market data here is real data from the demo exchange; all trading is simulated. This is the
correct, safe substrate for strategy testing.

## 3. Architecture in brief

- **100% static site** (HTML/JS/CSS + vendored Chart.js) served by GitHub Pages — no backend, no server
  credentials, nothing to host or secure.
- **Client-side data flow:** browser → public, unauthenticated demo REST endpoints
  (`/series`, `/events`, `/markets`, `/markets/{ticker}/orderbook`, `/markets/trades`,
  `/series/{s}/markets/{m}/candlesticks`). These endpoints require **no API key** per official docs.
- **Rate-limit aware:** staggered polling (topic markets every ~5 s; orderbook/trades for the selected
  market every ~5 s), exponential backoff on HTTP 429, per-panel "last updated" timestamps.
- **Persistence:** watchlist, price history, jump log, and the paper portfolio live in the browser's
  `localStorage` (per-browser; exportable as CSV/JSON).
- **Honest failure:** if the API is unreachable (e.g., network/CORS issue), the UI shows exactly what
  failed and links the API URL; it never fabricates market data. Unverifiable values are left blank
  and flagged.

## 4. Verification posture

- Every endpoint, parameter, and response field used was checked against **official Kalshi documentation**
  and, where possible, against **live demo API responses fetched this session** (KXGAS, KXETH, KXBTC,
  KXTIME, KXPGA, KXMASTERS; open + settled markets). See [API_NOTES.md](API_NOTES.md).
- Every dashboard table row carries a **source link**: the exact demo REST URL that produced the value,
  plus the official kalshi.com series page and the official settlement-source page for that event.
- Values that cannot be confirmed from an official source are **left blank and flagged** — never inferred.
  See [FLAGGED.md](FLAGGED.md) (10 flagged items, including unconfirmed CORS behavior and the absent
  demo-account credentials).

## 5. Key verified facts (with sources)

| Fact | Value | Source |
|---|---|---|
| Demo REST root | `https://external-api.demo.kalshi.co/trade-api/v2` | [docs](https://docs.kalshi.com/getting_started/demo_env.md) |
| Demo WebSocket root | `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` (requires signed key) | [docs](https://docs.kalshi.com/getting_started/demo_env.md) |
| Public market data | No authentication required | [docs](https://docs.kalshi.com/getting_started/quick_start_market_data.md) |
| Candlestick periods | 1 min / 60 min / 1 day; ≤ 5,000 periods per request | [docs](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) |
| Orderbook shape | `[price_$, qty]` pairs ascending, best bid last; YES bid @ X ≡ NO ask @ 100−X | [docs](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) |
| Settlement | YES result → $1/contract to YES holders; NO result → $1/contract to NO holders; no settlement fee | [docs](https://docs.kalshi.com/getting_started/market_settlement.md) |
| Taker fee | `roundup(M × 0.07 × C × P × (1−P))` | [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| Maker fee | `roundup(M × 0.0175 × C × P × (1−P))`, M default 0 (zero unless listed) | [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) |
| Verified topic series on demo | KXGAS (gas), KXBTC/KXETH (crypto), KXTIME (culture), KXPGA/KXMASTERS (golf), category `Elections` | [live API probes](SOURCES.md) |

## 6. Known limitations (all flagged, none blocking)

1. **WebSocket streaming requires authenticated demo API keys** (official docs); the dashboard therefore
   polls REST and shows fetch timestamps. Suggestion to upgrade: attach demo API keys.
2. **Automated trading against the real demo account requires a human-created demo account + API key.**
   The paper engine runs fully autonomously today; the authenticated connector (signing per official docs)
   is implemented and dormant, activating only when keys are supplied in the browser.
3. **Jump→news attribution** links to official settlement sources and a pre-filled news search; without a
   news API, "the link that caused it" cannot be verified and is not claimed.
4. **Demo market universe is sparse** — some topics may have few or no open markets at a given time; pages
   say so explicitly rather than showing fake rows.

## 7. What to look at first

- Landing page: cross-topic "highest dollar value" ranking + executive summary.
- Topic pages (Gas Prices / Elections / Culture / Crypto / Golf): event tables, price chart with
  seconds/minutes/hours selector, orderbook depth, jump feed, resolution tracker.
- Strategies page: enable strategies, watch simulated fills in the live trade log, review portfolio
  performance by strategy/topic/outcome.
- Flagged for Review: the 10 items above with links, so nothing is hidden.
