# Executive Summary — Kalshi Demo Dashboard (root site)

**Date:** 2026-11-20 · **Repo:** `wingbangboozle1-lang/Trade1` · **Site:** GitHub Pages root (`main /`, legacy source) — <https://wingbangboozle1-lang.github.io/Trade1/>
**Data source:** official Kalshi **demo** REST API — `https://external-api.demo.kalshi.co/trade-api/v2` (recommended host) and `https://demo-api.kalshi.co/trade-api/v2` (also supported), per [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments). Public, unauthenticated, read-only; the demo environment is mock funds per [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env).

---

## 1. What was built

A live, interactive monitoring and paper-trading dashboard for the Kalshi **demo** exchange, restricted to five topics: **gas prices, elections, culture, crypto, golf** only.

| Requirement | Delivered (root site) |
|---|---|
| Track highest-dollar live events in the five topics | `dashboard.html` + per-topic pages (`topics/*.html`) rank events by highest **estimated traded dollars** (total contracts × last price, computed from official `/markets` fields; labeled an estimate — no official per-market dollar-notional field exists), ties broken by estimated 24h dollars. Categories are kept separate per topic; the table also shows est. 24h $, and every row links the exact official `GET /markets?tickers=…` response it came from. |
| Live alerting on swings ≥ $0.10 either direction | Sampled price moves are compared in whole 1/10000-dollar units, so an exact $0.10 move can never be lost to binary-float error (0.66 − 0.56 = 0.09999999999999998). A 45-second per-market cooldown stops oscillation flooding the feed. Two scrolling chats: **“All events”** and **“Model picks”** (heuristic ROI score ≥ 0.45), both auto-scrolling with timestamps, direction, topic pills, price path, volume, and links. |
| Track events until resolution, yes/no | Watched markets are re-checked on every poll; when the exchange settles one, the official `result` (`yes`/`no`) and settlement timestamp are recorded and shown. Paper positions settle at $1 per winning contract. Never inferred. |
| Automate simulated trades / strategies | Four paper strategies (momentum, fade, harvest, breakout) run automatically against live demo quotes with the official taker fee applied; per-strategy and per-topic P&L. `trades.html` (Strategy Lab). |
| Portfolio performance | Paper equity, cash, mark value, realized P&L, fees, win rate, open positions, closed-trade log, equity curve — **local only (localStorage)**. |
| Interactive price graphs | Canvas chart, X = time with **60 s / 5 m / 15 m / 1 h / 6 h / 24 h** windows, Y = contract price ($0.00–$1.00). Seconds/minutes use live samples; hour+ merges official 1-minute / 60-minute candlesticks. ≥ $0.10 alert markers are plotted on the line and the latest jump in the window is linked below the chart. |
| Liquidity / contracts at price | Official order-book ladders (`GET /markets/{ticker}/orderbook?depth=10`): YES bid/ask and NO bid/ask with **contracts available at each price**, depth bars and computed bid-side liquidity. Bids are exchange-published; asks are derived by the official reciprocal rule and marked with an asterisk. |
| Events + links that may have caused jumps | Every alert links the official Kalshi market page, the event's official `settlement_sources`, and a news search labeled “lead”. **Causality is never asserted.** |
| Suggestions for more liveness | `suggestions.html` — what is already live, a prioritized backlog where every row names the official endpoint it would use (trade tape, batch order books, `with_nested_markets`, server-side capture, WebSocket…), continuous-organization rules, and a one-page trader's playbook. |
| GitHub Pages site, category subpages, tables with sources | Landing page + 5 topic subpages + dashboard / Strategy Lab / Data / Methods / Ideas / Flagged / Sources; every committed table row carries the official request URL that produced it, and values that could not be confirmed are left **blank and flagged**. |
| Verification policy | Values confirmed from official sources only; unconfirmed values left **blank and flagged**; never inferred. Full log in [`REVIEW.md`](REVIEW.md) and on the site's Flagged page. |
| Parallel-session coordination | `COORDINATION.md` task board (claim, scope, verification, sources, irregularities); each session on its own branch; small frequent commits; `git pull --rebase` before push. |
| PR → merge → Pages deploy | Executed without waiting for review; the PR link, merge commit and deploy confirmation are recorded in `COORDINATION.md`. |

---

## 2. Verification highlights (all from official sources, 2026-11-20)

- **Endpoints & schemas verified live:** `/exchange/status` (exchange/trading active), `/events?status=open` (`limit` max **200** — `limit=1000` → 400), `/markets` (+ `tickers` / `event_ticker` / `series_ticker` filters; with `tickers` as the only filter every match returns in one response with an empty cursor), `/series/{ticker}`, `/series?category=`/`?tags=`/`?include_volume=`, `/markets/{ticker}/orderbook?depth=`, `/markets/trades?ticker=`, `/markets/orderbooks?tickers=`, `/series/{s}/markets/{t}/candlesticks` (periods 1/60/1440, `start_ts`/`end_ts` in seconds, ≤ 5,000 periods). Request URLs are recorded per value in `data/log.md` and per row in `data/topics/*.json`.
- **Docs verified:** demo environment hosts; market status filter (`unopened/open/closed/settled`); order-book shape (bids only, `[price, qty]` ascending with the best bid **last**, YES ↔ NO reciprocity, `depth` = best 1–100 levels); fixed-point strings (`_dollars` ≤ 4 dp, `_fp` ≤ 2 dp, `price_ranges` as the price grid); series filters (`category`, `tags`, `include_volume` — and **no** `limit` parameter, so the `limit` we send is ignored); **WebSocket requires an authenticated handshake** → REST polling from static pages; unauthenticated rate limits unpublished → conservative throttling and back-off on 429.
- **Fees verified** from the official schedule PDF (`kalshi.com/docs/kalshi-fee-schedule.pdf`, effective 2026-07-07): taker `fees = round up(M × 0.07 × C × P × (1−P))`, maker `round up(M × 0.0175 × C × P × (1−P))`, **no settlement fee**. The paper broker reproduces **every published row** of the schedule's General Trading Fees Table (21 price points × 1 and × 100 contracts) — and the check found a real bug: the naive float expression returned **$1.76** for 100 contracts @ $0.50 where the official table says **$1.75**. The fee function now computes in integer arithmetic and is locked by an automated test.
- **Per-series fee structure read from the API:** every in-scope series checked reports `fee_type: "quadratic"`, `fee_multiplier: 1` (`KXAAAGASM`, `KXBTCY`, `KXETHY`, `KXPGATOUR`, `KXOSCARPIC`, `KXPRESNOMD`) — exactly the general taker rule the model applies. The PDF's per-series override table differs for some of these series (production values), which is flagged.
- **Topic coverage on demo:** crypto (`KXBTCD`, `KXETHD` — CF Benchmarks), golf (`/series?tags=Golf` → PGA/LPGA series; Trump golf-club markets excluded via `exclude_categories: Politics/Elections`), gas (`KXGAS` EIA; `KXAAAGASM` AAA), elections (category + ticker prefixes), culture (category exists; only a handful of demo series, many zero-volume).
- **CORS** (`data/cors.json`, probed from a GitHub-hosted runner): both demo hosts echo any request `Origin` and the preflight returns 204 — this is what makes the browser-side live mode possible.

---

## 3. Key findings & flagged irregularities (full list with links on the [Flagged for Review](flagged.html) page)

1. Demo returns market `status: "active"` (open) / `"finalized"` (settled) although the documented set is `unopened/open/closed/settled` — both spellings are handled, and the difference is flagged.
2. `GET /events?limit=1000` is rejected with 400; the engine pages at 200.
3. The legacy candlestick path `/markets/{t}/candlesticks` is not served; the documented path is the series-scoped one. Verified live both ways.
4. Some demo `settlement_sources` contain template placeholder URLs — shown as-is, never treated as authoritative.
5. `KXGAS` ("Gas weekly") exists but has **zero events** on demo; many hourly/daily demo series are thin — empty tables are genuine exchange states, not missing data.
6. No official per-event dollar-volume field → dollar ranking is an **estimate**, labeled everywhere; contract counts at price come from the official order-book sizes.
7. Maker fees are not modeled (paper fills assume immediately-matched orders).
8. The ROI screen's weights are documented engineering choices, **not** verified alpha — the model chat is a shortlist, not a signal.
9. News attribution: each alert links the official market page, the event's settlement sources and a labeled news-search lead. Causality is never claimed.
10. WebSocket is unusable from a static page → REST polling with the documented multi-second cache lag; sub-second swings are invisible.
11. A real demo-account portfolio requires user API keys, which the site deliberately never requests — the paper portfolio is local-only.
12. Topic matching is heuristic; `scripts/topics.json` (authoritative for the snapshots) and `assets/model.js → TOPICS` (live matching) are mirrored by hand — a sync hazard, now covered by an automated mirror test.

---

## 4. Data quality observations for traders

- Demo liquidity concentrates in long-dated political markets; most hourly/daily markets are thin — check the order-book ladder before trusting any alert.
- $0.10 swings occur most plausibly around settlement windows and thin-book prints.
- The two-feed design separates **facts** (observed/exchange-reported moves, each with an API link) from **opinion** (model picks, labeled heuristic screen).

---

## 5. Risks & limitations

- Observation happens only while a page is open (no server-side capture yet — backlog item #8 on the Ideas page); localStorage persistence is per-browser.
- Simulated fills assume execution at observed quotes with no slippage; real resting orders may not fill the same way.
- Demo behavior need not match production (per Kalshi's official documentation).
- Everything here is educational; **nothing is financial advice**. Demo environment only (play money).

---

## Addendum — independent re-verification (session `777927dd`, 2026-11-20)

**Scope:** the published site only (repository root as served by GitHub Pages). Every claim was checked against an official Kalshi source or a live demo response; defects are listed with links on `flagged.html` §17–21 and in `REVIEW.md`.

**Live check.** All pages were booted in a headless DOM (`tools/render_test.mjs`, jsdom) against the demo API: `index`; `dashboard` (121 ranked rows, chart canvas, live `/markets?tickers=…` and `/events` calls); `data` (178 rows, 396 official source links); and the rest — with **zero JavaScript errors**. Pages built on ES modules (`live.html`, `resolved.html`, `strategies.html`) cannot run in that harness, so their import graph is verified statically in CI.

**Fixed in this pass**
1. Paper fees disagreed with the official fee table in 7 of 42 published rows (float ceiling: $1.76 vs $1.75 at 100 contracts × $0.50). Every row is now asserted in CI by `scripts/test_fees.mjs`.
2. Long chart windows could render empty because candles with no trades carry `price.close_dollars: null`; the chart now falls back to the official YES bid, then YES ask, close.
3. Kalshi deep links used a URL shape that does not resolve; links now use the series page and are labelled as such.
4. The link checker skipped the main pages (and the new `suggestions.html`); it now covers every published root page, fails on an unlisted one, and validates ES-module imports.
5. The dashboard builds had no link between them; navigation now cross-links.
6. All five topic pages rendered blank: the topic id was read through a `location.search` match group, so `"golf"` became `"o"` and the dashboard mount threw. The id is now read directly and normalised; every topic page renders 81–121 rows in the render test that now gates CI.


**Corrected claim.** The 200-item `/events` cap is documented in the pagination guide; Flag 2 now says so.

**Unchanged open items.** No real demo-account portfolio or order execution (requires credentials, excluded by the brief); maker fees and per-series multipliers unmodelled; dollar figures are estimates; alerts sampled at ~12 s over a cached REST API; ROI score is a heuristic, not alpha.
