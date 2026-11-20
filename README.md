# Trade1 — Kalshi Demo Dashboard

A live, interactive dashboard for the **Kalshi demo Trade API**
(`https://external-api.demo.kalshi.co/trade-api/v2`). It collects, organizes, and analyzes
Kalshi prediction-market data focused on **gas prices, elections, culture, crypto, and golf**,
tracks events until they resolve (yes/no), runs automated **simulated trades** to test strategies,
and tracks portfolio performance.

## Features
- **Live tracking** — highest dollar-volume events per topic, polled from the Kalshi demo API.
- **Resolution tracking** — each event is tracked until it resolves with a clear **yes/no** outcome.
- **Interactive charts** — X axis = time (seconds / minutes / hours selectable), Y axis = contract
  price; plus a liquidity chart showing contracts available at each price (orderbook depth).
- **Sharp-move alerts** — any price change **≥ $0.10** is flagged with a timestamp and a link to the
  official market.
- **Strategy engine** — four simulated strategies (momentum, mean-reversion, value, liquidity-first);
  trades are categorized by type and topic with win-rate and P&L analysis.
- **Portfolio** — live demo balance/positions via signed requests; optional real demo order
  execution (opt-in, credentials stay in your browser).

## Structure
```
site/                 static, no-build dashboard
  index.html          landing
  pages/              gas, elections, culture, crypto, golf, portfolio, flagged
  js/kalshi.js        Kalshi demo client (public + RSA-PSS signed)
  js/strategy.js      simulated strategy engine + categorization + performance
  js/charts.js        lightweight canvas price + liquidity charts
  css/style.css
docs/                 executive summary, API reference, sources, verification log
tools/build.mjs       build + broken-link/syntax validation
.github/workflows/pages.yml   GitHub Pages deployment
```

## Build / validate
```bash
npm run build    # node tools/build.mjs — syntax-checks JS, checks every link
```

## Run locally
```bash
npx --yes serve site
```
Public market data needs no credentials. For the demo portfolio / real orders, provide a Kalshi demo
API key ID + private key on the home page (stored only in your browser session).

## Verification
Every technical claim is traceable to an official Kalshi source (see `docs/sources.md` and
`docs/verification.md`). The build sandbox cannot reach Kalshi hosts, so live values are fetched
**live in the browser** from the official API; anything unconfirmed is left blank and flagged on the
**Flagged for Review** page. No values are invented.

See [COORDINATION.md](./COORDINATION.md) for the task board and session log.
