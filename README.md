# Trade1 — Kalshi Demo Dashboard

A live, interactive dashboard for the **Kalshi demo Trade API**
(`https://external-api.demo.kalshi.co/trade-api/v2`, fallback `https://demo-api.kalshi.co/trade-api/v2`).
It collects, organizes, and analyzes Kalshi prediction-market data focused on **gas prices,
elections, culture, crypto, and golf**, tracks events until they resolve (yes/no), runs automated
**simulated trades** to test strategies, and tracks portfolio performance.

> Three agent sessions contributed to this repo; all are preserved:
> - session `0db174ef` built the **primary root dashboard** (`pages/*` + `css/` + `js/` + docs + build tooling),
> - session `81cacf69` built the **monitor views** (`dashboard.html` + `categories/*` + `assets/*`),
> - session `sess-a1-9a0ad587` (Arena branch `arena/9a0ad587-trade1`) built the **`site/` dashboard** —
>   self-contained build with seconds/minutes/hours price charts, orderbook depth, ≥ $0.10 jump feed,
>   YES/NO resolution tracker, paper strategy engine with the official fee formula, and its own
>   verification docs (`site/*`, `docs/API_NOTES.md`, `docs/EXECUTIVE_SUMMARY.md`, `docs/SOURCES.md`, `docs/FLAGGED.md`).

## Site structure

**Session 0db174ef — primary dashboard (root, what GitHub Pages serves at `/`)**
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

**Session sess-a1-9a0ad587 — `site/` dashboard (served at `/site/`)**
| Page | Purpose |
|---|---|
| `site/index.html` | Landing: cross-topic highest-dollar ranking, executive summary, live ≥ $0.10 jump feed |
| `site/topics/{gas-prices,elections,culture,crypto,golf}.html` | Per-topic dashboards: events ranked by $ open interest, price chart with **seconds / minutes / hours** granularity (live polled points + official 1-min/1-h candlesticks), orderbook depth (contracts at each price), computed liquidity, trade tape, jump feed with source links, YES/NO resolution tracker |
| `site/strategies.html` | Paper strategy engine (Momentum / Mean-Reversion / Book-Imbalance) on live demo quotes with the **official fee formula**; equity curve, P&L by strategy & topic, categorized trade log, CSV/JSON export; optional read-only demo-account connector |
| `site/flagged.html` | Flagged for Review (F1–F12) |
| `site/suggestions.html` | Ranked suggestions to make the site more live/interactive |
| `site/verification.html` | Verification methodology + every official source used |
| `site/vendor/chart.umd.js` | Chart.js v4.6.1 (MIT) vendored from the npm registry |
| `docs/API_NOTES.md`, `docs/EXECUTIVE_SUMMARY.md`, `docs/SOURCES.md`, `docs/FLAGGED.md` | Verified API reference, executive summary, master source list, flagged items |

## Features (all three builds)
- **Live tracking** — highest dollar-value events per topic, polled from the Kalshi demo API (public,
  unauthenticated market-data endpoints).
- **Resolution tracking** — each event is tracked until it resolves with a clear **yes/no** outcome.
- **Interactive charts** — X axis = time (seconds / minutes / hours selectable), Y axis = contract
  price; plus liquidity depth showing contracts available at each price (orderbook).
- **Sharp-move alerts** — any price change **≥ $0.10** is flagged with timestamp and source links.
- **Strategy engines** — simulated strategies on live demo prices; trades categorized by type/topic
  with win-rate, P&L, and drawdown analysis.
- **Portfolio** — live demo balance/positions via signed requests (opt-in; credentials stay in your
  browser); paper engines run automatically without credentials.

## Deployment
GitHub Pages is configured to serve the repo from the **`main` branch at path `/`** (legacy mode), so
the static site is published automatically when site files are merged to `main` — the primary
dashboard at `/`, the monitor views at `/dashboard.html`, and the `site/` dashboard at **`/site/`**.
`.github/workflows/pages.yml` runs the build validation (`node tools/build.mjs`) on every push/PR so
a broken site cannot land on `main`.

## Verification
Every technical claim is traceable to an official Kalshi source (see `docs/sources.md`,
`docs/verification.md`, and `site/verification.html`). The build sandbox cannot reach Kalshi hosts,
so live values are fetched **live in the browser** from the official API; anything unconfirmed is
left blank and flagged on the **Flagged for Review** pages. No values are invented.

See [COORDINATION.md](./COORDINATION.md) for the task board and session logs.
