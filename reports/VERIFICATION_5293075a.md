# Verification report — session `arena/5293075a-trade1` (2026-11-21 UTC)

Independent line-by-line verification of the deployed root site (https://wingbangboozle1-lang.github.io/Trade1/)
against official Kalshi sources, plus a brief-coverage gap review, validator run, and pipeline health check.

Branch: `arena/5293075a-trade1` (base `main` @ `2acfa8e`, repeatedly merged with `origin/main` during the session).
The build sandbox has **no network route to `*.kalshi.co`** (TLS reset, verified) — official docs and the live site
were read through the page fetcher; CI runners perform the real API collection.

---

## 1. Official sources re-read this session (all fetched 2026-11-21 UTC)

| # | Source | URL | What was checked |
|---|---|---|---|
| S1 | API Environments and Endpoints | https://docs.kalshi.com/getting_started/api_environments | Demo REST bases `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2` (also supported); demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2` — **match the brief's endpoint list and `data/meta.json` `base`/`alt_base` exactly** |
| S2 | Market Lifecycle | https://docs.kalshi.com/getting_started/market_lifecycle | REST statuses `initialized / active / inactive / closed / determined / disputed / amended / finalized`; filter mapping `unopened→initialized`, `open→active`, `paused→inactive`, `settled→finalized`; `result` ∈ {yes, no, scalar}; settled markets end at `finalized` with `settlement_ts` |
| S3 | Get Markets | https://docs.kalshi.com/api-reference/market/get-markets | `status` filter values; full Market schema (incl. `yes_bid_dollars`, `yes_ask_dollars`, `yes_bid_size_fp`, `volume_fp`, `volume_24h_fp`, `previous_price_dollars`, `last_price_dollars`, `result`, `settlement_ts`, `settlement_value_dollars`, `price_level_structure`, `notional_value_dollars`, `open_interest_fp`) — all fields the site renders/collects are in the official schema |
| S4 | Get Events | https://docs.kalshi.com/api-reference/events/get-events | Example `limit=200` (the site pages at 200); Event schema incl. `settlement_sources[{name,url}]`, nested `markets[]`, `category` |
| S5 | Get Market Candlesticks | https://docs.kalshi.com/api-reference/market/get-market-candlesticks | Series-scoped path `/series/{series_ticker}/markets/{ticker}/candlesticks`; `period_interval` ∈ {1, 60, 1440} only; `start_ts`/`end_ts` required |
| S6 | Market Settlement | https://docs.kalshi.com/getting_started/market_settlement | $1 per contract to the winning side; **settlement fees zero** for simple yes/no; payout rounded to whole cents |
| S7 | Fee schedule PDF (effective July 7, 2026) | https://kalshi.com/docs/kalshi-fee-schedule.pdf | Taker `round up(M × 0.07 × C × P × (1−P))`, default M = 1; maker `round up(M × 0.0175 × C × P × (1−P))`, default M = 0; "There is no settlement fee."; full General Trading Fees Table (21 rows); Non-Standard Fees per-series table (both pages, incl. garbled-OCR block) |
| S8 | Orderbook Responses | https://docs.kalshi.com/getting_started/orderbook_responses | `orderbook_fp.{yes_dollars,no_dollars}` arrays of `[price_dollars, count_fp]`; ascending order, **best bid last**; bids only; reciprocal YES↔NO ask rule; `depth` parameter; unknown ticker → 200 with empty arrays |

## 2. Line-by-line claim checks (site claim → source → result)

| # | Claim as published on the site | Verified against | Result |
|---|---|---|---|
| C1 | Demo REST base `external-api.demo.kalshi.co`, alt `demo-api.kalshi.co` (`data/meta.json`, landing page) | S1 | **Verified** — recommended + also-supported hosts match |
| C2 | Markets are `active` while open; settled rows show `finalized` + `result` yes/no (dashboard, resolved page) | S2 | **Verified** — documented statuses and filter mapping |
| C3 | Watchlist polls `GET /markets?tickers=…` (single response) and `GET /events?status=open&limit=200` | S3, S4 | **Verified** — `limit=200` is the documented example/max; `tickers` documented on Get Markets |
| C4 | Chart windows: 60 s / 5 m / 15 m from the official trade tape; 1 h / 6 h / 24 h from candlesticks `period_interval` 1 or 60 | S5, Get Trades | **Verified** — `period_interval` accepts only 1/60/1440; the engine never sends 0 (`assets/app.js` WINDOWS table; `tests/engine.test.mjs` asserts it) |
| C5 | Order-book ladder: bids only, best bid last, asks derived by the reciprocal rule, `?depth=` levels per side | S8 | **Verified** |
| C6 | Settlement pays $1 per winning contract; no settlement fee | S6 | **Verified** |
| C7 | Paper taker fee `roundup(0.07 × C × P × (1−P))`; 100 contracts @ $0.50 → **$1.75**; per-series multipliers from the schedule (KXBTCY/KXETHY M=0, KXAAAGASM/KXPGATOUR M=1 …) | S7 | **Verified** — reproduces all 21 published table rows × {1,100} contracts (`scripts/test_fees.mjs`, 50/50) |
| C8 | Alert threshold is an exact ≥ $0.10 move, compared in whole 1/10000-dollar units | S3 (4-dp `_dollars` strings) | **Verified** — `assets/model.js alertMove()`; locked by `tests/root_engine.test.js` |
| C9 | "Est. traded $" columns are labeled estimates; no exchange-published per-market dollar notional | S3 schema (no such field) | **Verified** — the official Market schema contains no traded-dollar field; the label is honest |
| C10 | Every snapshot/resolved row links its exact official API URL | S3, S4 | **Verified** — `scripts/check_site.mjs`: 1,248 rows + 825 resolved rows, **0 failures**, 441 links checked |
| C11 | CORS: demo API reflects any browser origin (`data/cors.json`) | probe artifact (GitHub-runner, 2026-11-20) | **Carried as published** — not re-probed this session (sandbox cannot reach Kalshi); artifact recorded verbatim |
| C12 | WebSocket not used by the site (signed handshake headers not attachable from a browser) | S1 (dedicated WS hosts exist) + Quick Start: WebSockets (signed headers, carried from prior sessions) | **Consistent** — REST polling is the disclosed design |

### Fee transcription line-by-line audit (`data/fee_schedule_series.json`)

Every row of the file's `series` map with `seen_in: fee-schedule-pdf` was re-read against S7 this session:
KXAAAGASM 1/1, KXATPMATCH 1/1, KXBALLONDOR 1/1, KXBTCMAX150 1/1, KXBTCY 0/0, KXCITRINI 0/0, KXCPI 1/1,
KXCPIYOY 1/1, KXDOED 0/0, KXEGGS 1/1, KXELECTIRAN 0/0, all six KXEMMY* 1/1, KXETHY 0/0, KXFED 1/1,
KXFEDDECISION 1/1, KXGAMBLINGREPEAL 0/0, KXGDP 1/1, KXGREENLAND 0/0, KXHEISMAN 1/1, KXINXY 1/1, KXIPO 1/1,
KXIRANDEMOCRACY 0/0, KXLALIGA 1/1, KXLAYOFFSYINFO 0/0, KXLLM1 1/1, KXPAHLAVIHEAD 0/0, KXPAYROLLS 1/1,
KXPGARYDER 1/1, KXPGASOLHEIM 1/1, KXPGATOUR 1/1, KXRATECUTCOUNT 1/1, KXSB 1/1, KXSUPERBOWLHEADLINE 1/1,
KXU3 1/1, KXUCL 1/1, KXUCLGAME 1/1, KXWCGAME 1/1, KXWNBA 1/1, KXWNBAGAME 1/1, KXWTAMATCH 1/1 —
**41/41 match; no discrepancy.** The OCR-garbled middle block stays under `not_transcribed` (default M = 1,
which equals the legible taker values for those rows) — the conservative choice, unchanged.

## 3. Pipeline health (checked live this session)

- **Verified snapshot pipeline (`pages.yml`, cron `17 */3`):** the dispatch run on `main` started
  `07:17:44Z`, completed, and pushed `data: verified snapshot 2026-11-21T07:22:51Z [skip ci]` (commit `2ba763f`).
  `data/collect_status.json` on `main`: `status: "ok"`, `transient_read_failures: 0`, `kept_previous_artifacts: []`.
  `data/log.md` of that run: 504 requests, 0 retried, 0 throttled 429, 0 failed; 13 files published
  (elections 252 kB, crypto 252 kB, culture 242 kB, golf 169 kB, gas-prices 81 kB, resolved 229 kB).
  *Note:* earlier in this session the data appeared stale (03:59:57Z restore) only because the in-flight run had
  not pushed yet — first real confirmation that the fail-closed collector (PR #80/#81) works against the live API.
- **CI ledger (`portfolio.yml`):** `data/portfolio.json` refreshed `2026-11-21T07:28:04Z` on `main`.
- **Pages:** `gh api …/pages` → `status: built`, `build_type: legacy`, source `main /`, HTTPS enforced.
- **Cancelled runs:** many `cancelled` conclusions are the documented `concurrency` behaviour
  (`group: site-data-${{ github.ref }}`, `cancel-in-progress: false` → a *pending* run is replaced when a newer
  run queues). Completed runs are the ones that matter; the 07:22:51Z snapshot proves completion.

## 4. Brief-coverage gap review (independently confirmed on this branch)

| Brief requirement | Status | Where confirmed |
|---|---|---|
| Executive summary | delivered | `EXECUTIVE_SUMMARY.md`, `executive-summary.html` |
| Highest-$ live events, five topics only (gas, elections, culture, crypto, golf) | delivered | `dashboard.html`, `topics/{gas-prices,elections,culture,crypto,golf}.html`; `scripts/topics.json` + `assets/model.js` mirrors |
| ≥ $0.10 swing alerts, either direction | delivered | integer-cent `alertMove()`; `tests/root_engine.test.js` |
| Two scrolling chats: all events + high-ROI model filter | delivered | `kx-chat-all` / `kx-chat-model` in `assets/app.js`; Methods §3 |
| Track live events until resolved YES/NO | delivered | `resolved.html` + engine (`determined`/`amended` handling, `tests/live_fixes.test.mjs`) |
| Automated simulated trades / strategies | delivered | 4 strategies in `assets/model.js`, `trades.html`, `scripts/portfolio_engine.py` |
| Portfolio performance (demo account) | delivered (paper layers; real account key-gated) | `portfolio.html` + CI ledger; `demo-account/` console — credentials never requested (flagged) |
| Analyze/categorize trades by type, build strategies | delivered | `portfolio.html` per-strategy × per-topic tables; Methods §4 |
| Live interactive price graph, X = time (s/m/h), Y = price | delivered | `assets/app.js` WINDOWS: 60s/5m/15m/60m/6h/24h |
| Liquidity: contracts available at a given price | delivered | order-book ladder with `?depth=` (`assets/app.js` bookPollMs 8 s) |
| Jump links (market / settlement sources / news lead) | delivered | chart markers + jump strip; causality never claimed (flagged as leads) |
| Suggestions for liveness/interactivity | delivered | `suggestions.html` |
| GitHub Pages site, landing + category subpages, tables with sources | delivered | https://wingbangboozle1-lang.github.io/Trade1/ (`status: built`) |
| Verification, blanks never inferred, Flagged page | delivered | `flagged.html` (68 rows), `sources.html`, `methods.html` |

**No coverage gap found that blocks the brief.** Remaining limitations are all published on `flagged.html`
(demo-account keys = owner action; maker fees unmodeled; ROI screen is a disclosed heuristic; news links are
labeled leads; dollar volume is an estimate; no browser WebSocket; REST caching lag).

## 5. Validator results (merged tree, this session, all exit 0)

| Gate | Result |
|---|---|
| `npm run check` (`tools/build.mjs` + `check_site.mjs` + `check_links.mjs`) | BUILD OK 18 HTML / 6 JS / 0 broken links; 441 links, **1,248 rows, 825 resolved, 0 failures**; 16 pages, 409 local + 249 external links, 0 failures |
| `npm test` | engine 23/23 · live_fixes 3/3 · live_dash 6/6 · lib · model 36 · root_engine 48/48 · model.test 21/21 · fees · portfolio 60/60 · demo-account 89/89 · `test_collect.py` OK |
| `python3 tests/test_collect_failclosed.py` | 6/6 OK |
| `python3 scripts/portfolio_engine.py selftest` | 77/77 |
| `node tools/render_test.mjs --offline` | exit 0 (16 pages, 0 JS errors) |

## 6. Repo / coordination review (irregularities)

| # | Finding | Disposition |
|---|---|---|
| I1 | The claim base `2acfa8e` (PR #81 merge) contained **committed conflict markers** in `COORDINATION.md` (lines 1359–1450) | Already repaired on `main` by session `1c5b46b2` (PR #82, `33e5621`); this branch merged `main` and carries no markers. Every merge conflict during this session was resolved **additively** (both sides' records kept; only the three delimiter lines dropped) |
| I2 | Apparent data staleness (03:59:57Z) during the session | **Not a defect** — an in-flight snapshot run pushed at 07:22:51Z; `collect_status: ok, 0 failures`. Verified in §3 |
| I3 | Sandbox cannot download Actions run logs (`results-receiver.actions.githubusercontent.com` is outside the egress allowlist) — CI step evidence must be inferred from artifacts (`data/*`) and the runs API | Recorded for future sessions; artifacts were sufficient here |
| I4 | GitHub REST quota (5,000/h, shared across parallel sessions) was exhausted mid-session (0 remaining until reset) | Transient; waited for reset, resumed; no verification step skipped |
| I5 | Local clone is **shallow** at `2acfa8e` — parent history before the claim base is not inspectable locally (`2acfa8e~1` fails) | Worked around by fetching `origin/main` refs; no claim depends on pre-base history |
| I6 | 8 open PRs at close time (#75, #84, #85, #90, #95, #103, #104, #105) — all updated within minutes, all active | **None stale (>60 min), none taken over**, none edited by this session |
| I7 | Carried-forward flagged items (6b/691-1 fee-source conflict, maker fees, ROI heuristic, demo keys, news leads, estimated dollar volume, AA-8) | Unchanged; published on `flagged.html`; non-blocking |

## 7. Not verified (no inference made)

- **Live Kalshi API values from this sandbox** — no route to `*.kalshi.co`; runtime behaviour was checked against
  the committed official-response samples (`data/samples/`), the fresh CI snapshot artifacts, and the docs.
- **Authenticated demo-account balance/orders** — no credentials provided; the key-gated console stays inert by
  design; nothing was faked (flagged).
- **CORS headers re-probed this session** — the recorded probe artifact (`data/cors.json`, GitHub-runner origin
  reflection) is carried as published, not re-claimed as re-verified.

*Read dates: all sources above fetched 2026-11-21 UTC. No value in this report was inferred or filled in.*
