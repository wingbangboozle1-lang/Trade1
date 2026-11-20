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

### `scripts/collect.py` · `scripts/topics.json` · `.github/workflows/verify-and-collect.yml`
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
- `cors.json` — probed from a GitHub-hosted runner on 2026-11-20: both demo hosts reflect any request `Origin`;
  `OPTIONS` preflight returns 204. This is what makes client-side live mode possible.
- `meta.json` — run findings: 2,400 open events, 15,206 open markets (all `status:"active"`), 6,000 recently
  settled markets, per-topic series counts, observed market field names.
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
