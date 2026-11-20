# COORDINATION.md — shared task board

Repo: `wingbangboozle1-lang/Trade1` · Session branch: `arena/46259c0d-trade1` (base `dafd3bc` on `main`)

Statuses: `unclaimed` · `in progress` · `done` · `needs review`
Rule: claim a task by writing your session ID and file scope here, then commit and push immediately.
Log every handoff, conflict, source and irregularity below.

## Task board

| ID | Task | Status | Owner (session) | File scope |
|----|------|--------|-----------------|-----------|
| T1 | Repo review (line-by-line, sourced) | in progress | arena-46259c0d | `docs/flagged.html`, `docs/review.html` |
| T2 | Kalshi demo data collector (official API only) | in progress | arena-46259c0d | `scripts/kalshi_collect.py`, `scripts/analyze.py` |
| T3 | Site: landing, category pages, live dashboard, charts | in progress | arena-46259c0d | `docs/**` (except flagged/review), `.github/workflows/pages.yml` |
| T4 | Simulated trading, trade categorisation, jump detection | in progress | arena-46259c0d | `scripts/analyze.py`, `docs/strategies.html`, `docs/jumps.html` |
| T5 | Flagged for Review page + source list | in progress | arena-46259c0d | `docs/flagged.html`, `docs/sources.html` |
| T6 | Integration: build, link check, deploy, PR, merge | unclaimed | — | all (final session only) |

## Session log

- **arena-46259c0d** — Claimed T1–T5 on branch `arena/46259c0d-trade1`. Only one agent session is active on this repo at the time of writing (checked: remote branches are `main` and `arena/ee533bdf-trade1`, which is not this session's branch and is not modified here). The task-brief convention `session-<id>/<task>` conflicts with the system branch rule for this session, so this session keeps its assigned branch name and records that here.
- Note on the coordination file: branch `arena/ee533bdf-trade1` exists on origin (commit `b9425b3`) and was NOT read or modified by this session.

## Sources used (official)

- Kalshi API documentation (docs.kalshi.com): API environments, Get Markets, Get Events, Get Series List, Get Market Candlesticks, Get Market Orderbook, Market Lifecycle, Market Settlement.
  - Environments: https://docs.kalshi.com/getting_started/api_environments
  - Get Markets: https://docs.kalshi.com/api-reference/market/get-markets
  - Get Events: https://docs.kalshi.com/api-reference/events/get-events
  - Get Series List: https://docs.kalshi.com/api-reference/market/get-series-list
  - Get Candlesticks: https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  - Get Orderbook: https://docs.kalshi.com/api-reference/market/get-market-orderbook
  - Market settlement: https://docs.kalshi.com/getting_started/market_settlement
- Live demo API responses (external-api.demo.kalshi.co), read with the fetch tool on 2026-11-20.
- Category/tag taxonomy: `GET /search/tags_by_categories` on the demo host (https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories).

## Irregularities found so far (also published on the Flagged for Review page)

See `docs/flagged.html` once published.
