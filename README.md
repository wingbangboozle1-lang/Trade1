# Trade1 — Kalshi Demo Monitor

A static, read-only **live dashboard** over the official Kalshi **demo** Trade API
(`https://external-api.demo.kalshi.co/trade-api/v2`) for five topics only —
**gas prices, elections, culture, crypto, golf** — with ≥ $0.10 swing alerting in two
scrolling chats, interactive price/liquidity charts, automated paper strategies, resolved-event
tracking, and every table row linked to the official API record it came from.

**Live site:** https://wingbangboozle1-lang.github.io/Trade1/

## Pages

| Page | What it does |
|---|---|
| [`index.html`](index.html) | Landing page: what the tool is, how the live pipeline works |
| [`executive-summary.html`](executive-summary.html) | Requirement → delivery table, what is deliberately not built, verification method, suggestions |
| [`dashboard.html`](dashboard.html) | Live ranked markets, the two ≥ 10¢ alert chats, price chart (60 s → 24 h), order-book depth, resolved strip |
| [`topics/*.html`](topics/golf.html) | One page per topic (gas-prices, elections, culture, crypto, golf), scoped to that topic |
| [`trades.html`](trades.html) | Strategy Lab: paper strategies, portfolio performance, P&L by strategy and topic, equity curve |
| [`portfolio.html`](portfolio.html) | **Always-on CI ledger**: the same strategies run by `scripts/portfolio_engine.py` on GitHub Actions and committed to `data/portfolio.json` — equity curve, trade ledger categorised by strategy and topic, ≥ $0.10 alert feed carrying the sample gap each move was measured over, resolutions, per-row source links |
| [`data.html`](data.html) | Verified snapshot tables — every row links the official URL that produced it |
| [`methods.html`](methods.html) | Every rule the dashboard runs, with its source |
| [`flagged.html`](flagged.html) | Flagged for Review: unverified values, contradictions, deliberate limitations |
| [`sources.html`](sources.html) | The official documentation pages used for verification |
| [`demo-account/`](demo-account/index.html) | Opt-in demo-account console (merged from PR #39): real demo balance/positions and guarded demo orders once the owner's key exists, plus its own paper lab. Inert without credentials — see `scripts/demo_account/README.md` |
| [`suggestions.html`](suggestions.html) | Ideas for making the site more live and interactive — what is already live, the prioritised backlog (each item naming the official endpoint it would use), and what shipped since |
| [`resolved.html`](resolved.html) | Resolved events tracker: every settled in-scope market with its official YES/NO `result`, `settlement_ts`, `settlement_value_dollars` and per-row API links |

## Architecture

- **Site**: static HTML + vanilla JS. No frameworks, no CDN dependencies, no build step for the
  browser — the engine is `assets/app.js` + `assets/model.js`.
- **Live data**: the browser polls the public demo endpoints directly (CORS is verified by the
  data collector — see `data/cors.json`). Discovery via `GET /events?status=open&limit=200`
  (200 is the documented maximum), batched prices via `GET /markets?tickers=…`, depth via
  `GET /markets/{ticker}/orderbook`, seconds-windows via `GET /markets/trades`, longer windows via
  `GET /series/{s}/markets/{t}/candlesticks` (`period_interval` 1 or 60 only).
- **Snapshots**: `.github/workflows/pages.yml` runs `scripts/collect.py` on a schedule from GitHub
  Actions (the runner can reach Kalshi; the build sandbox cannot), refreshes `data/` and commits it
  with a per-request log in `data/log.md`.
- **Always-on ledger** (this is the part that survives a reload): `.github/workflows/portfolio.yml` runs
  `scripts/portfolio_engine.py` twice an hour — offline self-tests first, then one live cycle. It compares each priced
  cycle with the previous one, books fills at the official quotes with the official taker fee (`ceil_6dp` model fee plus
  the $0.01 balance alignment per [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding)), settles on the
  exchange's YES/NO result, and commits `data/portfolio.json` + `data/portfolio_state.json` to `main` with `[skip ci]`.
  Simulation only: nothing authenticates and no order is ever sent. Its rules and its differences from the browser lab
  are documented in [methods.html](methods.html) §8–§9. (The account-capable layer is separate: `demo-account.yml` +
  `scripts/demo_account/**`, which stays inert until the owner adds the demo-key secrets.)
- **Paper trading**: four strategies in `assets/model.js` fill against official quotes with the
  official taker fee `roundup(0.07 × C × P × (1−P))` from the
  [fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf) and settle at $1 per winning
  contract. `localStorage` only — no orders, no credentials.

## Checks

```bash
npm install --no-audit --no-fund jsdom   # test dependency only
npm run build    # JS syntax + internal links + nav targets
npm run test     # real engine in jsdom over every page, alert math, sources
node scripts/check_site.mjs   # every snapshot row carries an official source URL + every <script src> resolves
node tests/root_engine.test.js # engine math offline: official fee table, $0.10 threshold, quote reconciliation

# the CI ledger's own checks (all offline, no credentials, no network needed)
python3 scripts/portfolio_engine.py selftest   # 50 checks: fee math, alert boundary, sizing, settlement, determinism
node tests/portfolio.test.mjs                  # ledger invariants + portfolio.html boot in jsdom (skips the DOM part without it)
node scripts/check_links.mjs                   # every published page: nav parity, local links, external links are https+official
node tests/root_engine.test.js                 # fee table, alert threshold, order-book quote reconciliation (52 assertions)
node tests/demo-account.test.mjs               # demo-account lab: fee table, signing, paper P&L (93 assertions)
```

The two link checkers verify `<script src="…">` targets as well as `href`/`src` attributes, and
`tests/engine.test.mjs` evaluates every inline script and fails on a missing script target — a published
page cannot silently point at a deleted module again (that is how `resolved.html` shipped broken once).

CI (`.github/workflows/pages.yml`) runs all three on every push and pull request.

## Safety & scope

- Demo environment only (play money); demo prices may not match production.
- Public read-only market data. No authentication, no API keys, no orders, no account endpoints.
- Dollar figures are computed estimates (contracts × price) and labelled as such; the API publishes
  no per-market dollar-notional field.
- WebSocket is not used: the official docs require signed `KALSHI-ACCESS-*` headers **during the
  handshake**, which a browser cannot attach. Polling is used and the resulting lag is stated.

## Repository layout

```
assets/       app.js (the one engine), model.js (strategies/broker), site.css, lib.mjs (snapshot helpers)
data/         verified snapshots: topics/*, resolved.json, meta.json, cors.json, log.md,
              portfolio.json + portfolio_state.json (written by the ledger workflow, not by hand)
scripts/      collect.py (collector/verifier), build_snapshot.mjs, topics.json (topic rules),
              check_site.mjs, check_links.mjs (nav parity + external links), test_lib.mjs,
              portfolio_engine.py (the CI ledger: self-tests, seed, one live cycle)
tests/        engine.test.mjs (jsdom tests of the published pages), root_engine.test.js (fee/alert/unit
              math), portfolio.test.mjs (ledger invariants + portfolio.html boot, DOM part self-skips)
tools/        build.mjs (syntax + link + nav checks)
.github/      workflows/pages.yml (site checks, snapshot collection, Pages), portfolio.yml (the ledger)
topics/       one topic page per tracked topic
docs/         per-session API notes and verification records
COORDINATION.md  shared task board for parallel sessions
```

Earlier parallel sessions' separate site trees (`site/`, `monitor/`, `a2ec5543/`, `trade1/`,
`pages/`, `categories/`, `js/`, `css/`) were **removed** in the consolidation pass recorded in
`COORDINATION.md`, together with their duplicate engine (`assets/app.mjs`, `assets/js/app.js`,
`assets/css/style.css`), their stale test files and the one-off probe/builder scripts. Their findings
live on in `flagged.html`, `reports/` and `docs/`. One site, one engine, one check suite is published.

## Run locally

```bash
python3 -m http.server 8000    # then open http://localhost:8000/
```

Live polling needs the browser to reach `external-api.demo.kalshi.co`; if it cannot, the pages fall
back to the committed snapshots in `data/` and say so in the status pill.
