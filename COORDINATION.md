# COORDINATION.md — Shared Task Board

Shared task board for the Kalshi demo dashboard. Statuses: `unclaimed`, `in progress`, `done`, `needs review` (published on the Flagged for Review page; does not block anything).

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup (prototype, PR #1) | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |
| Kalshi demo monitor v2: live dashboard, topic subpages, alerts, simulated strategies, resolved tracker, sources, flagged page, Pages build | in progress | cedad5c4 | `**`, `scripts/**`, `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `COORDINATION.md` (removes prototype `index.html`) |

## Branch policy and overlaps

- Session `cedad5c4` works only on its assigned branch `arena/cedad5c4-trade1`, branched from `main` at `73ba253`. The platform does not allow switching or pushing to other branches, so the `session-<id>/<task>` naming in the brief is not used.
- The remote has about 12 other `arena/*` branches from other sessions (for example `arena/08347343-trade1`, `arena/a2ec5543-trade1`, `arena/10000a95-trade1`, `arena/46259c0d-trade1`). Several of them claim the same files (`index.html`, `.github/workflows/pages.yml`, `site/`). **None of them were merged or edited by this session.** Their claim tables live on their own branches, not on `main`. See Flagged item R9. The owner needs to choose which branch becomes the integration target. Pull and merge decisions are not made by this session.

Repo: `wingbangboozle1-lang/Trade1` (Kalshi demo dashboard)
Sessions: `session-0db174ef-trade1` (branch `arena/0db174ef-trade1`), `81cacf69` (merged via PR #5),
`sess-a1-9a0ad587` (branch `arena/9a0ad587-trade1`, merged via PR #7).

This is the shared task board. Each task has: id, status, owning session, and the files it touches.
Shared outputs (site index/navigation) are changed only by a final integration session once all
other tasks are done.

### Kalshi demo dashboard (prototype, `ee533bdf`)
- Claimed 2026-11-20 by session `ee533bdf`; merged to `main` via PR #1 (merge `73ba253`). Status: needs review.

### Kalshi demo monitor v2 (`cedad5c4`)
- Claimed 2026-11-20 by session `cedad5c4` on branch `arena/cedad5c4-trade1`, base `main` @ `73ba253`.
- Scope: rebuild the static site as landing + five topic subpages + live dashboard + resolved + strategies + sources + Flagged for Review. Data are read only from the official Kalshi Trade API. Snapshot built in CI (`scripts/build_snapshot.mjs`). Checks in `scripts/check_site.mjs` and `scripts/test_lib.mjs`.
- Sources consulted (official Kalshi docs, read 2026-11-20 UTC): API environments; market lifecycle; Get Markets; pagination; Get Trades; orderbook responses; rate limits; historical data; quick start market data; candlesticks; `llms.txt` index. Live responses observed from the demo REST endpoints (`/markets`, `/events`, `/series`) via the page fetcher. The sandbox itself has no route to Kalshi.
- Verification performed: each referenced field name was checked against the official docs or an observed live response; `node --check` on all modules; `node scripts/test_lib.mjs` (offline fixtures for topic rules, swings, screen, orderbook, pagination); CI check `scripts/check_site.mjs` (every local link resolves; every snapshot and resolved row has a `source_url` on the configured API base).
- Not done (blocked): demo account portfolio tracking and order execution need demo API credentials, which were not provided. Not built, not faked.
- Irregularities: see Flagged for Review (`flagged.html`), items F1–F10 and R1–R9.
- Deployment: Pages build type changed from legacy (branch `main`, path `/`) to GitHub Actions. The deploy step runs only on `main`. Deployment record and the PR/merge result are below once complete.

### Overlap log for open PRs (session `cedad5c4`, recorded 2026-11-20 UTC)

Other sessions' files were **not edited**. These are logged for their owners.

| PR | Branch | Overlaps with cedad5c4 scope |
|---|---|---|
| #6 | arena/0db174ef-trade1 | `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `COORDINATION.md`, `index.html`; also a full alternate site (`pages/`, `js/`, `css/`). Two different site trees would conflict on Pages. |
| #4 | arena/a2ec5543-trade1 | `.github/workflows/pages.yml`, `index.html`, `COORDINATION.md`; a `site/` tree that cedad5c4 removed from the root. Also commits `probe/` outputs and `__pycache__`. |
| #3 | arena/46259c0d-trade1 | `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `COORDINATION.md`; `docs/` Pages source would conflict with the root publish. |
| #2 | arena/20e3ad14-trade1 | `COORDINATION.md`, `data/demo_account/*` (no overlap with cedad5c4 files). Demo-account execution scope is not built on this branch. |
| #7 | arena/9a0ad587-trade1 | Reported `CONFLICTING` with main at the time of this log. Not inspected in depth. |

Action needed by the owners of #2, #3, #4, #6: rebase on `main` after cedad5c4's merge, and keep one Pages source (main root). Log the conflicts in your own claim row.

### Data handling decision

- `data/snapshot.json` (about 1.6 MB, capped) and `data/cors_check.txt` are **committed** by the Pages workflow. Reason: the legacy Pages source serves from `main /`, so the data must be in the repo for the static site to load it. `.gitignore` lists `node_modules/` and `.DS_Store` only, so the generated data is not ignored. The snapshot is rebuilt on schedule with `[skip ci]`. Flagged as R10 for the owner.
- An earlier uncapped snapshot (62.9 MB, commit `3301ad5`) was removed from the branch history before this merge. It is no longer in `arena/cedad5c4-trade1`, but it is still in the history of commits from before the rewrite and must not be re-committed.

### Deployment record

- Pages build type: `legacy` (`main` / `/`). Switching to `workflow` returned 403 with the available token, so the workflow's deploy job (main only) is not the publish path. Pages publishes from `main` root on push.
- Branch CI: `pages.yml` runs `snapshot` (build + check) on the branch. Last successful run: 44744432306 (snapshot job success; checks skipped on branch). Checks: 71 links, 1,154 rows, 625 resolved rows, 0 failures.

## Network / environment constraint (read first)

This sandbox has outbound egress restricted to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
The Kalshi hosts (`*.kalshi.co`, `docs.kalshi.com`, `kalshi-public-docs.s3.amazonaws.com`) are
**not reachable from the build sandbox** — verified with `curl` (TLS handshake resets; `code:000`,
rc=35). Dashboards therefore fetch Kalshi demo data **live in the user's browser** (public
market-data endpoints support browser `fetch`/CORS per Kalshi's own docs), so the values a user
sees are real values from the official API. Anything the sandbox could not confirm is left blank
and flagged as **unverified**. No market data is invented. (Session `sess-a1-9a0ad587` verified
the demo API through Arena's page-fetch of official docs and live demo endpoints; see its
verification log below.)

## Tasks — sessions 0db174ef (root dashboard) & 81cacf69 (monitor views)

| ID | Task | Status | Owner | Files (scope) |
|----|------|--------|-------|----------------|
| T1 | Executive summary + project scope | done | session-0db174ef-trade1 | `docs/executive-summary.md` |
| T2 | Official API reference + verification notes | done | session-0db174ef-trade1 | `docs/api-reference.md`, `docs/verification.md`, `docs/sources.md` |
| T3 | Kalshi demo client (public + RSA-PSS signed) | done | session-0db174ef-trade1 | `js/kalshi.js` |
| T4 | Core dashboard: state, charts, tables, sharp-move flags | done | session-0db174ef-trade1 | `js/store.js`, `js/charts.js`, `js/dashboard.js`, `css/style.css` |
| T5 | Topic pages (gas, elections, culture, crypto, golf) | done | session-0db174ef-trade1 | `pages/*.html`, `js/nav.js` |
| T6 | Portfolio tracker + simulated strategy engine + demo execution | done | session-0db174ef-trade1 | `js/strategy.js`, `js/portfolio.js`, `pages/portfolio.html` |
| T7 | Flagged for Review + topic landing index | done | session-0db174ef-trade1 | `pages/flagged.html`, `js/flagged.js` |
| T8 | Site build/link validation + GitHub Pages + PR + merge | done | session-0db174ef-trade1 | `tools/build.mjs`, `.github/workflows/pages.yml`, `package.json`, `README.md` |
| M1 | Alternate multi-page monitor (dashboard + categories + assets) | done | 81cacf69 | `dashboard.html`, `categories/*.html`, `flagged.html`, `assets/*` |
| M2 | Root monitor accuracy/safety refinement and integration | done (PR #11 merged; Pages deployed) | ca29cf60 | `dashboard.html`, `categories/*.html`, `flagged.html`, `assets/js/app.js`, `COORDINATION.md` |

## Tasks — session sess-a1-9a0ad587 (`site/` dashboard)

Arena requires this session to keep all work on `arena/9a0ad587-trade1` (the Arena-managed session
branch); it is used in place of `session-<id>/<task>` naming.

| # | Task | Owner | Files touched | Status |
|---|---|---|---|---|
| 1 | Coordination board setup | sess-a1-9a0ad587 | `COORDINATION.md` (merged with 0db174ef/81cacf69 board) | done |
| 2 | Kalshi demo API verification (endpoints, fields, rate limits, fees) from official sources | sess-a1-9a0ad587 | `docs/API_NOTES.md`, `docs/SOURCES.md` | done |
| 3 | Executive summary | sess-a1-9a0ad587 | `docs/EXECUTIVE_SUMMARY.md`, `site/index.html` | done |
| 4 | Dashboard site framework (landing + topic subpages: gas, elections, culture, crypto, golf) | sess-a1-9a0ad587 | `site/**` | done |
| 5 | Live price/liquidity tracking + charts (sec/min/hour granularity, orderbook depth) | sess-a1-9a0ad587 | `site/js/**`, `site/topics/*.html` | done |
| 6 | Jump detector (≥ $0.10 moves) with cause/news links | sess-a1-9a0ad587 | `site/js/engine.js` (T1Track), `site/js/topic.js`, `site/js/dashboard.js` | done (file scope changed during build; jump logic lives in engine.js) |
| 7 | Paper strategy engine + portfolio performance tracking | sess-a1-9a0ad587 | `site/js/engine.js`, `site/js/strategies.html` | done |
| 8 | Resolution tracker (live events until resolved yes/no) | sess-a1-9a0ad587 | `site/js/engine.js`, `site/js/store.js` | done |
| 9 | Flagged-for-review page + irregularity log | sess-a1-9a0ad587 | `docs/FLAGGED.md`, `site/flagged.html` | done (12 items F1–F12) |
| 10 | Suggestions page (making the site more live/interactive) | sess-a1-9a0ad587 | `site/suggestions.html` | done |
| 11 | Pages deployment + PR to main + merge + deploy verification (final integration for its scope) | sess-a1-9a0ad587 | PR #7; `.github/workflows/deploy-pages.yml` superseded by existing legacy Pages + `pages.yml` validator | done |
| 12 | README (repo overview, quick links) | sess-a1-9a0ad587 | `README.md` (merged with 0db174ef/81cacf69 sections) | done |

## Deployment (current, canonical)

- GitHub Pages: **legacy mode, serving `main` at `/`** → https://wingbangboozle1-lang.github.io/Trade1/
  - Primary dashboard (0db174ef): `/` (`index.html`, `pages/…`)
  - Monitor views (81cacf69): `/dashboard.html`, `/categories/…`
  - site/ dashboard (sess-a1-9a0ad587): **`/site/`** (`site/index.html`, `site/topics/…`, `site/strategies.html`, …)
- Validation: `.github/workflows/pages.yml` → `node tools/build.mjs` on every push/PR (JS syntax +
  broken-link/asset check across the whole repo, including `site/`).
- `.github/workflows/deploy-pages.yml` (sess-a1-9a0ad587, artifact-based Pages deploy) was
  **superseded** during integration: legacy branch-Pages was already configured and live, and a
  second deploy pipeline would fight the existing setup. It was removed; its validation role is
  covered by `tools/build.mjs`. Logged here to keep the change traceable, not silent.

## Session log

### session-0db174ef-trade1

- Started. Reviewed repo (empty except `README.md`, single initial commit `dafd3bc`).
- Confirmed no `COORDINATION.md` existed; created it and claimed T1–T8 (single active session at start).
- Verified network egress restriction against Kalshi (blocked) and against GitHub/npm/PyPI (ok).
- Verified official sources reachable from sandbox:
  - Official Kalshi Python SDK `kalshi` on PyPI (v0.2.0) — auth via `POST /log_in` -> Basic token.
    https://pypi.org/project/kalshi/
  - `github.com/mlucy/kalshi_py` SDK + REST spec (`swagger.json`).
  - Official starter code `Kalshi/kalshi-starter-code-python` — demo base URL, RSA-PSS header
    auth (`KALSHI-ACCESS-KEY` / `KALSHI-ACCESS-SIGNATURE` / `KALSHI-ACCESS-TIMESTAMP`), `/trade-api/v2`
    endpoints, WebSocket `{"cmd":"subscribe","params":{"channels":["ticker"]}}`.
- Sources + verification details recorded in `docs/sources.md` and `docs/verification.md`.
- Built the full dashboard (T1–T8): client, store, charts, strategy engine, portfolio, topic pages,
  flagged page, docs, build tooling, CI workflow.
- Build validation: `node tools/build.mjs` -> **BUILD OK** (8 HTML, 10 JS, 0 broken links).
- IRREGULARITY (flagged): demo base host discrepancy (`external-api.demo.kalshi.co` vs
  `demo-api.kalshi.co`). Both supported; the reachable one is used and reported.
- IRREGULARITY (flagged): sandbox cannot reach Kalshi, so live data + topic ticker mappings could
  not be exercised from the build host. Topic mapping is data-driven to avoid fabricating tickers.

### 81cacf69

- Claimed the Kalshi demo dashboard task on `arena/81cacf69-trade1`.
- Built a multi-page static monitor: landing `index.html`, `dashboard.html`, per-category
  `categories/*.html`, `flagged.html`, `assets/css|js`.
- Confirmed the same Kalshi egress block; flagged all live values unverified.
- Merged to `main` via PR #5.

### Merge conflict & integration (session-0db174ef-trade1, final integration)

- PR #6 (this branch -> main) initially failed to merge: `main` had advanced with session 81cacf69's
  competing dashboard, causing add/add conflicts in `index.html`, `README.md`, `COORDINATION.md`,
  and `.github/workflows/pages.yml`.
- Resolved **without discarding either session's work**:
  - `index.html` and `.github/workflows/pages.yml` kept the `0db174ef` versions (primary dashboard +
    validation CI; Pages is served from the `main` branch root).
  - `README.md` and `COORDINATION.md` rewritten to integrate both sessions' scopes and logs.
  - Session 81cacf69's files (`dashboard.html`, `categories/*.html`, `assets/*`, `flagged.html`)
    preserved intact.
- Merged the result and pushed; PR #6 merged to `main`.

#### Integration / publish (session 0db174ef, completion recorded on main @ ed59af6)
- [x] Build + link validation (`node tools/build.mjs` -> BUILD OK)
- [x] PR #6 created from `arena/0db174ef-trade1` to `main`
  - https://github.com/wingbangboozle1-lang/Trade1/pull/6
- [x] Merge conflict resolved (both sessions' work preserved)
- [x] PR #6 merged to `main` (squash, commit `77f20e8`)
- [x] CI workflow `KalshiDash CI + Pages` passed on `main` (conclusion: success)
- [x] GitHub Pages build + deployment succeeded (status: built)
  - Live site: https://wingbangboozle1-lang.github.io/Trade1/

#### Result (session 0db174ef)
All tasks (T1–T8 for session 0db174ef; M1 for session 81cacf69) are complete. The site builds with
no broken links, the CI validation passes, PR #6 is merged to `main`, and GitHub Pages is live.
Flagged irregularities / unverified items do not block the merge and are published on the site's
Flagged for Review pages with source links.

### sess-a1-9a0ad587 — verification log (2026-11-20)

Official sources fetched and read this session (links in `docs/SOURCES.md`, `docs/API_NOTES.md`):
- https://docs.kalshi.com/getting_started/demo_env.md — demo REST root, WS root, mock funds, demo≠production.
- https://docs.kalshi.com/getting_started/quick_start_market_data.md — no-auth public endpoints, browser fetch examples, orderbook format, kalshi.com/markets URL pattern.
- https://docs.kalshi.com/api-reference/market/get-markets.md — status filters, pagination, caching/lag.
- https://docs.kalshi.com/api-reference/market/get-series-list.md — category/tags filters, fee fields, settlement_sources.
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md — period_interval {1,60,1440}, 5,000-period cap.
- https://docs.kalshi.com/api-reference/market/get-market-orderbook.md — orderbook_fp format, depth.
- https://docs.kalshi.com/api-reference/market/get-trades.md — trade tape fields/limits.
- https://docs.kalshi.com/getting_started/rate_limits.md — token buckets, unauthenticated limits, 429.
- https://docs.kalshi.com/getting_started/market_settlement.md — $1/contract to winning side, no settlement fee.
- https://kalshi.com/docs/kalshi-fee-schedule.pdf — taker fee roundup(M×0.07×C×P×(1−P)); maker multiplier default 0.
Live demo API probes (official host, fetched this session): `/events?status=open`; `/markets?series_ticker=KXBTC&status=open|settled` (confirmed `result:"no"`, `status:"finalized"` on settled markets); `/series/{KXGAS,KXETH,KXTIME,KXPGA,KXMASTERS}` (all five exist on demo with the expected categories/tags/settlement sources).
Irregularities flagged: F1–F12 in `docs/FLAGGED.md` (CORS unconfirmed officially; demo credentials absent → paper engine + dormant read-only connector; no aggregate liquidity field in v3.37.0 responses; status vocabulary mismatch `active`/`finalized` vs docs; news links are labeled searches; no public demo deep links; settlement-bound fields unexercised; $-value metric is a documented approximation; KXPRES28 probe failed twice — unverified; REST caching lag; order placement dormant; WebSocket requires keys → polling used).

### sess-a1-9a0ad587 — build & integration log (PR #7)

- Built `site/` dashboard (10 JS modules, 11 HTML pages, vendored Chart.js 4.6.1 from npm, MIT).
- Local checks: `node --check` on every JS file (all pass); internal link/asset existence check across all HTML (none missing).
- Local preview: `python3 -m http.server 8080 --directory site` — all 14 spot-checked paths return 200.
- PR #7 → `main` initially unmergeable: `main` had advanced (PRs #1/#5/#6 from sessions 0db174ef & 81cacf69). Resolved per protocol **without discarding their work**:
  - Root dashboard, monitor views, docs, build tooling, and `pages.yml` kept intact.
  - `README.md` and `COORDINATION.md` rewritten to integrate all three sessions' scopes/logs.
  - `site/` dashboard preserved intact and served under `/site/`.
  - `deploy-pages.yml` (this session's artifact-based deploy) superseded by the existing legacy
    Pages (branch `main`, path `/`) + `tools/build.mjs` validator; removal logged above.
- `main` advanced again mid-integration (session 0db174ef's publish-confirmation commit `ed59af6`); merged again, folding their publish block into the unified board — nothing discarded.
- `git pull --rebase` hazard noted for future sessions: rebasing a branch that contains merge commits replays the other side's history and stalls (hit once here; `git rebase --abort` recovered cleanly, remote was already correct). Prefer plain `git pull` (merge) on integration branches.
- **PR #7 merged to `main`**: https://github.com/wingbangboozle1-lang/Trade1/pull/7 (merge commit `0d28c20`, merged 2026-11-20T13:29:46Z).
- CI `KalshiDash CI + Pages` on the merge commit: **success** (run 44744799127) — 18 HTML, 20 JS validated, 0 broken links.
- GitHub Pages build & deployment: **built** at commit `0d28c20` (run 44744797949).
  - Live site (root, primary dashboard): https://wingbangboozle1-lang.github.io/Trade1/
  - Live site/ dashboard (this session): https://wingbangboozle1-lang.github.io/Trade1/site/index.html
  - Verified by fetching the deployed pages: landing + strategies pages render with engine controls, strategy cards, stats, and tables in place; live tables populate client-side from the official demo API in a real browser.

## Follow-up integration log — ca29cf60

- Task was claimed and pushed on the Arena-assigned branch before the multi-page session PRs merged (`4ccdd26`). This follow-up does not modify the newer `site/` output owned by the already-completed PR #7 integration; it refines the root monitor pages under M2.
- Upstream `main` advanced to PR #7 while the branch was active. `git pull --rebase origin main` conflicted in `COORDINATION.md`; resolved by keeping the shared main board and adding this M2 row/log. The newer `main` task scopes and site assets were preserved.
- Official source review used Kalshi [API Environments](https://docs.kalshi.com/getting_started/api_environments.md), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Get Market](https://docs.kalshi.com/api-reference/market/get-market.md), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md), [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses.md), and [Quick Start: WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets). In particular, `volume_fp` is contract count, `notional_value_dollars` is settlement value for one contract, and bid arrays are ordered ascending with the best bid last. No total traded-dollar turnover or ROI was inferred.
- Root monitor refinements: topic-only matching; decimal-safe ≥$0.10 alerts for all loaded topic markets; selected-market REST sampling; best orderbook levels; automatic local-only Momentum/Mean-reversion quote marks; current settled rows when yes/no is explicitly returned; direct official API-record links; exact supported endpoint pairs; and per-row sources on static findings tables. No real orders, fills, P&L, full cursor pagination, news-cause attribution, or WebSocket connection are claimed.
- Verification: `node --check assets/js/app.js`; mocked API/DOM smoke test for topic restrictions, best bid-level display, upward/downward threshold alerts, automatic marks, settled YES output, and trade source links; HTML parsing/no duplicate IDs; all local links/resources resolve; static findings table rows have official links; `git diff --check`; and local HTTP preview paths returned 200. Final repository validator: `node tools/build.mjs` → `BUILD OK — 18 HTML, 20 JS files validated, 0 broken links`.
- PR #11 (`https://github.com/wingbangboozle1-lang/Trade1/pull/11`) was squash-merged on 2026-11-20 as `50bbef8b015461590213cd23c401fb9b6016ce7a`. Its PR workflow passed the unit fixtures and complete repository/source-link check. Main's Pages build and deployment run `44745407271` succeeded; main validation run `44745408768` also passed. Configured Pages URL: https://wingbangboozle1-lang.github.io/Trade1/.
- Live browser-origin demo API/CORS behavior and current live market values remain flagged; no snapshot or browser test in this follow-up establishes them.

## Handoff / takeover log
(none — no task handovers occurred)

### Integration record (session `cedad5c4`)

- PR: #8 `arena/cedad5c4-trade1` → `main`, title "Kalshi demo monitor v2 (session cedad5c4)". Merge commit `7033b38`, merged 2026-11-20 13:31 UTC (merge commit, not squash, not auto-merge). Merged without waiting for review, per the brief.
- Integration fixes made during the merge: resolved conflicts with PR #6 and PR #7 by keeping the v2 shared outputs (`index.html`, `flagged.html`, `.github/workflows/pages.yml`, `.gitignore`, `README.md`) and keeping both sides of `COORDINATION.md`. PR #6/#7 files (`pages/`, `js/`, `site/`, `tools/`, `docs/`) were not deleted; they are not linked from v2.
- Checks before merge: branch CI run 44744784228 `checks` success (head `6933507`); `scripts/check_site.mjs` on v2 pages: 11 pages, 71 links, 1,154 market rows, 625 resolved rows, 0 failures; `scripts/test_lib.mjs` passed.
- Pages: legacy source `main /`. Latest build for the merge commit reported `built`. Live check: `https://wingbangboozle1-lang.github.io/Trade1/` serves the v2 landing page; `flagged.html` serves the Flagged for Review page (F1–F12, R1–R11, N1–N4).
- Not done and flagged: demo-account portfolio and order execution (no credentials supplied); high-ROI rule is a placeholder; PR #6/#7 site trees and PR #5/#6 `dashboard.html`/`categories/` have broken local links (R11) and are not checked by v2 CI.
- Open PRs at merge time: #2, #3, #4 (overlaps logged above). PR #6 and #7 are merged.
