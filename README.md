# Kalshi Demo Monitor

A static GitHub Pages dashboard prototype for observing open Kalshi demo markets, grouped by gas prices, elections, culture, crypto, and golf. Includes local-only paper-trade journaling and a sampled YES-bid chart.

## Safety and scope

- Public demo market-data requests only; no account authentication, API keys, or real order submission.
- Paper trades are hypothetical and saved in the browser's local storage. No fills, fees, settlement, or profit/loss are simulated.
- Ranking is by the API-reported contract volume, not dollar notional. Topic matching is a title/category keyword heuristic.
- REST polling and browser CORS/API availability can limit freshness. The chart records observations only while open and cannot attribute moves to news.
- See the dashboard's Sources & flagged for review section and [COORDINATION.md](COORDINATION.md) for verification notes.

## Run locally

Open `index.html` in a modern browser with network access. GitHub Pages deployment is configured in `.github/workflows/pages.yml` for pushes to `main` (repository Pages settings must use GitHub Actions).

## Official references

- [Kalshi demo REST API](https://external-api.demo.kalshi.co/trade-api/v2)
- [Market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- [Get markets API reference](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get market orderbook API reference](https://docs.kalshi.com/api-reference/market/get-market-order-book)
