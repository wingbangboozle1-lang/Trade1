# Trade1 — Kalshi Demo Monitor

A static, read-only **live dashboard** over the official Kalshi **demo** Trade API
(`https://external-api.demo.kalshi.co/trade-api/v2`), covering **gas prices,
elections, culture, crypto, and golf**. Deployed at
**https://wingbangboozle1-lang.github.io/Trade1/** once merged to `main`.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Landing page + executive summary |
| `dashboard.html` | Live ranked markets, ≥ $0.10 alert chats (all events + ROI-screen picks), price chart (seconds/minutes/hours windows), order-book depth, computed liquidity, resolved-events strip |
| `topics/*.html` | Topic-focused dashboards (gas-prices, elections, culture, crypto, golf) |
| `trades.html` | Strategy Lab: automated **paper** strategies, portfolio performance, P&L by strategy/topic, equity curve, resolution log |
| `data.html` | Verified data tables — every row links the official URL it came from |
| `methods.html` | Full methodology: endpoints, field units, alert rule, ROI formula, strategies, fees, topic mapping |
| `flagged.html` | Flagged for Review — everything unverified, contradictory, or deliberately not implemented |
| `sources.html` | Official sources used for verification |

## Architecture

- **Site**: static HTML + vanilla JS (`assets/app.js` engine, `assets/model.js` strategies). No frameworks, no CDN dependencies.
- **Live data**: browser polls public demo endpoints directly (CORS verified: the API reflects any origin — `data/cors.json`). Batching via `GET /markets?tickers=…`, discovery via `GET /events?status=open&limit=200` and `GET /series?category=…&include_volume=true`, depth via `GET /markets/{ticker}/orderbook`, history via `GET /series/{s}/markets/{t}/candlesticks`.
- **Verification pipeline**: `.github/workflows/verify-and-collect.yml` runs `scripts/collect.py` on GitHub Actions (twice hourly after deploy + on relevant pushes), refreshes `data/` snapshots, and commits them with a per-request log (`data/log.md`). Topic rules live in `scripts/topics.json` and are mirrored in `assets/model.js`.
- **Paper trading**: strategies in `assets/model.js` (momentum, fade, favorite-harvest, 50¢ breakout) fill against official quotes with official taker fees (`roundup(0.07 × C × P × (1−P))`, from [kalshi.com/docs/kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf)) and settle at $1 per winning contract. Local `localStorage` only — no orders are ever sent, no credentials requested.

## Safety & scope

- Demo environment only (play money; demo prices may not match production).
- Public read-only market data. No authentication, no API keys, no orders, no account endpoints.
- Estimated dollar figures (contracts × last price) are labeled estimates; the API publishes no per-market dollar-notional field.
- WebSocket is not used: Kalshi's WS handshake requires signed headers browsers cannot attach (see `flagged.html`).

## Run locally

Any static file server from the repo root, e.g. `python3 -m http.server 8000`, then open
`http://localhost:8000/`. Live polling requires the browser to reach
`external-api.demo.kalshi.co`; if it can't, the site falls back to the verified
snapshot in `data/` and says so in the banner.

## Verification

- Every table row on `data.html` links the exact official endpoint URL that produced it.
- `data/log.md` records every fetch (URL, status, size) from the Actions runner.
- Values that could not be confirmed from an official source are left blank and listed on `flagged.html` — never inferred.
- Coordination notes for parallel sessions: [COORDINATION.md](COORDINATION.md).

## Other builds in this repo (from parallel sessions)

- `js/` + `docs/` (session ed8bbdf4, PR #12) and `categories/` + `assets/app.mjs`/`lib.mjs` + `live.html`/`resolved.html`/`strategies.html` + `scripts/build_snapshot.mjs`/`check_site.mjs`/`test_lib.mjs` (PR #18) and `pages/*`/`css/*` (PR #7) remain in-tree as historical builds. The published root pages (this README, `index.html`, `dashboard.html`, `topics/`, `data.html`, `flagged.html`, `sources.html`) are the bb8bd1ff integration build; see `flagged.html` for how their findings were carried forward.
