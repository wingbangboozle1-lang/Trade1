# Repo review — line-by-line verification notes (session `bb8bd1ff`, 2026-11-20)

Scope: every file in this repository. Sources are official (docs.kalshi.com,
kalshi.com, live demo endpoints) and linked inline. Irregularities are flagged
in place and summarized at the bottom; they are also published on the site's
[Flagged for Review page](flagged.html).

## Files reviewed

### `index.html` (landing + executive summary)
- Rewritten this session from the previous single-page prototype (session `ee533bdf`; its published flags are carried into `flagged.html` §Carried-from).
- Claims audited against sources: demo endpoints match [API Environments](https://docs.kalshi.com/getting_started/api_environments); CORS claim matches `data/cors.json` (runner probes); fee claim matches [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (taker `roundup(0.07·C·P·(1−P))`, effective July 7, 2026).
- Status strip reads `data/meta.json` only; no live values are asserted at load.

### `dashboard.html`, `topics/*.html`, `trades.html`
- Static shells; all dynamic content rendered by `assets/app.js` from official endpoints or verified snapshots. Disclaimers present on every page.
- Topic pages verified to load shared assets with correct relative paths (`../assets/*`, `data-root="../"`).

### `assets/app.js` (engine)
- Polling batch uses `GET /markets?tickers=…` — verified live: single response, empty cursor, works for settled markets too (settlement detection comes free from the same response).
- Discovery uses `GET /events?status=open&limit=200` (verified: `limit=1000` → 400) and `GET /series?category=…&include_volume=true` (verified live; `status` is **not** sent on `/series` because it is not a documented parameter there).
- Alert rule: sampled price delta ≥ $0.10 either direction, raw compare with 1e-9 tolerance (official prices are 4-dp fixed-point strings per [Fixed-Point Representation](https://docs.kalshi.com/getting_started/fixed_point_migration)).
- Order book: `orderbook_fp.{yes_dollars,no_dollars}`, ascending, best bid last, asks derived as `1 − bid` per [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses). Computed bid-side liquidity is labeled computed, not exchange-published.
- Chart windows ≥ 1 h use `GET /series/{s}/markets/{t}/candlesticks` (period 1 or 60 min) per [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks); sub-hour windows use session samples only (REST cache lag documented by Kalshi).
- 429 handling: exponential backoff, per [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits).
- No WebSocket (handshake requires signed headers browsers cannot attach — [WS Quick Start](https://docs.kalshi.com/getting_started/quick_start_websockets)). Flagged, not a bug.

### `assets/model.js` (ROI screen + paper broker)
- ROI score formula and weights documented in `methods.html` §3; heuristic, flagged as such.
- Strategies (momentum / fade / harvest / breakout): parameters fixed and documented; entries blocked outside 5¢–95¢ asks; exits at official bid; settlement pays $1 per winning contract per [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement).
- Fees: taker `roundup(0.07 × C × P × (1−P))` on entry and exit — matches the official schedule's General Trading Fees table (spot-checked: 100 contracts @ $0.50 → $1.75 ✓). Maker fees deliberately not modeled (paper fills assume immediate match) — flagged.
- Floating-point: all P&L deltas rounded to 4 dp before threshold comparisons (bug found and fixed via headless harness: `0.57 − 0.42 = 0.1499…` missed a +15¢ take-profit).
- Unit harness (run in CI-less session): classification (elections/gas/crypto/golf/culture, natural-gas exclusion, AAA series prefix), momentum entry at ask, take-profit exactness, settlement payouts — all PASS.

### `scripts/collect.py` + `scripts/topics.json` + `.github/workflows/verify-and-collect.yml`
- Stdlib-only Python; every value written to `data/` is verbatim from a logged URL (`data/log.md`). No values inferred; absent fields omitted.
- Pagination, per-event/per-series fetches, and settled-window queries match documented behaviors (single-response `event_ticker`/`tickers` reads, `min_settled_ts` compatibility with `status=settled`).
- `[skip ci]` on data commits prevents workflow loops; scheduled runs apply on `main` after merge.
- Topic mapping mirrored manually between `scripts/topics.json` and `assets/model.js → TOPICS` — a sync hazard, flagged.

### `data/` (Actions-verified snapshots)
- `cors.json`: probed from a GitHub-hosted runner 2026-11-20 — both demo hosts reflect any request Origin in `access-control-allow-origin` (Pages origin + `https://example.com` both echoed; preflight 204). This is what makes the client-side live mode possible.
- `meta.json`: run findings incl. observed market statuses (`active` ×6000 in sweep), candlestick probe result, observed market field names.
- `topics/*.json`: per-topic ranked events with `_match_reason` (category / series-prefix / series-discovery) and per-row source URLs.
- `resolved.json`: recently settled in-scope markets with `result` yes/no, `settlement_ts`, `settlement_value_dollars`.
- `log.md`: per-request audit trail.
- Snapshots are point-in-time; the live site always prefers fresh API responses when reachable.

### `data.html`, `methods.html`, `flagged.html`, `sources.html`
- `data.html` renders snapshots with a source link per row; blank cells for values the API did not return (never inferred).
- `methods.html` documents every rule with official links; `flagged.html` lists 16 items; `sources.html` lists every official source used.

### `.github/workflows/pages.yml` (from session `ee533bdf`, retained)
- Deploys Pages on `main` via actions. Note: repository Pages is currently configured `build_type: legacy` with source `main` path `/`; the Actions deployment and legacy setting coexist awkwardly — flagged for the integration step to reconcile (the Actions deploy has succeeded historically in this repo).

## Irregularities flagged (summary — details + links on flagged.html)

1. Demo market `status` values are `active`/`finalized`, docs enumerate `unopened/open/closed/settled`.
2. `GET /events?limit=1000` → 400; page size 200 used (undocumented ceiling, found empirically).
3. Candlestick path on demo is `/series/{s}/markets/{t}/candlesticks`; probe result per run recorded in `meta.json`.
4. Event `settlement_sources` sometimes contain template gaps (verbatim demo data quality issue).
5. No exchange-published per-market dollar-notional field in demo responses → all `$` trade figures are labeled estimates.
6. Maker fees not modeled (taker fee verified from official schedule).
7. News causality never claimed; alerts link official market page + settlement sources + a labeled news-search lead.
8. ROI score weights are documented engineering choices, not verified alpha.
9. Topic matching is heuristic; `scripts/topics.json` ↔ `assets/model.js` must be kept in sync manually.
10. Paper fills assume no slippage and infinite depth at best quotes.
11. Unauthenticated rate limits undocumented; client backs off on 429 and polls modestly.
12. Demo-account portfolio requires credentials; deliberately not requested/implemented (paper portfolio instead).
13. No WebSocket in browser (platform constraint).
14. No order placement anywhere (paper only).
15. Alerts are sampled between polls (~12 s); faster swings invisible over REST.
16. Sub-hour chart windows use session samples that reset on reload (localStorage prudence).

## How to re-verify

- Snapshot evidence: `data/log.md` (every request logged), `data/cors.json`, `data/meta.json`.
- Live probes: open any linked endpoint URL from `data.html` or `sources.html` in a browser.
- Site build: all pages return HTTP 200 from a static server; JS passes `node --check`; model harness passes (see session log in COORDINATION.md).

---

## Final integration — line-by-line verification (session `dacc8b5c`, 2026-11-20 UTC)

Scope: every claim the published root site makes about the Kalshi demo API, re-checked this
session against official documentation and live demo-endpoint responses (page-fetch from the
session; the build sandbox itself has no route to `*.kalshi.co`). Each row: claim → official
source → result. Anything not confirmed is left on [flagged.html](flagged.html), never inferred.

### Sources read this session (official)

| Source | URL |
|---|---|
| Demo environment (endpoint table) | https://docs.kalshi.com/getting_started/demo_env |
| Fee schedule PDF (effective July 7, 2026) | https://kalshi.com/docs/kalshi-fee-schedule.pdf |
| Orderbook responses (format, ordering, reciprocal asks) | https://docs.kalshi.com/getting_started/orderbook_responses |
| Market settlement ($1/contract, zero settlement fee) | https://docs.kalshi.com/getting_started/market_settlement |
| Quick start: market data (public, no auth; UI URL pattern) | https://docs.kalshi.com/getting_started/quick_start_market_data |
| Get Market (per-row resolved links) | https://docs.kalshi.com/api-reference/market/get-market |

### Live demo-endpoint probes (this session)

| Probe | Result | Confirms |
|---|---|---|
| `GET /exchange/status` | 200, `trading_active: true` | demo exchange reachable, demo shards active |
| `GET /events?status=open&limit=200` | 200 (paged, 19 chunks) | `CFG.eventsLimit = 200` in `assets/app.js` |
| `GET /events?status=open&limit=1000` | rejected (fetch error) | flagged rule: 1000 → 400, use 200 |
| `GET /markets?status=open&limit=3&mve_filter=exclude` | 200; fields `status:"active"`, `last_price_dollars`, `previous_price_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `yes_bid/ask_dollars`, `result:""` | field units in Methods; demo `status:"active"` vs documented `open/settled` (flagged) |
| `GET /series/KXAAAGASM/markets/KXAAAGASM-26NOV30-3.90/candlesticks?start_ts=…&end_ts=…&period_interval=1` | 200, `candlesticks: []` | candlestick path used by `fetchCandles()`; empty-candles flag for KXAAAGASM stands |
| `GET /markets/KXAAAGASM-26NOV30-3.90/orderbook` | 200, `orderbook_fp: {yes_dollars: [], no_dollars: []}` | documented empty-book behavior; orderbook path correct |
| `GET /markets/KXNATGAS15M-26NOV201245-45` | 200; `result:"no"`, `status:"finalized"`, `settlement_ts:"2026-11-20T17:45:24.334041Z"` | the resolved-archive row in `data/resolved.json` matches **verbatim**; demo uses `finalized` (flagged vs docs `settled`); per-row source link added to `data.html` |
| `GET /events?status=open&limit=200` (body sample) | `settlement_sources` containing template entries (`url:"https://kalshi.com/"` for generic names) | placeholder-URL flag confirmed live |

### Claim checks (site → official source → result)

1. **Demo endpoint pair** (recommended `external-api.demo.kalshi.co`, also `demo-api.kalshi.co`, WS pair) — [demo_env](https://docs.kalshi.com/getting_started/demo_env) — **match** (site header, README, `CFG.bases`).
2. **Taker fee `roundup(M × 0.07 × C × P × (1−P))`, M default 1; maker 0.0175, M default 0; no settlement fee** — [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (table row: 100 contracts @ $0.50 → $1.75) — **match** with `assets/model.js` fee math and `tests/engine.test.js` (36/36, includes that table row).
3. **Orderbook: `orderbook_fp.{yes_dollars,no_dollars}` = `[price_dollars, count_fp]`, ascending, best bid last, bids only, YES ask = 1 − NO bid** — [orderbook_responses](https://docs.kalshi.com/getting_started/orderbook_responses) — **match** with `bookViews()` in `assets/app.js`.
4. **Winning side receives $1 per contract; settlement fee zero for yes/no** — [market_settlement](https://docs.kalshi.com/getting_started/market_settlement) — **match** with paper settlement in `assets/model.js`.
5. **Public unauthenticated market data; Kalshi UI pattern `kalshi.com/markets/<ticker>`** — [quick start market data](https://docs.kalshi.com/getting_started/quick_start_market_data) — **match** with `kalshiEventUrl()` and the Data-page links.
6. **Alert rule ≥ $0.10 either direction, integer tolerance 1e-9 for 4-dp fixed-point prices** — official prices are 4-dp strings (observed live: `"0.4500"`) — **match** with `checkAlert()`; exact-$0.10 float trap documented by session f6094c46 and covered by `tests/engine.test.js`.
7. **Estimated dollar figures labeled estimates** — no official per-market dollar-notional field in live responses (observed field set above) — **match** (labeling present on dashboard, data page, methods).
8. **No WebSocket in the browser** — WS handshake requires signed auth headers (documented in [WS quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), cited in `assets/app.js` header comment) — **flagged, not a bug**.
9. **CORS: demo API reflects any browser origin** — `data/cors.json` (GitHub-runner probes with verbatim headers, 2026-11-20) — **recorded evidence**; not re-probeable from this sandbox.

### Validation runs (this session, after the gap-fill)

- `node tools/build.mjs` → **BUILD OK — 33 HTML, 23 JS files validated, 0 broken links** (scope extended to the published root site and `assets/`).
- `node scripts/check_site.mjs` → **16 HTML, 249 links, 1,250 rows, 801 resolved, 0 failures** (scope extended to dashboard/trades/data/methods/suggestions; new checks: topic-snapshot `source_urls` on the official base, `event_ticker` per row, `resolved.json` result verbatim yes/no).
- `node scripts/test_lib.mjs` → passed · `node tests/engine.test.js` → **36/36** · `node tests/smoke.test.js` → OK · `node --check assets/app.js assets/model.js` → OK.
- CI (`.github/workflows/pages.yml`) now runs engine tests + `tools/build.mjs` + `check_site.mjs` on every push/PR.

### Changes made in this session (gap-fill, no other session’s merged work edited)

1. **`suggestions.html`** (new) — the brief’s “make suggestions” deliverable: shipped vs backlog, effort labels, official-source constraints (WS auth, push infra, credentials), linked from all 13 navs.
2. **Chart sharp-move markers + jump list** (`assets/app.js`, `assets/site.css`) — ▲/▼ markers at ≥ $0.10 moves on the selected market’s chart, plus a per-market jump list with the official market link, settlement-source links, and a labeled news-search lead (link = lead, never claimed cause).
3. **Per-row source links** (`data.html`) — every resolved row now links the exact official `GET /markets/{ticker}` response for that row (endpoint verified live this session), in addition to the settled-batch URL.
4. **Verification coverage** (`scripts/check_site.mjs`, `tools/build.mjs`, `.github/workflows/pages.yml`) — the published pages and `assets/` engine are now inside the automated checks (they previously were not).
5. **`EXECUTIVE_SUMMARY.md`** — corrected the deployment line (root site, not `site/`) and the strategy/page rows to match the deployed build.

### Irregularities (unchanged; all published on flagged.html with sources)

Demo `status:"active"`/`"finalized"` vs documented `open/settled`; placeholder `settlement_sources` URLs; KXAAAGASM empty candles (cause unknown); no official dollar-notional (rankings are estimates); unauthenticated rate limits unpublished; REST cache lag (alerts lag seconds); WebSocket requires signed headers (no browser feed); demo-account portfolio/execution needs owner-provided demo API keys (never requested in chat); maker fees not modeled; ROI screen is a documented heuristic, not verified alpha.
