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
| [`resolved.html`](resolved.html) | Resolved markets with their official YES/NO result and settlement timestamp |

## Architecture

- **Site**: static HTML + vanilla JS. No frameworks, no CDN dependencies, no build step for the
  browser — the engine is `assets/app.js` + `assets/model.js`.
- **Live data**: the browser polls the public demo endpoints directly (CORS is verified by the
  data collector — see `data/cors.json`). Discovery via `GET /events?status=open&limit=200`
  (200 is the documented maximum), batched prices via `GET /markets?tickers=…`, depth via
  `GET /markets/{ticker}/orderbook`, seconds-windows via `GET /markets/trades`, longer windows via
  `GET /series/{s}/markets/{t}/candlesticks` (`period_interval` accepts 1, 60 or 1440 minutes; the chart uses 1 and 60).
- **Snapshots**: `.github/workflows/pages.yml` runs `scripts/collect.py` on a schedule from GitHub
  Actions (the runner can reach Kalshi; the build sandbox cannot), refreshes `data/` and commits it
  with a per-request log in `data/log.md`.
- **Always-on ledger** (this is the part that survives a reload): `.github/workflows/portfolio.yml` runs
  `scripts/portfolio_engine.py` on a 30-minute cron (`13,43 * * * *`; GitHub's scheduler starts roughly one run an hour in practice — see flagged item 155329c7-6) — offline self-tests first, then one live cycle. It compares each priced
  cycle with the previous one, books fills at the official quotes with the official taker fee (`ceil_6dp` model fee plus
  the $0.01 balance alignment per [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding)), settles on the
  exchange's YES/NO result, and commits `data/portfolio.json` + `data/portfolio_state.json` to `main` with `[skip ci]`.
  Simulation only: nothing authenticates and no order is ever sent. Its rules and its differences from the browser lab
  are documented in [methods.html](methods.html) §8–§9. (The account-capable layer is separate: `demo-account.yml` +
  `scripts/demo_account/**`, which stays inert until the owner adds the demo-key secrets.)
- **Paper trading**: four strategies in `assets/model.js` fill against official quotes with the
  official taker fee `roundup(M × 0.07 × C × P × (1−P))` from the
  [fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf), where `M` is the per-series
  multiplier. It resolves in official-source order: (1) the demo API's published
  `fee_multiplier` when a Series record for that series has been seen (environment-matched —
  the site papers demo fills), (2) else the schedule's Non-Standard Fees table, transcribed for
  review at [`data/fee_schedule_series.json`](data/fee_schedule_series.json) (rows that could not
  be read unambiguously are listed there as not transcribed), (3) else the schedule's documented
  default `M = 1`. A record without a numeric `fee_multiplier` is never inferred; the two
  official sources disagree for some series, which is published on
  [`flagged.html`](flagged.html) (items 6b and 691-1). Paper trades settle at $1 per winning
  contract. `localStorage` only — no orders, no credentials.

## Checks

```bash
npm install --no-audit --no-fund jsdom   # test dependency only
npm run build    # JS syntax + internal links + nav targets
npm run test     # 23 jsdom/page-engine assertions plus offline library tests
node scripts/check_site.mjs   # every snapshot row carries an official source URL

# the CI ledger's own checks (all offline, no credentials, no network needed)
python3 scripts/portfolio_engine.py selftest   # 50 checks: fee math, alert boundary, sizing, settlement, determinism
node tests/portfolio.test.mjs                  # ledger invariants + portfolio.html boot in jsdom (skips the DOM part without it)
node scripts/check_links.mjs                   # every published page: nav parity, local links, external links are https+official
```

CI (`.github/workflows/pages.yml`) runs all three on every push and pull request.

## Safety & scope

- Demo environment only (play money); demo prices may not match production.
- The dashboard and paper engines use public read-only market data without authentication; paper trades never submit orders or call account endpoints. The separate opt-in [`demo-account/`](demo-account/index.html) console can read a real demo balance/positions and submit guarded demo orders only after the account owner supplies a demo API key ID and private key. No credentials are bundled, no live account request is sent by default, and the optional connection is not required for the automatic paper dashboard.
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
