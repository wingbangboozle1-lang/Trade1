# Repo review — line-by-line verification notes (session `bb8bd1ff`, 2026-11-20)

Scope: every file in this repository. Sources are official (docs.kalshi.com,
kalshi.com, live demo endpoints) and linked inline. Irregularities are flagged
in place and summarized at the bottom; they are also published on the site's
[Flagged for Review page](flagged.html).

## Files reviewed

### `index.html` (landing + executive summary)
- Rewritten this session from the previous single-page prototype (session `ee533bdf`; its published flags are carried into `flagged.html` §Carried-from).
- Claims audited against sources: demo endpoints match [API Environments](https://docs.kalshi.com/getting_started/api_environments); CORS claim matches `data/cors.json` (runner probes); fee claim matches [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (taker `roundup(0.07·C·P·(1−P))`, effective July 7, 2026).
- Status strip reads `data/meta.json` only; no live values are asserted at load.

### `dashboard.html`, `topics/*.html`, `trades.html`
- Static shells; all dynamic content rendered by `assets/app.js` from official endpoints or verified snapshots. Disclaimers present on every page.
- Topic pages verified to load shared assets with correct relative paths (`../assets/*`, `data-root="../"`).

### `assets/app.js` (engine)
- Polling batch uses `GET /markets?tickers=…` — verified live: single response, empty cursor, works for settled markets too (settlement detection comes free from the same response).
- Discovery uses `GET /events?status=open&limit=200` (verified: `limit=1000` → 400) and `GET /series?category=…&include_volume=true` (verified live; `status` is **not** sent on `/series` because it is not a documented parameter there).
- Alert rule: sampled price delta ≥ $0.10 either direction, raw compare with 1e-9 tolerance (official prices are 4-dp fixed-point strings per [Fixed-Point Representation](https://docs.kalshi.com/getting_started/fixed_point_migration)).
- Order book: `orderbook_fp.{yes_dollars,no_dollars}`, ascending, best bid last, asks derived as `1 − bid` per [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses). Computed bid-side liquidity is labeled computed, not exchange-published.
- Chart windows ≥ 1 h use `GET /series/{s}/markets/{t}/candlesticks` (period 1 or 60 min) per [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks); sub-hour windows use session samples only (REST cache lag documented by Kalshi).
- 429 handling: exponential backoff, per [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits).
- No WebSocket (handshake requires signed headers browsers cannot attach — [WS Quick Start](https://docs.kalshi.com/getting_started/quick_start_websockets)). Flagged, not a bug.

### `assets/model.js` (ROI screen + paper broker)
- ROI score formula and weights documented in `methods.html` §3; heuristic, flagged as such.
- Strategies (momentum / fade / harvest / breakout): parameters fixed and documented; entries blocked outside 5¢–95¢ asks; exits at official bid; settlement pays $1 per winning contract per [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement).
- Fees: taker `roundup(0.07 × C × P × (1−P))` on entry and exit — matches the official schedule's General Trading Fees table (spot-checked: 100 contracts @ $0.50 → $1.75 ✓). Maker fees deliberately not modeled (paper fills assume immediate match) — flagged.
- Floating-point: all P&L deltas rounded to 4 dp before threshold comparisons (bug found and fixed via headless harness: `0.57 − 0.42 = 0.1499…` missed a +15¢ take-profit).
- Unit harness (run in CI-less session): classification (elections/gas/crypto/golf/culture, natural-gas exclusion, AAA series prefix), momentum entry at ask, take-profit exactness, settlement payouts — all PASS.

### `scripts/collect.py` + `scripts/topics.json` + `.github/workflows/verify-and-collect.yml`
- Stdlib-only Python; every value written to `data/` is verbatim from a logged URL (`data/log.md`). No values inferred; absent fields omitted.
- Pagination, per-event/per-series fetches, and settled-window queries match documented behaviors (single-response `event_ticker`/`tickers` reads, `min_settled_ts` compatibility with `status=settled`).
- `[skip ci]` on data commits prevents workflow loops; scheduled runs apply on `main` after merge.
- Topic mapping mirrored manually between `scripts/topics.json` and `assets/model.js → TOPICS` — a sync hazard, flagged.

### `data/` (Actions-verified snapshots)
- `cors.json`: probed from a GitHub-hosted runner 2026-11-20 — both demo hosts reflect any request Origin in `access-control-allow-origin` (Pages origin + `https://example.com` both echoed; preflight 204). This is what makes the client-side live mode possible.
- `meta.json`: run findings incl. observed market statuses (`active` ×6000 in sweep), candlestick probe result, observed market field names.
- `topics/*.json`: per-topic ranked events with `_match_reason` (category / series-prefix / series-discovery) and per-row source URLs.
- `resolved.json`: recently settled in-scope markets with `result` yes/no, `settlement_ts`, `settlement_value_dollars`.
- `log.md`: per-request audit trail.
- Snapshots are point-in-time; the live site always prefers fresh API responses when reachable.

### `data.html`, `methods.html`, `flagged.html`, `sources.html`
- `data.html` renders snapshots with a source link per row; blank cells for values the API did not return (never inferred).
- `methods.html` documents every rule with official links; `flagged.html` lists 16 items; `sources.html` lists every official source used.

### `.github/workflows/pages.yml` (from session `ee533bdf`, retained)
- Deploys Pages on `main` via actions. Note: repository Pages is currently configured `build_type: legacy` with source `main` path `/`; the Actions deployment and legacy setting coexist awkwardly — flagged for the integration step to reconcile (the Actions deploy has succeeded historically in this repo).

## Irregularities flagged (summary — details + links on flagged.html)

1. Demo market `status` values are `active`/`finalized`, docs enumerate `unopened/open/closed/settled`.
2. `GET /events?limit=1000` → 400; page size 200 used (undocumented ceiling, found empirically).
3. Candlestick path on demo is `/series/{s}/markets/{t}/candlesticks`; probe result per run recorded in `meta.json`.
4. Event `settlement_sources` sometimes contain template gaps (verbatim demo data quality issue).
5. No exchange-published per-market dollar-notional field in demo responses → all `$` trade figures are labeled estimates.
6. Maker fees not modeled (taker fee verified from official schedule).
7. News causality never claimed; alerts link official market page + settlement sources + a labeled news-search lead.
8. ROI score weights are documented engineering choices, not verified alpha.
9. Topic matching is heuristic; `scripts/topics.json` ↔ `assets/model.js` must be kept in sync manually.
10. Paper fills assume no slippage and infinite depth at best quotes.
11. Unauthenticated rate limits undocumented; client backs off on 429 and polls modestly.
12. Demo-account portfolio requires credentials; deliberately not requested/implemented (paper portfolio instead).
13. No WebSocket in browser (platform constraint).
14. No order placement anywhere (paper only).
15. Alerts are sampled between polls (~12 s); faster swings invisible over REST.
16. Sub-hour chart windows use session samples that reset on reload (localStorage prudence).

## How to re-verify

- Snapshot evidence: `data/log.md` (every request logged), `data/cors.json`, `data/meta.json`.
- Live probes: open any linked endpoint URL from `data.html` or `sources.html` in a browser.
- Site build: all pages return HTTP 200 from a static server; JS passes `node --check`; model harness passes (see session log in COORDINATION.md).
