# Executive Summary — Kalshi Demo Monitor

**Date:** 2026-11-20 · **Repo:** `wingbangboozle1-lang/Trade1` · **Site:** GitHub Pages (`site/`) · **Data source:** official Kalshi demo REST API `https://external-api.demo.kalshi.co/trade-api/v2` (public endpoints only)

## 1. What was built

A live, interactive monitoring and strategy-testing dashboard for the Kalshi **demo** exchange (mock-funds environment, per [official demo documentation](https://docs.kalshi.com/getting_started/demo_env)), restricted to five topics: **gas prices, elections, culture, crypto, golf**.

| Requirement | Delivered |
|---|---|
| Track highest-dollar live events in the five topics | Live ranking by estimated traded dollars (Σ volume × last price) and estimated OI dollars, computed client-side from official `/markets` data; per-topic pages keep categories separate |
| Live alerting on swings ≥ $0.10 either direction | Watcher rotates top events every ~2.5 s; alerts fire on (a) moves between consecutive observations and (b) exchange-reported `previous_price → last_price` moves; integer-cent comparison avoids float misses; 45 s per-market cooldown damps oscillation |
| Two scrolling chats | "All events" feed + "Model likes" feed (heuristic score ≥ 0.62 and fee-adjusted est. ROI ≥ 5%); both auto-scroll with timestamps, direction, topic pills, and links |
| Track events until resolution, yes/no | Tracked events re-checked against `status=settled` listings; the official `result` field is copied verbatim into an archive (per-topic and global pages); never inferred |
| Automate simulated trades / strategies | Four paper strategies (Momentum Rider, Fade the Spike, Extreme Value, Liquidity Scalper) run automatically against observed top-of-book; official fee math; per-strategy and per-topic P&L analytics |
| Portfolio performance | Paper equity, cash, mark value, realized P&L, fees, win rates, open positions, closed-trade log, equity curve — local only |
| Interactive price graphs | Canvas chart, X = time with **60 s / 5 m / 15 m / 1 h / 6 h / 24 h** windows, Y = contract price; short windows use live samples, long windows add official 1-minute candlesticks; alert markers plotted |
| Liquidity / contracts at price | Official orderbook ladder (`/markets/{ticker}/orderbook`): YES bids and NO bids with contracts at each price, implied opposite-side asks, depth totals, spread, OI |
| Events + links that may have caused jumps | Every alert links the official API response, the event data, demo.kalshi.co, and a news-search link **labeled unverified** — causation is never asserted |
| Suggestions for more liveness | Findings page includes a trader's playbook; the site itself is fully auto-running (no manual input) |
| GitHub Pages site, category subpages, tables with sources | Landing page + 5 topic subpages + strategies/findings/resolved/flagged pages; every committed table row carries the official request URL or doc link that produced it |
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

---

# Addendum — session `e82d36a3`, 2026-11-20 (deployed root site)

**Scope of this addendum.** The section above was written by session `f6094c46` about its `monitor/` build. This addendum
describes the **published root site** (`https://wingbangboozle1-lang.github.io/Trade1/`, Pages source = `main` `/`) as of
2026-11-20 and what this session changed. Nothing above was deleted or rewritten.

## What is live now

| Brief requirement | State on the published site |
|---|---|
| Highest-dollar live events, five topics | Landing + `dashboard.html` + five `topics/*.html` pages, ranked by estimated 24 h traded dollars; the estimate is labelled as such (no per-market dollar field is published) |
| Alerting on ≥ $0.10 swings, both directions | Two auto-scrolling chats (all events / ROI-screen picks) sampled every ~12 s while a tab is open; the ≥ $0.10 test is done on integer 1e-4 USD units, so an exact $0.66→$0.56 move cannot be lost to binary float |
| Chart shows the jumps and the links | **New this session:** each ≥ $0.10 jump for the selected market is drawn on the price chart inside the chosen window, with a jump/link strip underneath (official market page, the event's published settlement sources, a news-search lead — labelled leads, never causes) |
| Track events until resolution (YES/NO) | Watched markets are re-quoted each cycle; `status`/`result`/`settlement_ts` are copied verbatim into the resolution tables; open paper positions settle at $1.00 per winner |
| Automated simulated trades | **New this session:** `scripts/portfolio_engine.py` runs the four documented strategies in GitHub Actions every ~30 min and commits its ledger (`data/portfolio.json`), so the track record accumulates without a browser open and every visitor sees the same numbers (`portfolio.html`) |
| Portfolio performance / categorised analysis | `portfolio.html`: equity curve, open positions marked at the official bid, P&L by strategy, by topic and by exit reason, ROI and win-rate tables, per-row source links. The browser Strategy Lab (`trades.html`) keeps its own per-browser book for fast sampling |
| Live interactive charts, liquidity, depth per price | `dashboard.html`: time-window picker (seconds → hours), order-book ladder with contract counts at each price level |
| Suggestions for more liveness | **New this session:** `suggestions.html` — 10 static-site quick wins, 3 items that need a small server, 2 that need the owner's demo key, each tied to the published endpoint or doc page that makes it possible |
| No manual input | Everything above runs from schedules and public endpoints; no credentials, no forms, no key entry |

## Important details a trader should know

1. **The demo environment is explicitly not representative.** Kalshi's own wording: "The price and behavior of markets in the
   demo environment may not be reflective of those in real markets"
   ([docs.kalshi.com/getting_started/demo_env](https://docs.kalshi.com/getting_started/demo_env)). All analysis here is methodology, not edge.
2. **REST polling lags by design.** Responses are cached by the exchange for a short time, so prices, sizes and `status` can lag by
   seconds and filtered listings can lag longer ([Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)). Sub-second
   swings are not observable; that is a platform limit, not a bug in the dashboard.
3. **WebSocket is not available to a static page.** The handshake must carry `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-SIGNATURE` and
   `KALSHI-ACCESS-TIMESTAMP` (signature over `timestamp + "GET" + "/trade-api/ws/v2"`) even for the public market-data channels
   ([Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets)); browsers cannot set WebSocket headers,
   so the site polls REST and `suggestions.html` #11 describes the bridge.
4. **Fees are modelled from the published schedule**, and one previously-flagged item is now resolved: demo `status:"active"` is
   *not* a contradiction — `active` is the documented market status that the `open` filter matches
   ([Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle)). See [flagged.html](flagged.html) E1.
5. **Two fee models coexist on purpose** (6-dp + cent alignment in the CI ledger, cent-rounding in the browser lab) and maker fees
   are not modelled anywhere — material for the gas series, which lists a maker multiplier of 1. See E2/E3.
6. **Dollar figures for traded notional stay estimates.** A measured alternative (the trade tape: `count_fp × yes_price_dollars` per
   execution) is specced in Suggestions #2 but is not implemented, and it cannot be naively back-filled because the endpoint
   documents no ordering guarantee (E7).
7. **Real demo-account tracking is still blocked on the owner.** It needs a demo API key + private key as repository secrets
   ([API Keys](https://docs.kalshi.com/getting_started/api_keys)); session `20e3ad14`'s guarded executor sits unmerged in draft
   [PR #2](https://github.com/wingbangboozle1-lang/Trade1/pull/2). E9.

## Quality gates added this session

- `python3 scripts/portfolio_engine.py selftest` — 50 numeric checks (official fee-table rows, the exact $0.10 boundary,
  balance-alignment arithmetic, settlement payouts, whole-contract sizing, determinism).
- `node tests/portfolio.test.mjs` — 60 checks: artifact contract (every row has a source, alert threshold respected, bounded size)
  plus `portfolio.html` booted in jsdom against both the real artifact and a synthetic populated ledger.
- `node scripts/check_links.mjs` — link and navigation check over all published root pages (17 pages, 0 failures on 2026-11-20);
  added because the pre-existing `scripts/check_site.mjs` allow-list does not include the deployed root pages (E10).
