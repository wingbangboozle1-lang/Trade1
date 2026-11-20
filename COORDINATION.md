# COORDINATION.md — Shared Task Board (Trade1 / Kalshi Demo)

This file is the shared coordination board for all agent sessions working on this repo.
Read it before starting work. Claim tasks by writing your session ID and file scope,
then commit and push the claim immediately.

**Shared-task-board rule:** statuses are `unclaimed`, `in progress`, `done`, `needs review`.
`needs review` items are published on the site's **Flagged for Review** page and do not block anything.
Shared outputs (site `index.html` navigation, shared table data files) are changed only by the
final integration session.

---

## Session registry

| Session ID | Branch | Scope | Status |
|---|---|---|---|
| `sess-a1-9a0ad587` | `arena/9a0ad587-trade1` (Arena-managed session branch; Arena requires all work on this branch, so it is used in place of `session-<id>/<task>`) | Full build for this task: coordination board, docs, dashboard site, strategy engine, verification, PR/merge/Pages integration | in progress |

Note: Arena tracks this session by its branch; the platform forbids creating/pushing other
branches from this session. Therefore this session does the work **and** the final integration
on `arena/9a0ad587-trade1`, and opens/merges the PR to `main` from it. Any other session should
claim unclaimed items below on its own branch.

## Task board

| # | Task | Owner | Files touched | Status |
|---|---|---|---|---|
| 1 | Coordination board setup | sess-a1-9a0ad587 | `COORDINATION.md` | in progress |
| 2 | Kalshi demo API verification (endpoints, fields, rate limits, fees) from official sources | sess-a1-9a0ad587 | `docs/API_NOTES.md`, `docs/SOURCES.md` | in progress |
| 3 | Executive summary | sess-a1-9a0ad587 | `docs/EXECUTIVE_SUMMARY.md`, `site/index.html` | in progress |
| 4 | Dashboard site framework (landing + topic subpages: gas, elections, culture, crypto, golf) | sess-a1-9a0ad587 | `site/**` | in progress |
| 5 | Live price/liquidity tracking + charts (sec/min/hour granularity, orderbook depth) | sess-a1-9a0ad587 | `site/js/**`, `site/topics/*.html` | in progress |
| 6 | Jump detector (≥ $0.10 moves) with cause/news links | sess-a1-9a0ad587 | `site/js/jumps.js` | in progress |
| 7 | Paper strategy engine + portfolio performance tracking | sess-a1-9a0ad587 | `site/js/engine.js`, `site/strategies.html` | in progress |
| 8 | Resolution tracker (live events until resolved yes/no) | sess-a1-9a0ad587 | `site/js/engine.js`, `site/js/store.js` | in progress |
| 9 | Flagged-for-review page + irregularity log | sess-a1-9a0ad587 | `docs/FLAGGED.md`, `site/flagged.html` | in progress |
| 10 | Suggestions page (making the site more live/interactive) | sess-a1-9a0ad587 | `site/suggestions.html` | in progress |
| 11 | GitHub Pages workflow + PR to main + merge + deploy verification (final integration) | sess-a1-9a0ad587 | `.github/workflows/deploy-pages.yml`, PR to `main` | in progress |
| 12 | README (repo overview, quick links) | sess-a1-9a0ad587 | `README.md` | in progress |

## Environment constraints discovered (affects all sessions)

- The build sandbox can only reach `github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`,
  `files.pythonhosted.org`, `codeload.github.com`. It **cannot** reach `*.kalshi.co` directly.
  Therefore: (a) API verification is done via Arena page-fetch of official sources + live demo API,
  (b) the dashboard fetches Kalshi **client-side** (browser → demo API), never server-side.
- Kalshi WebSocket (`wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`) requires signed API-key
  authentication per official docs; the dashboard therefore uses authenticated-free REST polling.

## Verification log (append per task; link official sources)

### Task 2 — API verification (sess-a1-9a0ad587, 2026-11-20)
Official sources checked (fetched and read this session):
- https://docs.kalshi.com/getting_started/demo_env.md — demo REST root `https://external-api.demo.kalshi.co/trade-api/v2`, WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`; mock funds; behavior may differ from production.
- https://docs.kalshi.com/getting_started/quick_start_market_data.md — public no-auth endpoints (series/events/markets/orderbook), browser `fetch` examples, orderbook `orderbook_fp.{yes,no}_dollars` format `[price_dollars, count_fp]` ascending, best bid last.
- https://docs.kalshi.com/api-reference/market/get-markets.md — status filter values `unopened|open|closed|settled`, cursor pagination, responses cached briefly (lag seconds).
- https://docs.kalshi.com/api-reference/market/get-series-list.md — `GET /series?category=&tags=`; series fields incl. `fee_type`, `fee_multiplier`, `contract_terms_url`, `settlement_sources`.
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md — `period_interval` ∈ {1, 60, 1440} minutes; max 5,000 periods/request; OHLC in dollars.
- https://docs.kalshi.com/api-reference/market/get-market-orderbook.md — depth 0–100; yes-bid @ X == no-ask @ (100−X).
- https://docs.kalshi.com/api-reference/market/get-trades.md — `/markets/trades?ticker=&limit=` (1–1000); trade fields `count_fp`, `yes_price_dollars`, `taker_outcome_side`.
- https://docs.kalshi.com/getting_started/rate_limits.md — token buckets; default cost 10 tokens; unauthenticated requests have separate limits; back off on 429.
- https://docs.kalshi.com/getting_started/market_settlement.md — YES outcome pays $1/contract to YES holders; NO outcome pays $1/contract to NO holders; no settlement fee.
- https://kalshi.com/docs/kalshi-fee-schedule.pdf — taker fee `roundup(M × 0.07 × C × P × (1−P))`; maker fee multiplier default 0; no settlement fee. (Effective July 7, 2026.)
Live demo API probes (fetched this session, official Kalshi demo host):
- `GET /events?limit=5&status=open` → event fields verified (category, event_ticker, series_ticker, title, sub_title, settlement_sources).
- `GET /series/KXGAS` → "Gas weekly" exists; category Economics; settlement source U.S. EIA (eia.gov); fee_type quadratic.
- `GET /series/KXETH` → "Ethereum range" exists; category Crypto; settles on CF Benchmarks ETHUSD_RTI.
- `GET /series/KXTIME` → "TIME's Person of the Year" exists; category Entertainment.
- `GET /series/KXPGA`, `GET /series/KXMASTERS` → golf series exist; tags ["Golf"], category Sports.
- `GET /markets?series_ticker=KXBTC&status=open` → market fields verified (prices as `*_dollars` strings, sizes `*_fp`, open_interest_fp, volume_24h_fp, rules_primary/secondary, strike fields).
- `GET /markets?series_ticker=KXBTC&status=settled` → settled market shows `result: "no"`, `status: "finalized"`, `settlement_ts`, `settlement_value_dollars`.

### Task 11 — Integration log
(append PR number, merge result, Pages URL when done)

## Handoff / takeover log
(none yet)
