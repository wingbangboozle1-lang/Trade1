# Repo review — line-by-line verification notes

Sessions: `bb8bd1ff` (root-site integration build), `3fa0d383` (final integration, 2026-11-20).
Scope: the files that make up the **deployed** site (repository root — GitHub Pages serves `main` at path `/`).
Every source below is official: `docs.kalshi.com`, `kalshi.com`, or a live demo endpoint. Irregularities are
flagged in place and published on the site's [Flagged for Review page](flagged.html).

Parallel-session builds preserved in-tree (`a2ec5543/`, `monitor/`, `site/`, `trade1/`, `pages/`, `categories/`,
`js/`) are **historical artifacts**, not the deploy; they are listed by `scripts/check_site.mjs` and skipped, and
their own verification notes stay in-tree for review.

---

## 1. Files reviewed

### `index.html` — landing + executive summary
- Claims audited against sources: demo endpoints match [API Environments](https://docs.kalshi.com/getting_started/api_environments); the fee claim matches the [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf); the CORS claim matches `data/cors.json` (runner probes, 2026-11-20).
- The status strip reads `data/meta.json` only — no live value is asserted at page load.
- Every "not implemented on purpose" item links the official doc that explains it.

### `dashboard.html`, `topics/*.html`, `trades.html`
- Static shells; all dynamic content is rendered by `assets/app.js` from official endpoints, or from the
  Actions-verified snapshot when the API is unreachable (graceful degradation is asserted by `tests/smoke.test.js`).
- Topic pages load the shared assets with correct relative paths and pass `data-topic`, so each page shows only
  its own topic while the engine keeps one shared watchlist.

### `assets/app.js` — live engine
| Behavior | Verified against |
|---|---|
| Watchlist poll `GET /markets?tickers=…` (≤ 200 tickers/call) | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets): with `tickers` as the only filter every match comes back in one response and the cursor is empty. Settlement detection comes free from the same response (`status` + `result`). |
| Discovery `GET /events?status=open&limit=200` | [Get Events](https://docs.kalshi.com/api-reference/events/get-events): `limit` max 200; `limit=1000` → 400 (recorded in `data/log.md`). |
| Series discovery `GET /series?category=…&include_volume=true` (and `?tags=…`) | [Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list): the documented parameters are `category`, `tags`, `include_product_metadata`, `include_volume`, `min_updated_ts` — **`limit` is not documented and is ignored by the server** (verified live: `limit=1` still returned every matching series). `status` is **not** sent for the same reason. |
| Order book `GET /markets/{ticker}/orderbook?depth=10` | [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook): bids only, `[price, qty]` ascending, best bid last, `depth` = best 1–100 levels per side, empty arrays for a book-less ticker. Verified live. |
| Asks | Derived: YES ask ≡ 1 − NO bid, NO ask ≡ 1 − YES bid (official reciprocal rule). Every derived column is marked with an asterisk. |
| Chart ≥ 1 h `GET /series/{s}/markets/{t}/candlesticks?start_ts&end_ts&period_interval` | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks): path, `period_interval` ∈ {1,60,1440}, ≤ 5,000 periods, `start_ts`/`end_ts` in seconds. Verified live. |
| Alert threshold | Now `M.alertMove()` in `assets/model.js` — integer 1/10000-dollar comparison, so an exact $0.10 move fires (binary float renders `0.66 − 0.56` as `0.09999999999999998`). 45 s per-market cooldown. |
| 429 handling | Exponential back-off; polling only while the tab is visible — [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits). |
| No WebSocket | The handshake requires signed headers a browser cannot attach to a WebSocket — [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets). Flagged, not a bug. |
| Table rows | Each row now links the exact official `GET /markets?tickers=…` response that produced it. |

### `assets/model.js` — ROI screen, paper broker, alert threshold
- Score formula and weights are documented in `methods.html` §3 and labeled a heuristic (not verified alpha).
- **Fees — bug found and fixed this session.** The naive float expression `ceil(0.07·C·P·(1−P)·100)` returned
  **$1.76** for 100 contracts @ $0.50 because binary float renders 1.75 as `175.00000000000003`, while the official
  table says **$1.75**. The fee function now computes in integer arithmetic (price in 1/10000 $, count in 1/100)
  and reproduces **all 21 published price rows × {1, 100} contracts** of the General Trading Fees Table.
- Maker fees are deliberately not modeled (paper fills assume an immediate match) — flagged.
- **Per-series fee structure read from the API** ([Get Series List](https://docs.kalshi.com/api-reference/market/get-series-list)): every in-scope series checked reports `fee_type: "quadratic"`, `fee_multiplier: 1` — the general taker rule the model applies. The published PDF's per-series override table differs for some of these series (production values), which is flagged as item 6b.
- **Price grid and status:** a market's own `price_ranges` field is the exchange's price grid (e.g. `0.0000 → 1.0000`, step `0.0100`); `GET /exchange/status` reports the demo exchange and trading session as active — a cheap liveness probe.
- P&L, thresholds and rounding are covered by `tests/root_engine.test.js` (40 assertions, runs in CI).
- Earlier floating-point defects found and fixed by earlier sessions are preserved here: `0.57 − 0.42 = 0.1499…` once missed a +15¢ take-profit (all P&L deltas are now rounded to 4 dp before threshold comparisons), and an undefined reference in the alert path.

### `scripts/collect.py` · `scripts/topics.json` · `.github/workflows/pages.yml`

> Filename note (corrected 2026-11-21, session `155329c7`): this section used to name `.github/workflows/verify-and-collect.yml`,
> which is not in the repository. The workflow that actually runs the collector today is `.github/workflows/pages.yml`
> (job `snapshot`, cron `17 */3 * * *`).
- Stdlib-only Python; every value written to `data/` is verbatim from a URL logged in `data/log.md`. Absent
  fields are omitted, never defaulted.
- **Topic mirror defect found and fixed:** `scripts/topics.json` gives golf `exclude_categories:
  ["Politics","Elections"]` (session `f6094c46`, PR #20), but the live mirror in `assets/model.js → TOPICS`
  had no `exclCats` for golf, so the browser could pull Trump golf-club markets into Golf while the collector
  excluded them. `exclCats` is now present, and `tests/root_engine.test.js` asserts the mirror.
- The browser classifier now matches `title + " " + sub_title`, exactly as `scripts/collect.py → classify()`
  does — the two previously disagreed for events whose keyword only appears in `sub_title`.
- The `$comment` in `scripts/topics.json` named the wrong mirror file (`assets/app.js`); it now names
  `assets/model.js`, which is where the live mirror actually lives.

### `data/` — Actions-verified snapshots
- `cors.json` — probed from a GitHub-hosted runner. Latest probe in the committed file: **2026-11-21T06:58:35Z** —
  both demo hosts reflect any request `Origin` (HTTP 200, `access-control-allow-origin` echoes the request origin,
  including `https://wingbangboozle1-lang.github.io`) and `OPTIONS` preflight returns **204**. This is what makes
  client-side live mode possible.
  *Earlier revision of this line said "2026-11-20"; it was not re-dated when the collector rewrote the file.*
- `meta.json` — run findings. **Committed file (2026-11-21T06:58:35Z):** 2,200 open events, 33 open markets
  returned by the `status=open` sweep (`markets_open_statuses_observed` is `{}` because that sweep returned none and
  the collector fell back — see the note below), 0 recently settled markets, per-topic series counts, observed market
  field names. *Earlier revision of this line quoted 2,400 / 15,206 / 6,000 from a different run; those numbers are not
  in the committed file and have been replaced with the values the file actually contains.*
- **Collector caveat (found 2026-11-21, session `155329c7`):** the run that wrote the committed files was
  rate-limited — `data/log.md` shows **220 × HTTP 429** and the settled sweep stopping on its first one, so
  `settled_count_recent: 0` in that file is an artifact, not an exchange fact. `scripts/collect.py` now paces
  requests and retries 429 with backoff, and `resolved.json` carries `request_complete`. Published as flagged item
  `155329c7-1`. **Verified recovery (2026-11-21T07:17:44Z on `main`):** the fixed collector ran with
  `status: ok`, 0 transient read failures, nothing kept, 14,646 open markets (vs 33 degraded) and a
  2,675-row in-scope settled universe (up from 1,904).
- `topics/*.json` — per-topic ranked events with `_match_reason` (`category` / `series-prefix` /
  `series-discovery`) and per-row source URLs.
- `resolved.json` — recently settled in-scope markets with the official `result` (yes/no), settlement timestamp
  and settlement value.
- `log.md` — per-request audit trail (every request, its URL and its status).
- Snapshots are point-in-time; the live site always prefers a fresh API response when reachable.

### `suggestions.html`
- Merged from two parallel sessions' drafts: the live-feature list, the endpoint-anchored backlog, the continuous-organization rules and the trader's playbook. Every backlog row names the official endpoint it would use and links its doc page; nothing on the page is presented as verified data.

### `data.html` · `methods.html` · `flagged.html` · `sources.html`
- `data.html` renders the snapshots with a source link on every row; cells the API did not return stay blank.
- `methods.html` documents every rule with official links, including the two verified fee tables (published
  table reproduction + per-series `fee_type`/`fee_multiplier` read from the API).
- `suggestions.html` (new): what is live, a prioritized backlog tied to specific official endpoints, and a
  trader's playbook.
- `flagged.html` lists 19 items plus 2 sub-items, each with the link needed to re-check it.
- `sources.html` lists every official source used, including the documentation index
  (`https://docs.kalshi.com/llms.txt`) used to discover the doc pages.

### `.github/workflows/pages.yml`
- Runs on every push and pull request: `node scripts/test_lib.mjs`, `node tests/root_engine.test.js` (new —
  the deployed engine previously had **no** automated test), `node --check` on both root JS files, and
  `node scripts/check_site.mjs`.
- `scripts/check_site.mjs` was rescoped to the **deployed** pages (8 root + 5 topic pages) and now skips
  hrefs built by inline JavaScript; it reports the other sessions' pages as “not checked” instead of silently
  ignoring them.

---

## 2. Irregularities flagged (details + links on [flagged.html](flagged.html))

## Integration pass — session `a67aa1ab` (2026-11-20, branch `arena/a67aa1ab-trade1`, base `main` @ `069a1db`)

Scope: root site docs + engine (`COORDINATION.md`, `EXECUTIVE_SUMMARY.md`, `REVIEW.md`, `assets/app.js`, `assets/model.js`, `scripts/collect.py`, `flagged.html`, `methods.html`). No other session's files touched.

Changes verified line by line:

1. **`assets/app.js` — alert threshold made float-safe.** Replaced `Math.abs(raw) < CFG.alertThreshold - 1e-9` with integer 1e-4 comparison (`Math.abs(Math.round(raw * 10000)) < 1000`), so an exact $0.10 move (e.g. $0.66 → $0.56) can never be missed through double error. Alert now reports 4-dp delta.
2. **`assets/app.js` + `assets/model.js` — golf topic defense-in-depth.** Added `exclCats: ['Politics', 'Elections']` to the golf topic in both `assets/model.js` (client classifier) and mirrored the `exclude_categories` check already in `scripts/topics.json` / `scripts/collect.py` discovery, so Trump golf-club markets filed under Politics never enter the Golf topic (credit: session `a2ec5543` PR #20).
3. **`assets/app.js` — ranking by highest estimated traded dollars.** `rowsFor()` now sorts by total est. dollars (`volume_fp × last_price_dollars`) with 24h est. as tiebreak; label updated on the dashboard ("Ranked by highest estimated traded dollars … compute, not exchange-published").
4. **`assets/app.js` — orderbook now shows NO-side depth.** Added NO ask (derived `1 − YES bid`) and NO bid ladders with contracts-at-each-price bars, so traders can see how many contracts are available at a given price on both sides.
5. **`assets/app.js` — chart alert markers.** ≥$0.10 swing alerts for the selected ticker are plotted on the price curve (green = up, pink = down) within the chosen time window.
6. **`assets/app.js` — fee disclosure updated.** Paper broker fees are ON by default using the official taker schedule `round_up(0.07 × C × P × (1−P))` (verified from the fee schedule PDF); the "Fees excluded / UNVERIFIED 7%" language removed.
7. **`EXECUTIVE_SUMMARY.md`** rewritten to describe the deployed root site (was describing session `f6094c46`'s `site/` build).
8. **`REVIEW.md`** — alert-rule line updated; this integration section added.
9. **`COORDINATION.md`** — claim appended (task, status, owner session, files in scope); PR/merge to be recorded here after integration.

## How to re-verify

- Snapshot evidence: `data/log.md` (every request logged), `data/cors.json`, `data/meta.json`.
- Live probes: open any linked endpoint URL from `data.html` or `sources.html` in a browser.
- Site build: all pages return HTTP 200 from a static server; JS passes `node --check` (done for `assets/app.js`, `assets/model.js`); model harness passes (see session log in COORDINATION.md).
- Re-run `node scripts/test_lib.mjs` and `node scripts/check_site.mjs` (0 failures) before merge.
| # | Item |
|---|---|
| 1 | Demo market `status` is `active`/`finalized`; docs enumerate `unopened/open/closed/settled`. |
| 2 | `GET /events?limit=1000` → 400; page size 200 used. |
| 3 | Candlestick path: legacy `/markets/{t}/candlesticks` not served; the documented series-scoped path is used (verified both ways, live). |
| 4 | Some demo `settlement_sources` contain template gaps — shown verbatim. |
| 5 | No exchange-published per-market dollar-notional field → every “$” figure is a labeled estimate. |
| 6 | Taker fee verified and now exact; maker fees and the per-series override table are not applied. |
| 6b | Per-series fee structure verified from the demo API (`fee_type`/`fee_multiplier`); the published PDF's production overrides differ for some series. |
| 6c | Fee rounding granularity: PDF "centicent" vs the newer 6-decimal Fee Rounding doc — we use the published table (never lower than the exchange). |
| 7 | News causality is never claimed; alerts link the official market page, the settlement sources and a labeled news-search lead. |
| 8 | ROI score weights are engineering choices, not verified alpha. |
| 9 | Topic matching is heuristic; `scripts/topics.json` ↔ `assets/model.js` are mirrored by hand (now asserted by a test). |
| 10 | Paper fills assume no slippage and unlimited size at the best quote. |
| 11 | Unauthenticated rate limits are undocumented; the client backs off on 429 and polls modestly. |
| 12 | A demo-account portfolio requires credentials the site deliberately never requests. |
| 13 | No WebSocket in a browser (platform constraint). |
| 14 | No order placement anywhere (paper only). |
| 15 | Alerts are sampled between polls (~12 s); faster swings are invisible over REST. |
| 16 | Sub-hour chart windows use session samples that reset on reload. |
| 17 | The 45 s per-market alert cooldown suppresses a second genuine move inside that window. |
| 18 | Order-book asks are derived, not exchange-published (labeled). |
| 19 | WebSocket hosts confirmed official but unused (signed handshake). |

---

## 3. How to re-verify everything yourself

- **Every table row** on [data.html](data.html) links the official URL that produced it; blank cells mean the
  API did not return the value.
- **Per-request evidence:** [`data/log.md`](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/log.md),
  [`data/cors.json`](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/cors.json),
  [`data/meta.json`](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/meta.json).
- **Live probes:** open any linked endpoint URL from [data.html](data.html) or [sources.html](sources.html).
- **Automated checks:** `node tests/root_engine.test.js` (40 assertions incl. the full official fee table),
  `node scripts/test_lib.mjs`, `node tests/engine.test.js`, `node tests/smoke.test.js`,
  `node scripts/check_site.mjs` — all run in CI on every push and pull request.
- **Session history and task board:** [COORDINATION.md](COORDINATION.md).
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

### Live demo-endpoint probes (this session, via page-fetch)

| Probe | Result | Confirms |
|---|---|---|
| `GET /exchange/status` | 200, `trading_active: true` | demo exchange reachable, demo shards active |
| `GET /events?status=open&limit=200` | 200 (paged) | documented page size (Get Events example uses `limit=200`); `CFG.eventsLimit = 200` |
| `GET /events?status=open&limit=1000` | rejected (fetch error) | over the documented maximum; engine correctly uses 200 |
| `GET /markets?status=open&limit=3&mve_filter=exclude` | 200; `status:"active"`, `last_price_dollars`, `previous_price_dollars`, `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `yes_bid/ask_dollars`, `result:""` | field units in Methods; response status `active` is the **documented** value (see claim check 10) |
| `GET /series/KXAAAGASM/markets/KXAAAGASM-26NOV30-3.90/candlesticks?start_ts=…&end_ts=…&period_interval=1` | 200, `candlesticks: []` | candlestick path used by `fetchCandles()`; empty-candles flag for KXAAAGASM stands |
| `GET /markets/KXAAAGASM-26NOV30-3.90/orderbook` | 200, `orderbook_fp: {yes_dollars: [], no_dollars: []}` | documented empty-book behavior; orderbook path correct |
| `GET /markets/KXNATGAS15M-26NOV201245-45` | 200; `result:"no"`, `status:"finalized"`, `settlement_ts:"2026-11-20T17:45:24.334041Z"` | the `data/resolved.json` row matches **verbatim**; per-row official link on `data.html`; `finalized` is the documented terminal status |
| `GET /events?status=open&limit=200` (body sample) | `settlement_sources` containing template entries (`url:"https://kalshi.com/"` for generic names) | placeholder-URL flag confirmed live |

### Claim checks (site → official source → result)

1. **Demo endpoint pair** (recommended `external-api.demo.kalshi.co`, also `demo-api.kalshi.co`, WS pair) — [demo_env](https://docs.kalshi.com/getting_started/demo_env) — **match** (site header, README, `CFG.bases`).
2. **Taker fee `roundup(M × 0.07 × C × P × (1−P))`, M default 1; maker 0.0175, M default 0; no settlement fee** — [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (table row: 100 contracts @ $0.50 → $1.75) — **match** with `assets/model.js` integer fee math, locked by `tests/root_engine.test.js` (**40/40**, includes every published fee-table row) and `tests/engine.test.mjs` (**25/25**, real engine in jsdom).
3. **Orderbook: `orderbook_fp.{yes_dollars,no_dollars}` = `[price_dollars, count_fp]`, ascending, best bid last, bids only, YES ask = 1 − NO bid** — [orderbook_responses](https://docs.kalshi.com/getting_started/orderbook_responses) — **match** with `bookViews()` in `assets/app.js`.
4. **Winning side receives $1 per contract; settlement fee zero for yes/no** — [market_settlement](https://docs.kalshi.com/getting_started/market_settlement) — **match** with paper settlement in `assets/model.js`.
5. **Public unauthenticated market data; Kalshi UI pattern `kalshi.com/markets/<series>`** — [quick start market data](https://docs.kalshi.com/getting_started/quick_start_market_data) — **match** with the row links rendered by `data.html`/`assets/app.js`.
6. **Alert rule ≥ $0.10 either direction compared in whole 1/10000-dollar units** — official prices are 4-dp fixed-point strings (observed live: `"0.4500"`; [fixed-point docs](https://docs.kalshi.com/getting_started/fixed_point_migration)) — **match** with `M.alertMove()`; exact-$0.10 float trap covered by tests.
7. **Estimated dollar figures labeled estimates** — no official per-market dollar-notional field in the live responses (observed field set above; Get Events schema shows none) — **match** (labeling present on dashboard, data page, methods).
8. **No WebSocket in the browser** — WS handshake requires signed auth headers ([WS quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), cited in `assets/app.js`) — **flagged, not a bug**.
9. **CORS: demo API reflects any browser origin** — `data/cors.json` (GitHub-runner probes with verbatim headers, 2026-11-20) — **recorded evidence**; not re-probeable from this sandbox.
10. **Market status vocabulary** — [market lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) documents REST statuses `initialized/active/inactive/closed/determined/disputed/amended/finalized` with filters `open→active`, `settled→finalized` — the site’s observed `status:"active"` / `"finalized"` values are **documented**; the older “status mismatch” flag is withdrawn (this session re-read the doc; the correction is already on `flagged.html`).
11. **Events page size** — [Get Events](https://docs.kalshi.com/api-reference/events/get-events) shows `limit=200`; `limit=1000` rejected live — the site’s use of 200 is the documented maximum (the older “undocumented ceiling” wording is withdrawn; already corrected on `flagged.html`).

### Validation runs (final, after merging `origin/main` @ `c0e1d1c`)

- `node tools/build.mjs` → **BUILD OK — 17 HTML, 3 JS files validated, 0 broken links** (consolidated single-site tree: every published page + `assets/` engine).
- `node scripts/check_site.mjs` → **17 HTML, 282 links, 1,250 rows, 825 resolved, 0 failures** — includes this session’s topic-snapshot `source_urls` checks, `event_ticker`-per-row checks, and `resolved.json` verbatim yes/no checks.
- `node scripts/test_lib.mjs` → passed · `node tests/root_engine.test.js` → **40/40** · `node tests/engine.test.mjs` → **25/25** (jsdom@26.1.0, Node 22 locally / 24 in CI).
- `npm run check` (= build + check_site) and `npm run test` (= engine.test.mjs + test_lib) → pass.
- CI (`.github/workflows/pages.yml`, after conflict resolution): jsdom install → `engine.test.mjs` → `test_lib.mjs` → `root_engine.test.js` → `tools/build.mjs` → `check_site.mjs` on every push/PR.
- Note: `tests/engine.test.js` and `tests/smoke.test.js` still reference the removed `monitor/` tree (removed by main’s consolidation) and fail if run by hand; they are **not** in CI. Left in place — they belong to session f6094c46’s scope; flagged here instead of deleted.

### Merge record (`origin/main` `c0e1d1c` merged into this branch)

`main` advanced (PRs #30, #33, #34, #36, #37) while this session worked — including a full repo
consolidation to one site and other sessions’ own suggestions page, chart markers, and `check_site`
rewrite. Merge resolved **without discarding either side** (21 conflicted files):

| File | Resolution |
|---|---|
| Nav pages (`index`, `dashboard`, `trades`, `methods`, `flagged`, `sources`, `topics/*`, `data.html` nav) | main’s nav kept (adds Summary; label “Ideas”) — this session’s duplicate link dropped (same target) |
| `suggestions.html` (add/add) | main’s richer page kept as base (18-item backlog with official-API columns, playbook); this session’s unique items appended as rows 19–22 (URL state, depth heatmap, alert-rule tuning, small-multiple charts) + shipped jump-log noted in the feature row |
| `assets/app.js` | main’s chart (Y-scale, hover crosshair, trade-tape source, alert dots + `#kx-chart-alerts` link hint) kept; this session’s **per-market jump log** (`#kx-jumps` + `renderJumps`, full event/settlement/news links) kept alongside |
| `scripts/check_site.mjs`, `tools/build.mjs`, `.github/workflows/pages.yml` | main’s consolidated versions kept (every published page, inline-script skip, jsdom/Node pins); this session’s JSON row checks retained inside `check_site.mjs` |
| `data.html` | main’s `marketApiUrl()` per-row links kept (same endpoint this session verified live); superseded duplicate dropped |
| `EXECUTIVE_SUMMARY.md`, `README.md` | main’s rewrites kept (accurate root-site descriptions) |
| `COORDINATION.md`, `REVIEW.md` | both sides’ session records kept, in order |
| `tools/build-report.json` | regenerated from the merged tree |

### Irregularities (current list lives on [flagged.html](flagged.html), post-correction)

Demo-account portfolio/execution needs owner-provided demo API keys (never requested in chat —
dormant `scripts/demo_account/` track exists in PR #2); WebSocket requires signed headers (no
browser feed); REST cache lag (alerts lag seconds); no official dollar-notional (rankings are
labeled estimates); maker fees not modeled; KXAAAGASM empty candles (cause unknown); placeholder
`settlement_sources` URLs; unauthenticated rate limits unpublished; ROI screen is a documented
heuristic, not verified alpha; session chart samples reset on reload. The previously published
“status vocabulary” and “undocumented events page-size” flags were **withdrawn** above after
re-reading the official docs — `flagged.html` already carries the corrected text.
