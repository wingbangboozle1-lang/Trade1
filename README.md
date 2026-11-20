# Kalshi Demo Monitor

Static GitHub Pages dashboard for observing open Kalshi demo markets, grouped by **gas prices, elections, culture, crypto, and golf**.

## Site structure

| Page | Purpose |
|---|---|
| `index.html` | Landing page: executive summary, topic navigation, how it works, official references |
| `dashboard.html` | Live dashboard: dual scrolling alert chats, contract-price chart, liquidity, paper lab, resolved outcomes |
| `categories/gas.html` | Gas-price markets (findings table) |
| `categories/elections.html` | Election markets (findings table) |
| `categories/culture.html` | Culture markets (findings table) |
| `categories/crypto.html` | Crypto markets (findings table) |
| `categories/golf.html` | Golf markets (findings table) |
| `flagged.html` | Flagged for review: unverified items and scope limits |
| `assets/css/style.css` | Shared styles |
| `assets/js/app.js` | Shared dashboard logic (public demo data only) |

## Dashboard features

- **Topic filtering**: gas prices, elections, culture, crypto, golf; events stay within their topic.
- **Live alerts**: two scrolling chats — *all events* and *model-liked high-ROI* — flag sampled YES-bid moves of ≥ $0.10 in either direction, each linked to the official market page (cause unverified).
- **Live chart**: X axis = timestamp, Y axis = contract price; choose seconds/minutes/hours window.
- **Liquidity**: published order-book bid quantities (contracts available at a price).
- **Paper lab**: record simulated trades categorized by strategy; portfolio table tracked in browser localStorage.
- **Resolved events**: outcome (yes/no) shown when reported by the endpoint.

## Safety and scope

- Public demo market-data requests only; no account authentication, API keys, or real order submission.
- Paper trades are hypothetical and saved in the browser's localStorage. No fills, fees, settlement, or profit/loss are simulated.
- Ranking is by API-reported contract volume, not dollar notional. Topic matching is a title/category keyword heuristic.
- REST polling and browser CORS/API availability can limit freshness.
- No credentials are requested or stored.

## Official references

- [Kalshi demo REST API](https://external-api.demo.kalshi.co/trade-api/v2)
- [Kalshi demo REST API (alternate)](https://demo-api.kalshi.co/trade-api/v2)
- [Market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- [Get markets API reference](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get market orderbook API reference](https://docs.kalshi.com/api-reference/market/get-market-order-book)

## Verification

This sandbox cannot reach the Kalshi demo API or docs hosts, so no live values were fetched in-session. Every market row links to its official market page; any value that cannot be confirmed from an official source is left blank and flagged unverified on the relevant page — see `flagged.html`. No values are inferred or filled in.

## Run locally

Open `index.html` (or any page) in a modern browser with network access. GitHub Pages deployment is configured in `.github/workflows/pages.yml` for pushes to `main` (repository Pages settings must use GitHub Actions).
