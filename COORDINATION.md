# COORDINATION.md — shared task board

Repo: `wingbangboozle1-lang/Trade1` · Session branch: `arena/46259c0d-trade1` (base `dafd3bc` on `main`)

Statuses: `unclaimed` · `in progress` · `done` · `needs review`
Rule: claim a task by writing your session ID and file scope here, then commit and push immediately.
Log every handoff, conflict, source and irregularity below.

## Task board

| ID | Task | Status | Owner (session) | File scope |
|----|------|--------|-----------------|-----------|
| T1 | Repo review (line-by-line, sourced) | done (see Flagged page) | arena-46259c0d | `docs/flagged.html`, `docs/review.html` |
| T2 | Kalshi demo data collector (official API only) | done (runs in Actions; first run build OK, data verified after deploy — see log) | arena-46259c0d | `scripts/kalshi_collect.py`, `scripts/analyze.py` |
| T3 | Site: landing, category pages, live dashboard, charts | needs review (Pages source setting — see log) | arena-46259c0d | `docs/**` (except flagged/review), `.github/workflows/pages.yml` |
| T4 | Simulated trading, trade categorisation, jump detection | done (unit-tested on synthetic fixtures) | arena-46259c0d | `scripts/analyze.py`, `docs/strategies.html`, `docs/jumps.html` |
| T5 | Flagged for Review page + source list | done | arena-46259c0d | `docs/flagged.html`, `docs/sources.html` |
| T6 | Integration: build, link check, deploy, PR, merge | in progress | arena-46259c0d | all (final session only) |

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

### Log entries (arena-46259c0d)

1. **Build run on branch** (workflow_dispatch, run 44741194139 and 44741590387): tests pass (6/6), collector finishes, site link check passes, artifact uploaded. Deploy job correctly skipped (deploy only from `main`).
   - Run logs and the Actions artifact are not downloadable from the agent sandbox (blob storage host is outside the allowlist), so the first live data snapshot must be checked after deploy.
2. **Pages source blocker:** repo Pages is set to `legacy` (branch `main`, path `/`). The sandbox token gets HTTP 403 on `PUT /repos/.../pages` (both build_type and source path). `actions/configure-pages` with `enablement: true` also did not switch the source. Required one-time step: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Until then the deploy job cannot publish and the merge is held (site would not deploy).
3. **Probe workflow:** the Actions list on the repo includes `probe-api` (`.github/workflows/probe.yml`) which is NOT on `main` or this branch. Not read or modified by this session; flagged for review.
4. **Kalshi API status values:** demo returns `status: "active"` for open markets; the Get Markets doc lists `unopened, open, closed, settled`. Flagged automatically (Sources page check `status_enum`).
5. **Kalshi demo data quality (observed live on 2026-11-20 via the demo REST API):** several settlement sources link to `https://kalshi.com/` instead of the named publisher; some `contract_url` values point to a `kalshi-public-docs-staging` S3 bucket; some markets have 2099 close dates and `demo strike` custom fields. All are flagged automatically. Markets are demo-environment data, not production prices.
6. **Verification performed:** endpoint paths and parameters checked against the Kalshi docs pages listed above; live responses for `/markets`, `/events?with_nested_markets=true`, `/series?category=Crypto`, `/search/tags_by_categories` read on 2026-11-20. Binary identity (yes_bid + no_ask = 1) is checked automatically per market.
7. **Topic mapping (our choice, not an official Kalshi category):** Culture = `Entertainment`; Gas = `Commodities` + tag `Oil & Gas` or title match "gas price"/"gasoline"; Golf = `Sports` + tag `Golf`. Documented on the site and on the Flagged page.
8. **Not implemented (blocked):** trading on the Kalshi demo account and demo portfolio tracking need demo API keys (signed requests). The sandbox has none, and the user-provided "no manual input" rule cannot supply them. Paper trading and backtests are implemented instead.
9. **Not available from the API:** seconds-level candles (1-minute is the finest), and any verified cause for ≥$0.10 moves (no news feed).
10. **Handoff/merge rule:** PR `arena/46259c0d-trade1` → `main` will be merged only after the deploy job can publish (see item 2) and the deployed data has been spot-checked.
