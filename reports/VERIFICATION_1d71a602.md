# Verification record — session `1d71a602` (final integration, 2026-11-21)

Branch `arena/1d71a602-trade1`, base `main` @ `7d1c21f` (PR #71 merge).
Every claim below was checked line-by-line against an official Kalshi source read on
2026-11-21, or against a committed artifact whose own source URL is cited. Anything that
could not be confirmed is left blank and flagged (NEW-1 … NEW-6 on `flagged.html`).
No values were inferred.

## 1. Official sources re-read this session (all `docs.kalshi.com` unless noted)

| # | Claim in the site | Official source (read 2026-11-21) | Result |
|---|---|---|---|
| V1 | Demo REST root `https://external-api.demo.kalshi.co/trade-api/v2`, also-supported `https://demo-api.kalshi.co/trade-api/v2` | [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) — Demo row: recommended `external-api.demo.kalshi.co`, also supported `demo-api.kalshi.co` | ✅ matches brief + code (`assets/lib.mjs` `API_BASES`, `scripts/collect.py` `BASE`/`ALT`) |
| V2 | Demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, also-supported `wss://demo-api.kalshi.co/trade-api/ws/v2` | Same page, WebSocket API table | ✅ matches brief |
| V3 | Demo = mock funds; demo prices/behaviour may not reflect production | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) — "demo environment with mock funds", "may not be reflective of those in real markets" | ✅ site disclaimer is verbatim-faithful |
| V4 | `GET /markets` schema: `yes_bid_dollars`/`yes_ask_dollars`/`last_price_dollars` (≤4 dp strings), `volume_fp`/`volume_24h_fp`/`open_interest_fp` (2 dp), `result` yes/no, `notional_value_dollars`, `settlement_value_dollars`/`settlement_ts` | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) response schema | ✅ field names in `data/samples/*` and `assets/lib.mjs` match; `notional_value_dollars` is per-contract (example `0.5600` alongside price `0.5600`) — see NEW-2 |
| V5 | Order book: bids only, `[price_dollars, count_fp]` ascending, best bid **last**, YES ask = $1 − best NO bid (reciprocal), `depth` = best N levels | [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses) | ✅ `assets/lib.mjs → parseOrderbook`, `assets/app.js` ladder (fixed AA-3) implement exactly this |
| V6 | Candlesticks: `GET /series/{s}/markets/{t}/candlesticks`, `period_interval` ∈ {1, 60, 1440} minutes only, `start_ts`/`end_ts` in seconds | [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) | ✅ chart uses 1/60 only; seconds/minutes windows use the trade tape instead (documented in `assets/app.js` header) |
| V7 | WebSocket requires signed `KALSHI-ACCESS-*` headers **during the handshake** → a browser cannot attach them → REST polling from static pages | [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) — "WebSocket connections require authentication during the connection handshake", required headers `KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP` | ✅ polling design is forced by the docs, not a preference |
| V8 | Market statuses: `initialized/active/inactive/closed/determined/disputed/amended/finalized`; `result` = `yes`/`no`/`scalar`; settled markets end at `finalized` with `settlement_ts` | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) | ✅ code handles `active` + `finalized`/`determined`/`amended` (691-5 fix); demo `status:"active"` spelling is the documented one |
| V9 | Settlement: YES holders receive $1/contract on YES, NO holders $1/contract on NO; settlement fees zero for simple yes/no | [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | ✅ paper broker settles at $1 per winning contract, no settlement fee |
| V10 | Fees: taker `roundup(M × 0.07 × C × P × (1−P))`, maker `roundup(M × 0.0175 × …)`, no settlement fee; per-series `M` from the Non-Standard Fees table | [Fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective 2026-07-07) + [Fee Rounding](https://docs.kalshi.com/getting_started/fee_rounding) — re-verified by prior sessions; `scripts/test_fees.mjs` reproduces all 21 published rows (100 @ $0.50 = $1.75) | ✅ unchanged this session; fee conflict (demo `fee_multiplier` vs schedule `M=0` for `KXBTCY`/`KXETHY`) remains published side-by-side (6b/691-1) |

## 2. Requirement → delivery audit (brief, line by line)

| Requirement | Delivered | Evidence (this session) |
|---|---|---|
| Highest-dollar live events, 5 topics only | Dashboard + `topics/*.html` rank by **estimated** traded dollars (contracts × last price), topics kept separate | `assets/app.js` ranking note; `scripts/topics.json` (5 topics); `data/snapshot.json` topics counts (below) |
| ≥ $0.10 swings either direction, two scrolling chats (all + model ROI) | Integer-unit compare (exact $0.10 never lost to float error), 45 s cooldown, two chats, ROI score ≥ 0.45 for model chat | `assets/model.js → alertMove/score`; `assets/app.js → CFG.alertThreshold/alertCooldownMs`; tests `scripts/test_model.mjs`, `tests/live_dash.test.mjs` |
| Track until resolved YES/NO | Watched markets re-checked every poll; official `result` + `settlement_ts` recorded; paper settles $1/winner | `assets/app.js` resolution path; `resolved.html`; `data/snapshot.json` resolved 625 rows (494 NO / 131 YES) |
| Simulated trades / strategies | 4 paper strategies (momentum, fade, harvest, breakout) on live quotes with official taker fee | `assets/model.js`; `trades.html`; CI ledger `scripts/portfolio_engine.py` |
| Portfolio performance (demo account) | **Three disclosed layers:** browser lab (localStorage) · CI ledger (`data/portfolio.json`, always-on) · opt-in demo-account console (key-gated, inert without secrets) | `data/demo_account/status.json`: `configured: false`, "No request was sent"; `demo-account/` + `scripts/demo_account/` |
| Execute trades + track performance | Paper fills automated; demo-account guarded orders (max 3 / $3.00, buy-YES-only) only in `live` mode with credentials | `scripts/demo_account/execute.mjs`; execution log shows `dry_run`/`not_sent` only |
| Price graph X=time (s/m/h), Y=price; liquidity; contracts at price | Canvas chart 60 s → 24 h (trade tape + candlesticks), order-book ladders with contracts/level + sweep cost | `assets/app.js → WINDOWS/chartData/drawChart`; V5/V6 above |
| Jump causes: events + links | Every alert links official market page, event `settlement_sources`, labelled news-search lead; causality never asserted | `assets/app.js` alert builder; `flagged.html` I7 |
| Suggestions for liveness/interactivity | `suggestions.html` (shipped vs backlog, each backlog row names its official endpoint) | Read this session; §2c shipped list matches AA fixes |
| GitHub Pages site, category subpages, sourced tables | Landing + 5 topic pages + dashboard/lab/portfolio/data/methods/ideas/flagged/sources; `check_site.mjs` enforces per-row `source_url` | `npm run check` green (below); Pages `built` (below) |
| No manual input; autonomous to merge | This session requested nothing from the owner; PR merged without waiting (see §4) | This report + `COORDINATION.md` |

## 3. Fresh numbers (verbatim from committed artifacts — not recomputed, not inferred)

- `data/snapshot.json` (`generated_at` **2026-11-20T19:11:17Z**): 17,753 matched rows before caps,
  9,847 open, 8,645 resolved; kept 1,118 open + 625 resolved. By topic (open): elections 7,954 ·
  crypto 440 · culture 329 · golf 67 · **gas-prices 0**. Coverage pages truncated=true for
  open/closed/settled (caps recorded in the file). Source: `data/snapshot.json` → `counts`/`topics`/`coverage`.
- `data/topics/*.json` + `data/meta.json` (`generated_at` **2026-11-21T06:58:35Z**, `scripts/collect.py`):
  events per topic — elections 1,942 · culture 28 · crypto 4 · golf 3 · gas-prices 0.
  Top estimated event dollars: elections `KXRHOUSESEATS-27` $1,579,719.60 · crypto
  `KXBTC50VS100-BTC-26DEC31` $1,480,017.12 (both `contracts × last price`, labelled estimates).
  Source: `data/topics/*.json` → `_est_dollar_volume`; `data/meta.json`.
- `data/portfolio.json` (`generated_at` **2026-11-21T06:00:20Z**, CI ledger): 11 trades
  (7 open, 4 realised, 2 settled), 0 wins / 4 losses, realised P&L **−$59.59** on $99.30 cost
  (ROI −60.01%), equity **$934.77** (bankroll $1,000, return −6.52%), peak $995.44,
  max drawdown −$60.67, 29 alerts, 21 resolutions, 13 equity points, 14 runs.
  By strategy: momentum 7 trades −$29.17 · harvest 1 −$24.87 · fade 1 −$5.55 · breakout 2 open $0.
  By topic: crypto 7 −$55.29 · culture 2 −$4.30 · elections 2 open $0 · gas/golf 0 trades.
  Source: `data/portfolio.json` → `summary`/`by_strategy`/`by_topic`.
- `data/demo_account/status.json`: `configured: false` — no demo-account balance/positions exist
  to report; execution log entries are `dry_run`/`not_sent`. No real-money or demo-account
  performance is claimed anywhere on the site.

## 4. Gates run this session (all exit 0 unless noted)

- `npm run check` → BUILD OK 18 HTML / 6 JS / 0 broken links; `check_site.mjs` 1,183 rows /
  625 resolved / 0 failures; `check_links.mjs` 16 pages / 408 local / 269 external / 0 failures (after
  this session's edits; the pre-edit run showed 400 local / 236 external). V4's schema example was re-read directly:
  `"notional_value_dollars": "0.5600"` sits next to `"last_price_dollars": "0.5600"`, and `limit` on
  `/markets` is documented max 1000 (default 100).
- `npm test` → engine, live_fixes, live_dash, lib, fees, model, root_engine, model.test,
  portfolio 60/60, demo-account 89/89, `test_collect.py` 4/4 — all pass
  (requires `npm install jsdom@26.1.0` first; without it `engine.test.mjs` fails to import —
  pre-existing, CI installs it).
- `node tools/render_test.mjs --offline <all 16 published pages>` → 16 pages rendered, 0 JS errors
  (the tool defaults to `index.html` alone, so every page was named explicitly this session).
- Sandbox → Kalshi: `curl https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` → `000`
  (no route). Live shapes re-verified via §1 docs + committed `data/samples/` + CI `data/log.md`
  (2026-11-21T06:58 run, all 200s). Recorded as NEW-5; AA-8 stands.
- Pages API at claim: `status: built`, `build_type: legacy`, source `main /`, commit `7d1c21f`.
  Post-merge verification recorded in `COORDINATION.md` after the PR merges.

## 5. Irregularities found (published on `flagged.html`, do not block)

- **NEW-1** Two snapshot pipelines, two clocks: `data/snapshot.json` (2026-11-20) vs
  `data/topics/*.json`/`data/meta.json` (2026-11-21). The Data page reads the newer set; the
  older file is still checked by `check_site.mjs`. Freshness is stated per file, never merged.
- **NEW-2** `notional_value_dollars` is $1.00/contract (payout), not total dollars (V4). The
  snapshot's `open_interest_notional_derived` (= open interest × $1) is therefore max-payout
  dollars, and snapshot row selection sorts by it (≈ open-interest contracts), while the live
  dashboard ranks by estimated traded dollars (volume × last price). Two different "highest
  dollar" definitions coexist and are now both labelled where they appear.
- **NEW-3** Gas prices has **0** open markets in both pipelines. Genuine demo state (series exist,
  no open events), not missing data. Elections dominates open coverage (7,954 of 9,847).
- **NEW-4** Portfolio sample is 11 trades with 0 wins — too small to judge any strategy (F7
  stands). The −60% realised ROI is reported as-is; no strategy is recommended.
- **NEW-5** Sandbox cannot reach Kalshi (curl 000). No live API value was re-fetched from this
  sandbox; verification rests on official docs + committed CI evidence. AA-8 stands.
- **NEW-6** Open PRs #70 (mergeable), #64 (mergeable), #68/#67/#58 (conflicting) from other
  sessions predate this integration and were not merged here. Owner to close after review;
  this PR is the final integration on top of `main` @ `7d1c21f`.

## 6. Open PRs at claim (for the owner)

| PR | Head branch | State | This session's action |
|---|---|---|---|
| #70 | `arena/6877ec31-trade1` | OPEN, mergeable | Not merged (superseded by #71 + this integration); recommend close |
| #68 | `arena/6b112481-trade1` | OPEN, conflicting | Not merged; recommend close |
| #67 | `arena/d256bfac-trade1` | OPEN, conflicting | Not merged; recommend close |
| #64 | `arena/c96a21b7-trade1` | OPEN, mergeable | Not merged; collector fix — owner to cherry-pick or close |
| #58 | `arena/6916270f-trade1` | OPEN, conflicting | Not merged (taken over by #70, itself superseded); recommend close |
