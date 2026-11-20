## What this PR adds

An independently verified **data + engine + dashboard** layer for the Kalshi brief, integrated so it does
not disturb the site already live on `main`.

The live site at `/` (session `81cacf69`, PR #5/#6) reads the API in the browser. This PR adds a second,
complementary dashboard at **`/dashboard/`** which is generated every 15 minutes by a GitHub Actions
pipeline from committed data files, so every number on it is reproducible from the repository.

### Nothing is claimed that was not measured

| Requirement | Where | Status |
|---|---|---|
| Live dashboard of the highest-dollar events, five topics only | `dashboard/events.html`, `dashboard/markets.html` | done |
| Topics kept separate, events grouped within a topic | `dashboard/events.html` | done |
| Track live events until resolved, YES/NO outcome | `dashboard/resolutions.html` | done |
| Automate simulated trades to test strategies | `collector/paper_engine.py`, `dashboard/strategies.html` | done |
| Track portfolio performance on the demo account | `dashboard/portfolio.html` | **simulated only — no demo credentials** |
| Categorise trades by strategy type | `dashboard/portfolio.html` | done |
| Execute trades on events | `collector/live_trading.py` | **built, blocked on credentials** (never executed) |
| Interactive chart, X = time, Y = price, s/m/h/d zoom | `dashboard/markets.html` | done |
| Liquidity + contracts available at a price | `dashboard/markets.html` (order book panel) | done |
| Flag moves ≥ $0.10 with links | `dashboard/jumps.html` | moves done, **causes unverified by design** |
| Executive summary | `dashboard/summary.html` | done |
| Suggestions to be more live/interactive | `dashboard/methodology.html#suggestions` | done |
| Flagged-for-review page | `dashboard/flagged.html` | 13 items |

### Verification performed

- **Fee model reproduces Kalshi's published schedule exactly: 21/21 rows.** The engine implements
  `round_up(M × 0.07 × C × P × (1−P))` from the official fee schedule PDF. `tests/test_verification.py`
  recomputes the whole published table and **fails the build** on any mismatch.
  During verification I found the schedule's wording ("centicent") does not match its own table: rounding
  to the centicent produced 10 wrong rows, rounding up to the cent reproduces 21/21. Documented in
  `collector/fees.py`.
- **Topic membership uses Kalshi's own fields**, not keywords: series `category`, `categories`, `tags`
  plus the published category→tag map (`/search/tags_by_categories`). 14,869 series indexed.
- **Live probe from a GitHub runner** (`research/probe/`): every demo and production read endpoint
  returned 200. The probe caught a real error of mine — I had called `/trades`, which 404s; the
  documented path is `/markets/trades`.
- **20 automated tests pass**; the site build link-checks all 10 pages and fails on a broken link.
- **Data provenance:** every market row links to its API object and its Kalshi page; every flagged item
  carries source URLs.

### Three real bugs found on live data, fixed, and disclosed

1. **Inverted arbitrage.** The complement rule required `YES bid + NO bid < 1`, but buying both costs
   `2 − (YES bid + NO bid)` and pays $1 — the edge exists when the bids sum **above** 1. The buggy rule
   lost **$449.84 over 26 simulated trades**. Fixed, two regression tests added; the pre-fix ledger is
   archived in `data/paper/archive/` rather than deleted.
2. **Topic starvation.** Markets list newest-first and Kalshi creates thousands a day, so a plain listing
   returned gas only. The collector now spends a per-event budget split evenly across the five topics.
   Before: 1 topic, 117 markets. After: **5 topics, 5,080 markets, 183 events**.
3. **Resolutions missed.** The tracker only counted `status == "settled"`, but resolved markets report
   `status == "finalized"` with `result`, `settlement_value_dollars` and `settlement_ts`. Now captured as
   evidence (verified against `GET /markets/KX10SONG-26-KAR`).

### Irregularities flagged (all published on `dashboard/flagged.html` with sources)

- **No Kalshi demo API credentials exist in this environment**, and they cannot be self-provisioned (a
  person must create the demo account and download the private key once). Live execution is implemented,
  self-tested and refuses to fire without credentials; the preflight result is committed to
  `data/live/status.json`. **This is the one requested feature that is not running.**
- WebSocket push is impossible without credentials (the handshake is signed), so the dashboard polls.
- Kalshi's `Culture` category contains only two series, so Culture = Culture + Entertainment + Social.
- Demo market data is not representative of production (193/200 open demo markets were zero-volume
  multivariate combos), so live prices come from the production public read endpoint.
- Per-series fee multipliers are only partly legible in the official PDF; unreadable rows fall back to
  schedule defaults and this is disclosed.
- Jump causes are unattributed: a price move is a fact, a news cause is a claim needing a source.

### Multi-session coordination

Six sessions ended up with independent `COORDINATION.md` files, one per branch, because the repo was
empty when each started. I read the other boards read-only and did not touch files outside my scope
(`collector/`, `sitegen/`, `config/`, `tests/`, `assets/`, `dashboard/`). PRs #2, #3 and #4 touch
different roots (`scripts/`, `docs/`, `site/`, `reports/`, `probe/`), so this PR is mergeable
independently. Where `main` already had a live site, it is preserved untouched at `/` and cross-linked.

### Sources

Kalshi official documentation: [demo environment](https://docs.kalshi.com/getting_started/demo_env) ·
[glossary](https://docs.kalshi.com/getting_started/terms) ·
[category→tag map](https://docs.kalshi.com/api-reference/search/get-tags-for-series-categories) ·
[Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) ·
[Get Events](https://docs.kalshi.com/api-reference/events/get-events) ·
[order book](https://docs.kalshi.com/api-reference/market/get-market-orderbook) ·
[trades](https://docs.kalshi.com/api-reference/market/get-trades) ·
[candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) ·
[signing](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) ·
[WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets) ·
[rate limits](https://docs.kalshi.com/getting_started/rate_limits) ·
[settlement](https://docs.kalshi.com/getting_started/market_settlement) ·
[fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
