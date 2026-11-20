# Trade1 — Kalshi Demo Dashboard

A live, interactive dashboard for the **Kalshi demo Trade API**
(`https://external-api.demo.kalshi.co/trade-api/v2`, fallback `https://demo-api.kalshi.co/trade-api/v2`).
It collects, organizes, and analyzes Kalshi prediction-market data focused on **gas prices,
elections, culture, crypto, and golf**, tracks events until they resolve (yes/no), runs automated
**simulated trades** to test strategies, and tracks portfolio performance.

> Two agent sessions contributed to this repo; both are preserved below (session `81cacf69` built
> the `dashboard.html` + `categories/*` + `assets/*` monitor; session `0db174ef` built the
> `pages/*` + `css/` + `js/` dashboard with the strategy engine, portfolio, docs, and build tooling).

## Site structure

**Session 0db174ef — primary dashboard**
| Page | Purpose |
|---|---|
| `index.html` | Landing page: status, topic navigation, executive summary, credentials, official references |
| `pages/gas.html` · `elections.html` · `culture.html` · `crypto.html` · `golf.html` | Per-topic live event tables (source-linked) + interactive price/liquidity charts |
| `pages/portfolio.html` | Simulated strategy engine, categorized trade log, performance analysis, opt-in real demo order |
| `pages/flagged.html` | Flagged for Review: irregularities + unverified items with source links |
| `js/kalshi.js` | Kalshi demo client (public fetch + WebCrypto RSA-PSS signed requests) |
| `js/strategy.js` | Simulated strategy engine + trade categorization + performance |
| `js/charts.js` | Lightweight canvas price chart (time/price) + liquidity depth chart |
| `js/store.js` | Live polling, price series, sharp-move detection, resolution tracking |
| `docs/` | Executive summary, API reference, sources, line-by-line verification |
| `tools/build.mjs` | Build + JS-syntax + broken-link/asset validation |

**Session 81cacf69 — monitor views (preserved)**
| Page | Purpose |
|---|---|
| `dashboard.html` | Alternate live monitor: alert chats, price chart, liquidity, paper lab |
| `categories/{gas,elections,culture,crypto,golf}.html` | Per-topic findings tables |
| `flagged.html` | Alternate flagged-for-review page |
| `assets/css/style.css`, `assets/js/app.js` | Shared styles/logic for the monitor views |

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
  execution (opt-in; credentials stay in your browser).

## Build / validate
```bash
npm run build    # node tools/build.mjs — syntax-checks JS, checks every link
```

## Run locally
```bash
npx --yes serve .
```
Public market data needs no credentials. For the demo portfolio / real orders, provide a Kalshi demo
API key ID + private key on the home page (stored only in your browser session).

## Deployment
GitHub Pages is configured to serve the repo from the **`main` branch at path `/`**, so the static
site is published automatically when the site files are merged to `main`. `.github/workflows/pages.yml`
runs the build validation on every push/PR so a broken site cannot land on `main`.

## Verification
Every technical claim is traceable to an official Kalshi source (see `docs/sources.md` and
`docs/verification.md`). The build sandbox cannot reach Kalshi hosts, so live values are fetched
**live in the browser** from the official API; anything unconfirmed is left blank and flagged on the
**Flagged for Review** pages. No values are invented.

See [COORDINATION.md](./COORDINATION.md) for the task board and session logs.
