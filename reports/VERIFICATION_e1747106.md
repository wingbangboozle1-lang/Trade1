# Verification record — session `arena/e1747106-trade1` (2026-11-21)

Scope: live-state verification of the deployed site and the official demo API; recording and
recovering from a degraded committed snapshot (HTTP 429 rate-limiting); a resilience change
request for the collector. No engine, page, or collector code was edited by this session.

---

## 1. Incident: degraded snapshot committed to `main` at 06:58Z (2026-11-21)

**Observed (evidence committed on `main` before this session's recovery):**

- `data/meta.json` @ `generated_at 2026-11-21T06:58:35Z` recorded
  `markets_status_open_accepted: false`, `markets_open_count: 33`,
  `markets_open_statuses_observed: {}`, `settled_count_recent: 0` — against ~14,900–15,200
  open markets in the 2026-11-20 snapshots.
- `data/log.md` (same run) recorded, among the request log:
  - `GET …/markets?status=open&limit=1000&mve_filter=exclude -> 429 (68B) body=b'{"error":{"code":"too_many_requests","message":"too many requests"}}'`
  - `GET …/markets?status=open&limit=1000 -> 429 (68B)` (the collector's fallback retry — also 429)
  - `GET …/markets?status=settled&min_settled_ts=…&limit=1000&mve_filter=exclude -> 429 (68B)`
- The collector (`scripts/collect.py`) has empty-result fallbacks but **no 429 retry/backoff**,
  so the run completed "successfully" and committed a near-empty snapshot; the live site then
  served it (`https://wingbangboozle1-lang.github.io/Trade1/data/meta.json` fetched at
  07:12Z still showed the degraded findings).

**Cause analysis (verified against official sources):**

- The official [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) page
  (read 2026-11-21) says: *"Unauthenticated public requests are subject to separate limits.
  Authenticate requests where supported and back off on `429`"*, and in
  [When you hit the limit](https://docs.kalshi.com/getting_started/rate_limits#when-you-hit-the-limit):
  a 429 returns exactly the body the collector logged, carries no `Retry-After`, *"There is no
  penalty or cooldown… Apply exponential backoff on 429."*
- Same page, [Rate limit headers](https://docs.kalshi.com/getting_started/rate_limits#rate-limit-headers):
  *"Public endpoints charge your IP address's budget first, even on signed requests."*
  GitHub-hosted runners egress from large shared IP ranges, so **concurrent collector runs can
  share one IP budget**. At 07:03–07:05Z the Actions list showed six `Site checks + data refresh`
  runs started within three minutes (runs 44878453974 / 44878516394 / 44878427983 on session
  branches, plus `main` runs 44878307975 / 44878520971 and branch run 44878556490) — several of
  them collection jobs (dispatch/schedule) hitting the same public budget simultaneously.
- Conclusion: the 06:58Z degraded snapshot is an operational/sequencing incident (unauthenticated
  collector + concurrent runs + no backoff), not an API outage and not a data-correctness bug.
  Nothing was inferred to fill the gaps — the collector wrote only what it received (counts of 0/33
  are the *received* reality of that run, not invented values).

**Not an API outage — verified directly (see §2):** the exchange and all market-data endpoints
returned correct responses minutes later from the same hosts.

## 2. Live probes of the official demo API (2026-11-21, this session)

All probes are the exact URLs listed below, fetched through the platform page fetcher (this build
sandbox has no direct route to `*.kalshi.co` — egress allowlist, recorded on the task board).
Every probe returned HTTP 200 with a well-formed body.

| # | Time (UTC) | URL probed | Result |
|---|---|---|---|
| P1 | 07:07 | `https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=3` | 200 — 3 markets with full schema (`status:"active"`, `price_level_structure:"center_deci_edge_centi_cent"`, 4-dp `_dollars` fields) |
| P2 | 07:08 | `https://external-api.demo.kalshi.co/trade-api/v2/exchange/status` | 200 — `exchange_active:true`, `trading_active:true`, all four demo shards (`exchange_index` 0–3) `trading_active:true` |
| P3 | 07:09 | `https://external-api.demo.kalshi.co/trade-api/v2/markets/KXAAAGASM-26NOV30-3.90/orderbook?depth=5` | 200 — `orderbook_fp` with `yes_dollars`/`no_dollars` arrays (empty for this quiet demo market — documented behavior, not an error) |
| P4 | 07:09 | `https://external-api.demo.kalshi.co/trade-api/v2/series/KXAAAGASM/markets/KXAAAGASM-26NOV30-3.90/candlesticks?period_interval=60&start_ts=1795132800&end_ts=1795219200` | 200 — `candlesticks:[]` (no trades in the window for this demo market; endpoint healthy) |
| P5 | 07:10 | `https://external-api.demo.kalshi.co/trade-api/v2/markets/KXGOLFMAJOR-30-RFOX` | 200 — resolved market: `result:"yes"`, `status:"finalized"`, `settlement_ts:"2026-07-19T18:49:28.40545Z"`, `settlement_value_dollars:"1.0000"` — matches `data/resolved.json` verbatim |

Docs re-read this session (all official):

- [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) — 429 semantics,
  backoff prescription, IP-budget behavior for public endpoints (quoted above).
- [API Environments and Endpoints](https://docs.kalshi.com/getting_started/api_environments) —
  demo REST base `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and
  `https://demo-api.kalshi.co/trade-api/v2` (also supported); demo WebSocket
  `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2`
  (also supported) — **all four endpoint URLs named in the project brief match the official
  documentation exactly**, re-confirmed today.

## 3. Recovery executed this session

1. Triggered the snapshot job on `main` via `workflow_dispatch` (`gh workflow run pages.yml --ref main`).
   Two dispatches were cancelled because GitHub supersedes a *pending* run when a newer run joins
   the same concurrency group (`site-data-refs/heads/main`, `cancel-in-progress: false` — pushes
   to `main` were landing every few minutes from parallel sessions); documented here because it
   explains the retries. Attempt 2 (run **44879546437**) survived and completed **success**
   (`snapshot` job success; `checks` skipped on dispatch by design).
2. The run committed a fresh verified snapshot to `main` (data commit `a917618…`).
3. **Live-site recovery verified through the page fetcher**:
   `https://wingbangboozle1-lang.github.io/Trade1/data/meta.json` fetched after the Pages build
   (created 07:23:57Z) now serves `generated_at 2026-11-21T07:17:44Z` with
   `markets_status_open_accepted: true`, `markets_open_count: 14,646`,
   `events_open_count: 2,400`, `settled_count_recent: 6,000`, zero 429s in `data/log.md`,
   `orderbook_ok: true`, `candlesticks_ok: true`, and per-topic series discovery at 200 series
   per topic (per-series open-market counts populated, e.g. `KXBTCD: 1000`, `KXPGATOUR: 208`,
   `KXGOLFMAJOR: 171`, `KXPRESNOMD: 66`).

## 4. Change request CR-e1747106-1 (logged, not implemented — files owned by another session)

`scripts/collect.py` and `.github/workflows/pages.yml` are in the claimed scope of active session
`6b112481` (PR #68), so per the coordination protocol this session logs the request instead of editing:

1. **429 retry with exponential backoff** in `scripts/collect.py` — on any 429, wait and retry
   (e.g. 2s/4s/8s), because the official docs prescribe backoff and confirm there is no penalty
   window; the bucket refills continuously.
2. **Degraded-snapshot guard** — do not commit (or explicitly mark `degraded: true` in
   `data/meta.json`) when the run recorded 429s on the primary sweeps or
   `markets_status_open_accepted` is false with an implausible `markets_open_count` (< 1000 when
   the exchange is active), so the deployed site never silently serves a near-empty table while
   still committing nothing false. Optionally serialize collection by having branch pushes not
   trigger collection at all (they currently do not; only dispatch/schedule do — the collision is
   between *multiple branches' dispatch/schedule runs*, which the per-ref concurrency group does
   not deduplicate).

Until that lands, the operational mitigation is: re-dispatch the snapshot job (as done here) and
verify `data/meta.json` afterwards — `npm run check` and `scripts/check_site.mjs` keep working
either way because they validate the committed snapshot, not its plausibility.

## 5. Local validators (this session's branch, after merging `origin/main`)

- `node tools/build.mjs` → BUILD OK (18 HTML, 6 JS, 0 broken links)
- `node scripts/check_site.mjs` → 0 failures (18 pages, 432 links, 1,183 rows, 625 resolved)
- `node scripts/check_links.mjs` → 0 failures (16 pages, 400 local + 236 external)
- `npm test` → all suites green (engine 23/23, live_fixes 3/3, live_dash 6/6, lib, model, fees,
  root_engine, model.test, portfolio 60/60, demo-account 89/89, collector tests)
- Re-run on the final tree before the PR; see the session board record for the closing numbers.

## 6. Remaining open items (unchanged, published on `flagged.html`)

- AA-8 (live runtime re-confirmation) — partially advanced by this record's live probes (P1–P5),
  but the dashboard's *in-browser* behavior is still best confirmed by the owner in a real browser.
- 691-10 (maker fees unmodeled), 6b/691-1 (fee-source conflict, open by design), 9d-5 (demo-account
  keys needed for real account tracking/execution — owner input required), I7 (news links are
  labeled leads, not official sources).
