# Executive Summary — Kalshi Demo Monitor

**Date:** 2026-11-20 · **Repo:** `wingbangboozle1-lang/Trade1` · **Site:** GitHub Pages root — <https://wingbangboozle1-lang.github.io/Trade1/> (canonical deployment; parallel session builds also serve from `/site/`, `/monitor/`, `/trade1/`, `/a2ec5543/`) · **Data source:** official Kalshi demo REST API `https://external-api.demo.kalshi.co/trade-api/v2` (public endpoints only)

> **Final integration note (session `dacc8b5c`, 2026-11-20):** this summary describes the repo’s delivered feature set. The canonical deployed site at the root implements it with the strategy set *momentum / fade / favorite-harvest / 50¢ breakout* (`assets/model.js`) and chart windows 60 s / 5 m / 15 m / 1 h / 6 h / 24 h; each table row below was re-checked against the official sources linked in [sources.html](https://wingbangboozle1-lang.github.io/Trade1/sources.html) and the line-by-line log in [REVIEW.md](REVIEW.md).

## 1. What was built

A live, interactive monitoring and strategy-testing dashboard for the Kalshi **demo** exchange (mock-funds environment, per [official demo documentation](https://docs.kalshi.com/getting_started/demo_env)), restricted to five topics: **gas prices, elections, culture, crypto, golf**.

| Requirement | Delivered |
|---|---|
| Track highest-dollar live events in the five topics | Live ranking by estimated traded dollars (Σ volume × last price) and estimated OI dollars, computed client-side from official `/markets` data; per-topic pages keep categories separate |
| Live alerting on swings ≥ $0.10 either direction | Watcher rotates top events every ~2.5 s; alerts fire on (a) moves between consecutive observations and (b) exchange-reported `previous_price → last_price` moves; integer-cent comparison avoids float misses; 45 s per-market cooldown damps oscillation |
| Two scrolling chats | "All events" feed + "Model likes" feed (heuristic score ≥ 0.62 and fee-adjusted est. ROI ≥ 5%); both auto-scroll with timestamps, direction, topic pills, and links |
| Track events until resolution, yes/no | Tracked events re-checked against `status=settled` listings; the official `result` field is copied verbatim into an archive (per-topic and global pages); never inferred |
| Automate simulated trades / strategies | Four paper strategies (momentum, fade, favorite-harvest, 50¢ breakout — `assets/model.js`) run automatically against observed top-of-book; official fee math; per-strategy and per-topic P&L analytics |
| Portfolio performance | Paper equity, cash, mark value, realized P&L, fees, win rates, open positions, closed-trade log, equity curve — local only |
| Interactive price graphs | Canvas chart, X = time with **60 s / 5 m / 15 m / 1 h / 6 h / 24 h** windows, Y = contract price; short windows use live samples, long windows add official 1-minute candlesticks; alert markers plotted |
| Liquidity / contracts at price | Official orderbook ladder (`/markets/{ticker}/orderbook`): YES bids and NO bids with contracts at each price, implied opposite-side asks, depth totals, spread, OI |
| Events + links that may have caused jumps | Every alert links the official API response, the event data, demo.kalshi.co, and a news-search link **labeled unverified** — causation is never asserted |
| Suggestions for more liveness | Findings page includes a trader's playbook; the site itself is fully auto-running (no manual input) |
| GitHub Pages site, category subpages, tables with sources | Landing page + live dashboard + Strategy Lab + data/methods/sources/flagged/suggestions pages + 5 topic subpages; every committed table row carries the official request URL or doc link that produced it |
| Verification policy | Values confirmed from official sources only; unconfirmed values left **blank and flagged**; full log in `docs/VERIFICATION.md` and on the site's Flagged page |
| Parallel-session coordination | `COORDINATION.md` task board updated (claim, scope, verification, sources, irregularities); single-branch constraint documented |
| PR → merge → Pages deploy | Executed at the end of this session without waiting for review |

## 2. Verification highlights (all from official sources, 2026-11-20)

- **Endpoints & schemas** verified live: `/events`, `/markets` (+ filters), `/series/{ticker}`, `/series?category=`/`?tags=`, `/markets/{ticker}/orderbook?depth=`, `/markets/trades?ticker=`, `/series/{s}/markets/{t}/candlesticks` — request URLs recorded per value.
- **Docs** verified: demo environment; market status filter (`unopened/open/closed/settled`); orderbook shape ([price, qty] ascending, bids only, YES↔NO duality); candlesticks (1/60/1440-min periods, ≤5,000 periods); trades shape; series-list filters; **WebSocket requires authenticated handshake** (hence REST polling); unauthenticated rate limits unpublished → conservative throttling.
- **Fees** verified from the official schedule PDF (effective 2026-07-07): taker `round_up(0.07 × C × P × (1−P))`, maker 0.0175×(M=0 default on quadratic series), no settlement fee — reproduced by unit tests against the official table's worked examples.
- **Topic coverage on demo**: crypto (`KXBTCD`, `KXETHD` — CF Benchmarks settlement), golf (`/series?tags=Golf` → PGA/LIV series vs PGA Tour/ESPN/Fox/Golf Channel), gas (`KXGAS` EIA, `KXAAAGASM` AAA), elections (category + `KXVPRESNOMR` 1.27M contracts, liquid `KXVPRESNOMR-28-EKIR` market with real bid/ask/volume/OI verified live), culture (category exists; exactly 2 demo series, both zero-volume).

## 3. Key findings & flagged irregularities (full list on the Flagged page)

1. Demo returns market `status:"active"` although the documented status set is `unopened/open/closed/settled` — treated as open, flagged.
2. Some demo `settlement_sources` contain template placeholder URLs (e.g. `google.com/search?q=…`) — shown as-is, never treated as authoritative.
3. `KXGAS` ("Gas weekly") exists but has **zero events** in demo; demo crypto markets on the first page showed zero volume — demo data is sparser than production; empty tables are genuine exchange states.
4. Browser↔Kalshi CORS could not be tested from the build sandbox (egress allowlist); the site degrades to the verified snapshot with a clear banner and prints a manual `curl` check.
5. WebSocket unusable from a static page without credentials → REST polling; documented.
6. No official per-event dollar-volume field exists → dollar ranking is an estimate, labeled everywhere; true traded dollars only from trade-print samples.
7. `previous_price_dollars` semantics (price before the latest trade) inferred from the official schema field name — flagged as an assumption.
8. Real demo-account portfolio/order tracking requires user-created demo API keys — implemented as local simulation instead; the limitation is disclosed, not hidden.

## 4. Data quality observations for traders

- Demo liquidity concentrates in long-dated political markets (e.g. 2028 VP nomination); most hourly/daily markets are thin — check the orderbook ladder before trusting any alert.
- $0.10 swings occur most plausibly around settlement windows and thin-book prints; the tape panel provides the evidence trail.
- The two-feed design separates **facts** (observed/exchange-reported moves, with API links) from **opinion** (model picks, labeled heuristic).

## 5. Risks & limitations

- Observation only while a page is open (no server-side capture); localStorage persistence is per-browser.
- Simulated fills assume execution at observed quotes; real resting orders may not fill the same way.
- Demo behavior need not match production (per Kalshi's official documentation).
- Everything here is educational; nothing is financial advice.
