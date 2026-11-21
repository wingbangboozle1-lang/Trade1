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
  `scripts/portfolio_engine.py` twice an hour — offline self-tests first, then one live cycle. It compares each priced
  cycle with the previous one, books fills at the official quotes with the official taker fee (`ceil_6dp` model fee plus
  the $0.01 balance alignment per [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding)), settles on the
  exchange's YES/NO result, and commits `data/portfolio.json` + `data/portfolio_state.json` to `main` with `[skip ci]`.
  Every ledger row (trade, exit, resolution, alert) carries its **own** official market record,
  `GET /markets/{ticker}`, as its row source; the batched quote endpoint that produced the cycle
  is published separately in `sources.quote_endpoints` and in `data/log.md`.
  Simulation only: nothing authenticates and no order is ever sent. Its rules and its differences from the browser lab
  are documented in [methods.html](methods.html) §8–§9. (The account-capable layer is separate: `demo-account.yml` +
  `scripts/demo_account/**`, which stays inert until the owner adds the demo-key secrets.)
- **Paper trading**: four strategies in `assets/model.js` fill against official quotes with the
  official taker fee `roundup(M × 0.07 × C × P × (1−P))` from the
  [fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf), where `M` is the per-series
  taker multiplier from the schedule's Non-Standard Fees table (default 1; e.g. `KXBTCY`/`KXETHY`
  are published as *no fees*, so `M = 0`). The transcribed table is published for review at
  [`data/fee_schedule_series.json`](data/fee_schedule_series.json); rows that could not be read
  unambiguously are listed there as not transcribed and fall back to `M = 1`. Paper trades settle
  at $1 per winning contract. `localStorage` only — no orders, no credentials.

## Checks

```bash
npm install --no-audit --no-fund jsdom   # test dependency only
npm run build    # JS syntax + internal links + nav targets
npm run test     # 23 jsdom/page-engine assertions plus offline library tests
node scripts/check_site.mjs   # every snapshot row carries an official source URL

# the CI ledger's own checks (all offline, no credentials, no network needed)
python3 scripts/portfolio_engine.py selftest   # 76 checks: fee math, alert boundary, sizing, settlement, determinism, per-row sources
node tests/portfolio.test.mjs                  # ledger invariants + portfolio.html boot in jsdom (skips the DOM part without it)
node scripts/check_links.mjs                   # every published page: nav parity, local links, external links are https+official

# the collector's classification regression gate (offline, no network)
python3 scripts/collect_test.py               # 23 checks: topic exclusions, keyword word boundaries, pagination facts
```

CI (`.github/workflows/pages.yml`) runs all of them on every push and pull request.

## Verification records

Every published number traces back to an official Kalshi endpoint. The verification records for
this repository, each with the official links it was checked against:

| Record | What it covers |
|---|---|
| [`reports/REPO_REVIEW_725b09a7.md`](reports/REPO_REVIEW_725b09a7.md) | Line-by-line review of the site, engine, collector and ledger; 16 API claims re-verified against the official docs; the fee-schedule transcription compared row by row with the official PDF; three defects found and fixed |
| [`reports/INTEGRATION_AUDIT_6916270f.md`](reports/INTEGRATION_AUDIT_6916270f.md) | The previous final integration: defects D1–D11, the fee-table transcription, the CI gates |
| [`reports/VERIFICATION_9ff00ee3.md`](reports/VERIFICATION_9ff00ee3.md) | Re-verification of the per-series fee multiplier and the `fee_multiplier` schema |
| [`reports/VERIFICATION_a53ab816.md`](reports/VERIFICATION_a53ab816.md) | Audit of the deployed site; corrections to stale review and safety claims |
| [`reports/VERIFICATION_9d4380a2.md`](reports/VERIFICATION_9d4380a2.md) | Independent re-verification; the Resolved-page repair |
| [`reports/COVERAGE_9d4380a2.md`](reports/COVERAGE_9d4380a2.md) | Brief requirement → delivered / partial / blocked matrix |
| [`data/log.md`](data/log.md) | One line per API request the collector made (time, method, URL, status, bytes) |
| [`data/fee_schedule_series.json`](data/fee_schedule_series.json) | The transcribed per-series fee table, with the rows that could not be read listed as not transcribed |
| [`flagged.html`](flagged.html) | Everything that could not be verified, is a deliberate limitation, or is a known defect — with source links |
| [`sources.html`](sources.html) | The official documentation pages used |

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
              collect_test.py (offline classification/pagination regression gate),
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
