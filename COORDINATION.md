# COORDINATION — shared task board

Repo: `wingbangboozle1-lang/Trade1` · Base: `main` @ `dafd3bc`

Session IDs in this log use the branch suffix. This session: **`a2ec5543`** (branch `arena/a2ec5543-trade1`).

Statuses: `unclaimed` · `in progress` · `done` · `needs review` (item is published on the *Flagged for Review* page and does not block anything).

Branch note: the platform fixes this session to a single branch (`arena/a2ec5543-trade1`), so the `session-<id>/<task>` branch naming in the original brief is not used. Non-overlapping file scopes are still enforced per task below.

## Task board

| ID | Task | Status | Owner | File scope |
|----|------|--------|-------|-----------|
| T1 | Repo review (line-by-line, sources, irregularities) | in progress | a2ec5543 | `reports/REPO_REVIEW.md` |
| T2 | Official-source verification of Kalshi API, endpoints, field semantics | in progress | a2ec5543 | `config/sources.json`, `reports/API_VERIFICATION.md` |
| T3 | Market data pipeline (fetch official Kalshi demo API, build JSON) | in progress | a2ec5543 | `scripts/`, `config/topics.json` |
| T4 | Static GitHub Pages site: landing, topic pages, live charts, tables | in progress | a2ec5543 | `site/`, `.github/workflows/site.yml` |
| T5 | Simulated strategy backtests + trade categorisation | in progress | a2ec5543 | `scripts/backtest.py`, `reports/STRATEGY_BACKTEST.md` |
| T6 | Executive summary + Flagged for Review page | in progress | a2ec5543 | `reports/EXECUTIVE_SUMMARY.md`, `site/flagged/` |
| T7 | Integration: build, link check, Pages deploy, PR to `main`, merge | unclaimed | — | shared outputs (README, this file's index) |

## Session log

- **a2ec5543** — claimed T1–T7 at session start. Single-session run: all tasks owned by this session. Notes will be appended below as work completes.

## Sources used (log)

See `config/sources.json` for the full list with URLs, the date each was checked, and what was verified. Summary of primary official sources:

- Kalshi API docs (`docs.kalshi.com`) — environments, markets, events, candlesticks, orderbook, historical data, fixed-point fields, rate limits, WebSocket auth.
- Kalshi demo REST API (`external-api.demo.kalshi.co/trade-api/v2`) — read live via official public GET endpoints.

## Irregularities / flagged items

Tracked on the **Flagged for Review** page of the site and in `reports/`.
