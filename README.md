# Kalshi Demo Monitor

A static GitHub Pages site that monitors **Kalshi demo** markets for five topics: gas prices, elections, culture, crypto and golf. It shows live prices, recent trade-price charts, resting bid liquidity, swing alerts of $0.10 or more, simulated strategies, resolved outcomes, and a Flagged for Review page.

**Live site:** https://wingbangboozle1-lang.github.io/Trade1/ (published from `main` by `.github/workflows/pages.yml`).

## Safety and scope

- Public, unauthenticated, read-only GET requests to the official Kalshi Trade API. No API keys, no account connection, no orders.
- Demo prices are not production Kalshi prices. A production read-only option is on the live dashboard.
- Simulated trades are stored only in the visitor's browser (localStorage). They are not exchange trades. Fees and spreads are not modelled.
- Alerts show what moved. Causes are not verified.
- Topic rules are keyword and category heuristics; see the Flagged page.

## What is where

| Path | Purpose |
|---|---|
| `site/index.html` | Landing page with executive summary and topic counts |
| `site/live.html` | Live dashboard: markets table, price chart with selectable window (60 s to 6 h), liquidity by price, "All swings" chat and "High-ROI screen" chat |
| `site/topics/*.html` | One subpage per topic (same live panel, filtered) |
| `site/resolved.html` | Markets with an official yes/no result |
| `site/strategies.html` | Simulated strategies A/B/C with breakdown by strategy, topic and alert type |
| `site/sources.html` | Official sources and what was verified on each |
| `site/flagged.html` | Flagged for Review: data flags, unverified or blocked items, repo findings, suggestions |
| `site/assets/lib.mjs` | Shared logic: topic rules, row normalisation, cursor pagination, swing detection, screen rule, orderbook parsing |
| `site/assets/app.mjs` | Browser app (live polling, chart, liquidity, chats, simulated engine) |
| `scripts/build_snapshot.mjs` | Builds `site/data/snapshot.json` from the official demo API (run in CI) |
| `scripts/check_site.mjs` | Pre-deploy check: local links resolve; every row has an official `source_url` |
| `scripts/test_lib.mjs` | Offline unit checks for the shared logic |

## Data flow

1. CI (`pages.yml`) runs `build_snapshot.mjs` against `https://external-api.demo.kalshi.co/trade-api/v2` (open, closed and settled events, cursor-paginated, with page caps that are recorded in the snapshot).
2. Each row keeps its official `source_url` (`/markets/{ticker}`) and the event's official settlement sources.
3. `check_site.mjs` must pass before the artifact is uploaded. Deployment runs only on `main`. A scheduled run every 30 minutes refreshes the snapshot.
4. In the browser, the live pages call the same endpoints every 15–60 seconds. If the browser cannot reach the API, the pages show the snapshot and say so.

## Run locally

```bash
node scripts/test_lib.mjs
node scripts/build_snapshot.mjs --base demo --out site/data/snapshot.json   # needs internet access to Kalshi
node scripts/check_site.mjs
python3 -m http.server 8000 --directory site   # then open http://localhost:8000/
```

## Official references

- [API environments](https://docs.kalshi.com/getting_started/api_environments)
- [Market lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle)
- [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades)
- [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses)
- [Pagination](https://docs.kalshi.com/getting_started/pagination)
- [Rate limits](https://docs.kalshi.com/getting_started/rate_limits)
- [Historical data](https://docs.kalshi.com/getting_started/historical_data)

Full list with what was verified on each: `site/sources.html`. Coordination log: [COORDINATION.md](COORDINATION.md).
