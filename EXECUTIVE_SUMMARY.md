# Executive Summary — Kalshi Demo Dashboard (root site)

**Date:** 2026-11-20 · **Repo:** `wingbangboozle1-lang/Trade1` · **Site:** GitHub Pages root (`main /`, legacy source, build `50c5ca7` via PR #19) · **Data source:** official Kalshi demo REST API `https://external-api.demo.kalshi.co/trade-api/v2` (public endpoints only; demo is mock-funds, per [official docs](https://docs.kalshi.com/getting_started/demo_env))

## 1. What was built

A live, interactive monitoring and paper-trading dashboard for the Kalshi **demo** exchange, restricted to five topics: **gas prices, elections, culture, crypto, golf** only.

| Requirement | Delivered (root site) |
|---|---|
| Track highest-dollar live events in the five topics | `dashboard.html` + per-topic pages (`topics/*.html`) rank events by highest estimated traded dollars (total contracts × last price, computed client-side from official `/markets` data; labeled an estimate — no official per-market dollar-notional field exists). Categories kept separate per topic. |
| Live alerting on swings ≥ $0.10 either direction | Watcher polls top events; alerts fire on sampled price moves ≥ $0.10 up or down using **integer 1e-4 comparison** (avoids binary-float misses such as 0.66−0.56 = 0.0999…). Two scrolling chats: **"All events"** and **"Model picks"** (heuristic ROI score ≥ 0.45), both auto-scrolling with timestamps, direction, topic pills, and links. |
| Track events until resolution, yes/no | Tracked events re-checked against settled listings; the official `result` field is copied verbatim (`yes`/`no`) into the resolved archive; never inferred. |
| Automate simulated trades / strategies | Four paper strategies (momentum, fade, breakout, harvest) run automatically against live demo quotes; official taker fee math; per-strategy P&L. `trades.html` (Strategy Lab). |
| Portfolio performance | Paper equity, cash, mark value, realized P&L, fees, win rates, open positions, closed-trade log, equity curve — **local only (localStorage)**. |
| Interactive price graphs | Canvas chart, X = time with **60 s / 5 m / 15 m / 1 h / 6 h / 24 h** windows, Y = contract price; ≥$0.10 alert markers plotted on the selected ticker's curve; long windows add official 1-minute candlesticks. |
| Liquidity / contracts at price | Official orderbook ladder (`/markets/{ticker}/orderbook`): YES/NO bids and asks (asks derived via the official YES↔NO reciprocal rule), contracts available at each price, depth bars, spread, bid-side liquidity totals. |
| Events + links that may have caused jumps | Every alert links the official market data, the Kalshi event page, and a news-search link **labeled unverified** — causation is never asserted. |
| Suggestions for more liveness | Flagged page lists liveness suggestions (WS authenticated-handshake constraint → REST polling; subscribe-on-focus; hot-path refresh) labeled as suggestions. |
| GitHub Pages site, category subpages, tables with sources | Landing page + 5 topic subpages + dashboard/trades/data/methods/flagged/sources pages; every committed table row carries the official request URL that produced it. |
| Verification policy | Values confirmed from official sources only; unconfirmed values left **blank and flagged**; never inferred. |
| Parallel-session coordination | `COORDINATION.md` task board (claim/scope/verification/sources/irregularities), single branch `arena/a67aa1ab-trade1`, small frequent commits, `git pull --rebase` before push. |
| PR → merge → Pages deploy | Integration PR merged to `main` without waiting for review; Pages deploy confirmed; PR/merge recorded in `COORDINATION.md`. |

## 2. Verification highlights (all from official sources, 2026-11-20)

- **Endpoints & schemas verified live:** `/exchange/status` (exchange_active/trading_active true), `/events?status=open`, `/markets` (+ status/series filters), `/series`, `/series?category=`/`?tags=`, `/markets/{ticker}/orderbook` (bids-only, `[price_dollars, count_fp]` ascending, YES↔NO duality), `/series/{s}/markets/{t}/candlesticks` (periods 1/60/1440, required start_ts/end_ts/period_interval). Request URLs recorded per value in `data/log.md` and per-row `source_url`s.
- **Docs verified:** demo environment (`external-api.demo.kalshi.co` / `demo-api.kalshi.co`); documented status filter (`unopened/open/closed/settled`); orderbook shape; fixed-point strings (`_dollars` ≤4dp, `_fp` ≤2dp, `price_ranges` source of truth); **WebSocket requires authenticated handshake headers** → REST polling used from static pages; unauthenticated rate limits unpublished → conservative throttling.
- **Fees verified** from the official schedule PDF (`kalshi.com/docs/kalshi-fee-schedule.pdf`, effective 2026-07-07): taker `round_up(M × 0.07 × C × P × (1−P))`, maker 0.0175× (M=0 default on quadratic series), no settlement fee. The paper broker applies the per-series **taker multiplier M** from the schedule's Non-Standard Fees table (default 1; `KXBTCY`/`KXETHY` M=0 → no taker fee), with integer-cent rounding plus a float-epsilon guard so an exact $1.75 does not ceil to $1.76; applied ON by default and unit-tested against the schedule's worked examples.
- **Topic coverage on demo:** crypto (`KXBTCD`, `KXETHD` — CF Benchmarks), golf (`/series?tags=Golf` → PGA/LIV series; Trump golf-club markets excluded via `exclude_categories: Politics/Elections`), gas (`KXGAS` EIA; `KXAAAGASM` AAA), elections (category + ticker prefixes), culture (category exists; exactly 2 demo series, both zero-volume).

## 3. Key findings & flagged irregularities (full list on the Flagged page)

1. Demo returns market `status:"active"` although the documented status set is `unopened/open/closed/settled` — treated as open, flagged.
2. Some demo `settlement_sources` contain template placeholder URLs — shown as-is, never treated as authoritative.
3. `KXGAS` ("Gas weekly") exists but has **zero events** in demo; demo crypto markets showed zero volume on first page — demo data is sparser than production; empty tables are genuine exchange states.
4. Browser↔Kalshi CORS unverifiable from build sandbox → site degrades to verified snapshot with a clear banner; a manual `curl` check is printed (`data/cors.json`). (Later verified via a GitHub-runner probe: demo API reflects any browser origin.)
5. WebSocket unusable from a static page without credentials → REST polling; documented.
6. No official per-event dollar-volume field → dollar ranking is an estimate, labeled everywhere; true traded dollars only from trade-print samples.
7. `previous_price_dollars` semantics (price before the latest trade) inferred from the official schema field name — flagged as an assumption.
8. Real demo-account portfolio/order tracking requires user-created demo API keys — implemented as local simulation instead; the limitation is disclosed, not hidden. **No credentials are requested or stored.**
9. Dollar volume = volume × last price is an estimate (flagged #6); contract counts at price come from the official orderbook sizes.

## 4. Data quality observations for traders

- Demo liquidity concentrates in long-dated political markets; most hourly/daily markets are thin — check the orderbook ladder before trusting any alert.
- $0.10 swings occur most plausibly around settlement windows and thin-book prints; the tape panel provides the evidence trail.
- The two-feed design separates **facts** (observed/exchange-reported moves, with API links) from **opinion** (model picks, labeled heuristic screen).

## 5. Risks & limitations

- Observation only while a page is open (no server-side capture); localStorage persistence is per-browser.
- Simulated fills assume execution at observed quotes; real resting orders may not fill the same way.
- Demo behavior need not match production (per Kalshi's official documentation).
- Everything here is educational; nothing is financial advice.
