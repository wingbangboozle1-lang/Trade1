# Verification record — session `1d71a602` (final integration, 2026-11-21)

Branch `arena/1d71a602-trade1`, base `main` @ `7d1c21f` (PR #71 merge).
Every claim below was checked line-by-line against an official Kalshi source read on
2026-11-21, or against a committed artifact whose own source URL is cited. Anything that
could not be confirmed is left blank and flagged (NEW-1 … NEW-8 on `flagged.html`).
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
- `data/topics/*.json` + `data/meta.json` (`generated_at` **2026-11-21T03:59:57Z** — the run
  currently committed on `main`; PR #80 restored it after a degraded later run), written by
  `scripts/collect.py` on the `pages.yml` schedule: events per topic — elections 2,163 · crypto 89 ·
  culture 68 · golf 46 · **gas-prices 11**. Embedded market rows per file (active / finalized):
  elections 199 (186/13) · crypto 211 (192/19) · culture 189 (176/13) · golf 137 (136/1) ·
  gas 75 (74/1). Largest estimated event dollars: elections `KXPRESNOMD-28` $1,272,018,312.83 ·
  crypto `KXBTCY-27JAN0100` $140,647,984.60 · culture `KXOSCARPIC-27` $2,769,757.45 · golf
  `KXPGATOUR-THRC26` $202,021.80 · gas `KXAAAGASM-26NOV30` $61,840.01 — every one of them a
  computed sum of `contracts × last price`, and `data/meta.json` → `notes[1]` states that plainly
  ("_est_dollar_volume is computed … not an exchange-published field").
  `meta.findings` for the same run: `markets_open_count` 14,678 · `events_open_count` 2,400 (capped
  page sample) · `settled_count_recent` 6,000 · `orderbook_ok` / `candlesticks_ok` true.
  Source: `data/topics/*.json` → `_est_dollar_volume`; `data/meta.json` → `findings`/`notes`.
- `data/resolved.json` (same 03:59:57Z run): window "last 3 days (`min_settled_ts` = now−72h)",
  `settled_total` 6,000, `in_scope_count` 1,904, **200** published rows — the published subset is
  capped, which is exactly what Flagged I4 records. Each row carries the official `result` and its own
  `source_url`. Source: `data/resolved.json` → `window`/`settled_total`/`in_scope_count`/`markets`.
- `data/portfolio.json` (`generated_at` **2026-11-21T07:08:16Z**, CI ledger — the newest run on
  `main` after this session's rebase): 12 trades (8 open, 4 realised, 2 settled), 0 wins / 4 losses,
  realised P&L **−$59.5891** on $99.2991 cost (ROI −60.01%), equity **$933.48** of the $1,000
  simulated bankroll (return −6.652%), cash $744.17, peak $995.44, max drawdown −$61.96,
  30 alerts, 21 resolutions, 14 equity-curve points, 15 runs, watchlist 120.
  By strategy (trades / closed / realised P&L): momentum 7 / 2 / −$29.17 · fade 1 / 1 / −$5.55 ·
  harvest 1 / 1 / −$24.87 · breakout 3 / 0 / $0. By topic: crypto 7 / 3 / −$55.29 · culture 3 / 1 /
  −$4.30 · elections 2 / 0 / $0 · gas-prices 0 · golf 0 trades.
  Source: `data/portfolio.json` → `summary`/`by_strategy`/`by_topic` (`trades`, `closed`, `pnl_usd`).
  The ledger is regenerated by `portfolio.yml`, so these are point-in-time; an earlier run the same
  morning (06:00:20Z) showed 11 trades / equity $934.77 and is superseded, not contradicted.
- `data/demo_account/status.json`: `configured: false` — no demo-account balance/positions exist
  to report; execution log entries are `dry_run`/`not_sent`. No real-money or demo-account
  performance is claimed anywhere on the site.

## 4. Gates run this session (all exit 0 unless noted)

- `npm run check`, re-run on the rebased branch: BUILD OK 18 HTML / 6 JS / 0 broken links;
  `check_site.mjs` 1,249 rows / 825 resolved / 0 failures (counts moved because PR #80 restored a
  larger collector run under this session); `check_links.mjs` 16 pages / 408 local / 272 external / 0 failures (the pre-edit baseline was 400 local / 236 external). V4's schema example was re-read directly:
  `"notional_value_dollars": "0.5600"` sits next to `"last_price_dollars": "0.5600"`, and `limit` on
  `/markets` is documented max 1000 (default 100).
- `npm test` → engine, live_fixes, live_dash, lib, fees, model, root_engine, model.test,
  portfolio 60/60, demo-account 89/89, `test_collect.py` 4/4 — all pass
  (requires `npm install jsdom@26.1.0` first; without it `engine.test.mjs` fails to import —
  pre-existing, CI installs it).
- `node tools/render_test.mjs --offline <all 16 published pages>` → 16 pages rendered, 0 JS errors
  (the tool defaults to `index.html` alone, so every page was named explicitly this session).
- Sandbox → Kalshi: `curl https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` → `000`
  (no route). Live shapes were therefore re-verified from the §1 docs, the committed
  `data/samples/` responses, and the collector's own `data/log.md`. Recorded as NEW-5; AA-8 stands.
- `data/log.md` read line by line (297 lines, the 06:58:35Z run): **31 × `-> 200`, 1 × `-> 204`
  (CORS preflight), 220 × `-> 429`** — 212 on `/markets`, 7 on `/series`, 1 on `/events`, with
  `{"error":{"code":"too_many_requests", …}}` bodies. That is why that run's files were rolled back
  and why `scripts/collect.py` now reads fail-closed (retry on 429/5xx, keep the verified artifacts
  when upstream fails) as of PR #80. Recorded as NEW-8; nothing on the site claims a complete census.
- Pages API at claim: `status: built`, `build_type: legacy`, source `main /`, commit `7d1c21f`.
  Post-merge verification recorded in `COORDINATION.md` after the PR merges.

## 5. Irregularities found (published on `flagged.html`, do not block)

- **NEW-1** Two snapshot pipelines, three clocks: `data/snapshot.json` is 2026-11-20T19:11Z;
  `data/topics/*.json` + `data/meta.json` + `data/resolved.json` are 2026-11-21T03:59:57Z; and
  `data/log.md`'s newest recorded run is 2026-11-21T06:58:35Z — a run whose written files were later
  rolled back by PR #80, so the log describes a collection that is no longer the committed data.
  The Data page reads the topic set, `check_site.mjs` reads the snapshot. Freshness is stated per file
  and never merged into one "as of" claim.
- **NEW-2** `notional_value_dollars` is $1.00/contract (payout), not total dollars (V4). The
  snapshot's `open_interest_notional_derived` (= open interest × $1) is therefore max-payout
  dollars, and snapshot row selection sorts by it (≈ open-interest contracts), while the live
  dashboard ranks by estimated traded dollars (volume × last price). Two different "highest
  dollar" definitions coexist and are now both labelled where they appear.
- **NEW-3** The two pipelines **disagree about gas prices**: `data/snapshot.json` (2026-11-20T19:11Z)
  records 0 gas markets, while `data/topics/gas-prices.json` (2026-11-21T03:59:57Z) holds 11 gas
  events with 75 embedded market rows, 74 of them `active` (e.g. `KXAAAGASM-26NOV30-3.90`, last price
  $0.7500, `close_time` 2026-11-30T04:59:00Z). Both are true of their own run — the snapshot builder
  simply had not seen those events at 19:11Z. The topic pages render from the newer file, so the gas
  page is populated; a page reading the older snapshot would show an empty state. Elections still
  dominates open coverage (7,954 of 9,847 rows before caps).
- **NEW-4** Portfolio sample is 12 trades with 0 wins and only 4 closed — too small to judge any
  strategy (the backtest's F7 and Flagged item 8 say the same). The −60% realised ROI is reported
  as-is; no strategy is recommended.
- **NEW-5** Sandbox cannot reach Kalshi (curl 000). No live API value was re-fetched from this
  sandbox; verification rests on official docs + committed CI evidence. AA-8 stands.
- **NEW-6** Other sessions' PRs overlapping this integration — nothing merged, edited or closed by
  this session (details in §6).
- **NEW-7** Dangling in-page anchor on `flagged.html`: an earlier row linked to `flagged.html#f7` but
  no element carried that id, and the `F7` label actually belongs to `reports/FLAGGED_FOR_REVIEW.md`
  (where it means the backtest sample). Fixed here: the ROI-model row carries `id="f8"`, the stale
  reference points at it, and every NEW row has a real id.
- **NEW-8** The newest collector run in `data/log.md` (2026-11-21T06:58:35Z) is mostly upstream
  rate-limiting: 220 × `429 too_many_requests` against 31 × `200`, concentrated on `/markets`.
  Its output was rolled back (PR #80) and the collector is now fail-closed, so a future 429 storm
  leaves the last verified files in place instead of a half-filled snapshot. Consequence for a
  reader: `429` in the log means "the collector could not see that page", never "the market does not
  exist"; the site's coverage-cap disclosures already refuse census language.

## 6. Other sessions' PRs — disposition (no merge by this session)

At claim (≈2026-11-21T06:55Z) the open set was **#70, #68, #67, #64, #58**. While this session worked,
their own authors landed them: **#64 → merged `d949035`** (collector fix), **#70 → merged `948488e`**
(final-integration pass, with **#58 closed** after its content was taken over), plus #65/#66/#69/#71–#81
and #74. Re-checked at **2026-11-21T07:17Z** (`gh pr list`): still open are **#79, #75, #68, #67 — all
CONFLICTING with `main`**. None of them is this session's work; none was merged, edited or closed here.
They are listed for the owner to close after review, since `main` already carries the consolidated site
and this integration on top of it.

| PR | Head branch | State at last check | This session's action |
|---|---|---|---|
| #79 | `arena/0b68e1e4-trade1` | OPEN, CONFLICTING | Not touched — owner to review/close |
| #75 | `arena/725b09a7-trade1` | OPEN, CONFLICTING | Not touched — owner to review/close |
| #68 | `arena/6b112481-trade1` | OPEN, CONFLICTING | Not touched — owner to review/close |
| #67 | `arena/d256bfac-trade1` | OPEN, CONFLICTING | Not touched — owner to review/close |
| #64 | `arena/c96a21b7-trade1` | MERGED `d949035` (by its author) | Not touched by this session |
| #70 | `arena/6877ec31-trade1` | MERGED `948488e` (by its author) | Not touched by this session |
| #58 | `arena/6916270f-trade1` | CLOSED with a takeover note (session `6877ec31`) | Not touched by this session |
