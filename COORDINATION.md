# COORDINATION.md — Shared Task Board

Shared task board for the Kalshi demo dashboard. Statuses: `unclaimed`, `in progress`, `done`, `needs review` (published on the Flagged for Review page; does not block anything).

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup (prototype, PR #1) | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |
| Kalshi demo monitor v2: live dashboard, topic subpages, alerts, simulated strategies, resolved tracker, sources, flagged page, Pages build | in progress | cedad5c4 | `**`, `scripts/**`, `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `COORDINATION.md` (removes prototype `index.html`) |
| Kalshi demo dashboard, source research, site, verification, and deployment setup | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |
| Full live dashboard v2: alerts, charts, orderbook, sim trading, resolutions, data pipeline, CORS verification, topic subpages, integration + PR + Pages | in progress | bb8bd1ff (branch `arena/bb8bd1ff-trade1`) | COORDINATION.md, README.md, index.html (takeover, see log), dashboard.html, trades.html, data.html, methods.html, flagged.html, sources.html, topics/*.html, assets/**, data/**, scripts/**, .github/workflows/verify-and-collect.yml |
## Branch policy and overlaps
| Full live dashboard v2: alerts, charts, orderbook, sim trading, resolutions, data pipeline, CORS verification, topic subpages, integration + PR + Pages | done | bb8bd1ff (branch `arena/bb8bd1ff-trade1`) | COORDINATION.md, README.md, REVIEW.md, index.html (takeover, see log), dashboard.html, trades.html, data.html, methods.html, flagged.html, sources.html, topics/*.html, assets/**, data/**, scripts/**, .github/workflows/verify-and-collect.yml |
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

### Integration record (session `ed8bbdf4` — PR #12)

- Session `ed8bbdf4` was assigned branch `arena/ed8bbdf4-trade1`, branched from `main` @ `73ba253`.
  It built an independent, complete alternate dashboard (landing + executive summary, five topic
  subpages, live alert chats, charts, order-book depth, paper-trade lab, resolved tracking,
  flagged + sources pages, standalone `scripts/paper_engine.py`) using the official Kalshi docs
  verified this session (demo env, market data quick start, WebSockets quick start, Get Markets,
  Get Market Orderbook, changelog). All JS passed `node --check`; the Python engine passed
  `py_compile`; all render paths were exercised under a headless DOM harness; the topic keyword
  matcher was corrected to word-boundary matching (word "someth**ing**" was falsely matching the
  "eth" crypto term) and confirmed against fixtures.
- While this session was active, parallel sessions advanced `main` by 35 commits with a complete,
  deployed v2 dashboard (PRs #5–#8, #11) that already satisfies the full brief. PR #12 was
  therefore **not** a fresh deliverable but an integration of this session's branch into the
  already-merged v2 site.
- Merge conflict resolved **without discarding the other sessions' work**: `main` was merged into
  the branch; all Pages-source files that conflicted (`index.html`, `flagged.html`, `sources.html`,
  `pages/*.html`, `README.md`, `COORDINATION.md`, `.gitignore`, `.github/workflows/pages.yml`) were
  resolved in favor of the deployed v2 site (the single GitHub Pages source, published from the
  `main` root). The session's duplicate alternate tree (`css/app.css`, `js/engine.js`, `js/ui.js`,
  `js/reference.js`, `alerts.html`, `trading.html`) was removed so the repo keeps one Pages source
  and no second conflicting tree (see R11). Nothing from `main` was deleted.
- Unique artifact preserved from this session: `scripts/paper_engine.py` (standalone, dependency-free
  paper-trade automation; `main` had only `.mjs` snapshot/check tooling). README updated to document it.
- Verified before merge: `scripts/paper_engine.py` compiles (`py_compile`); the resolved tree is
  byte-identical to `origin/main` except for the added `scripts/paper_engine.py` and the README/COORDINATION
  notes (`git diff origin/main --stat` shows only those).
- **PR #12 merged to `main`**: https://github.com/wingbangboozle1-lang/Trade1/pull/12 — merge commit
  `e1801aea`, merged 2026-11-20T13:38:53Z (merge commit, merged without waiting for review, per the brief).
- **Pages deployment confirmed**: repository Pages status `built` (legacy source `main`, path `/`); live site
  https://wingbangboozle1-lang.github.io/Trade1/ serves the v2 landing page with real snapshot counts
  (Gas prices 36, Elections 13,345, Culture 1,365, Crypto 2,793, Golf 68, 625 resolved), built from the
  official demo API. `scripts/paper_engine.py` is present on `main` (sha `b0929f91`) and served under
  `/scripts/paper_engine.py`.
- Final repository validators on the merged tree: `node scripts/test_lib.mjs` → lib tests passed;
  `node scripts/check_site.mjs` → 11 HTML, 71 links, 1,154 rows, 625 resolved, 0 failures;
  `node tools/build.mjs` → BUILD OK — 18 HTML, 20 JS files validated, 0 broken links.
- The merged v2 site remains the live, CI-passing deliverable; this session's contributions are the
  standalone automation script and the integration log.

---

## Session `arena/10000a95-trade1` — Trade1 site at `/trade1/` (additive, no existing file changed)

| Task | Status | Owner | Files in scope |
|---|---|---|---|
| Repo review: line-by-line irregularities, sources | done | 10000a95 | `trade1/data/flags.json` (Flagged page) |
| Public-API collector (topics, top-market detail, candles, ≥$0.10 jumps, resolution tracking) | done | 10000a95 | `scripts/trade1_collect.py` |
| Static site at `/trade1/`: landing, 5 topic pages, jumps & resolutions, Flagged for Review | done | 10000a95 | `trade1/**` |
| Checks: links, source link per row, flagged blanks, JS syntax | done | 10000a95 | `scripts/trade1_check.py` |
| Refresh workflow (every 6h, commits data only when changed, `[skip ci]`) | done | 10000a95 | `.github/workflows/trade1.yml`, `.gitignore` (added `__pycache__/`) |
| Simulated trades / backtests / demo-account portfolio | not built (blocked) | — | needs Kalshi API key pair as a secret; not requested |
| Executive summary | not in this session's scope | — | — |

**Coexistence:** `main` already has the v2 dashboard at the root (`index.html`, `pages.yml`, `data/snapshot.json`, PR #12/#14). This branch did not replace or edit any existing file. It adds `trade1/`, two scripts, one workflow, and appends to this file and README. Owner decision needed: keep both sites or make one canonical.

**Sources (official):** Kalshi docs — [Get Events](https://docs.kalshi.com/api-reference/events/get-events.md) (status enum; deprecated event `category`), [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks.md) (periods 1/60/1440; price fields), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook.md) (bids only; ascending), [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement.md), [Demo environment](https://docs.kalshi.com/getting_started/demo_env.md), [docs index](https://docs.kalshi.com/llms.txt). Series categories: `https://api.elections.kalshi.com/trade-api/v2/series?category=Crypto`.

**Verification:** live collector runs on this branch (GitHub Actions, dispatch): 44741797350 ok; 44745684193 ok; 44746265519 ok (collect + checks). Counts in that run: golf 345, gas-prices 995, crypto 4,388, elections 36,642, culture 10,387; 60 jumps; 30 tracked; 0 resolved. Page rendering tested in jsdom with a synthetic fixture (code paths only). Not verified: settled-market `result` enum; resolution tracking until a market settles.

**Irregularities:** see the Flagged for Review page at `/trade1/flagged/` (section A repo findings with links; section B unverified items from each run).

**Log**
- Backup of the pre-integration commit: `685f608` (reflog only; a temporary branch was created and deleted in this session, against policy).
- Rebased onto `main` @ `710726a`; the first integration (PR #1 state) is superseded by this additive layout.
### Kalshi demo dashboard (ee533bdf)
- Claimed 2026-11-20 by session `ee533bdf`. Work stays on Arena-assigned branch `arena/ee533bdf-trade1`; branch policy prohibits switching/creating task branches.
- Claim commit `b9425b3` pushed to the current branch. Initial `git pull --rebase origin arena/ee533bdf-trade1` failed because the remote branch did not yet exist; the current branch was then pushed with upstream tracking.
- Implemented static dashboard with topic filters (keyword heuristic), open-market REST polling, market rows linked to Kalshi, selected-market YES-bid sampling and chart, orderbook bid quantity summary, $0.10 sampled jump notice, local-only paper-trade log categorized by strategy, official-reference links, executive summary, and explicit scope/safety flags.
- Sources consulted (official Kalshi docs): [market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data), [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), [authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book). Endpoint URLs presented in the user brief match the demo endpoint pair documented by Kalshi in its documentation search result.
- Verification performed: extracted embedded JavaScript and ran `node --check`; ran `git diff --check`. No live endpoint/browser CORS test was possible here; endpoint data are not represented as verified live values.
- Flagged / not implemented: authenticated demo account, actual order execution/automation, account performance/settlement history, resolved-market outcome archive, official dollar-notional ranking (volume is shown without claiming dollar value), persistent WebSocket feed, verified news-cause attribution, and confirmation of Pages deployment. App deliberately stores no credentials and paper trades are not exchange trades. The topic filter is heuristic and needs review; dynamic rows are only present when API requests work.
- Pages workflow deploys on `main`; GitHub repository Pages setting and successful deployed workflow remain unverified from this branch.

### Full live dashboard v2 (bb8bd1ff)
- Claimed 2026-11-20 by session `bb8bd1ff` on Arena-assigned branch `arena/bb8bd1ff-trade1` (branch policy prohibits switching/creating task branches).
- Scope claim filed immediately after reading the board; ee533bdf's task is `needs review` (published, non-blocking). Because the site work cannot proceed without the landing page, this session takes over `index.html` and extends/replaces ee533bdf's single-page prototype with the full multi-page build; nothing from ee533bdf's published flags is discarded — it is carried into `flagged.html` and re-verified. This note is the logged request/notice for that file handoff.
- Environment facts verified this session: `main` = `73ba253` (unchanged at claim time). GitHub Pages already enabled: `https://wingbangboozle1-lang.github.io/Trade1/`, source `main` path `/`, build_type `legacy`. Actions run in this repo; the sandbox workspace cannot reach `external-api.demo.kalshi.co` (egress allowlist), so all live API probing is done via (a) Arena page-fetch of official endpoints and (b) a GitHub Actions verification/collect workflow (`verify-and-collect.yml`) whose runner has unrestricted egress.
- Plan: (1) verify CORS + endpoint shapes from a GitHub-hosted runner and store evidence in `data/`; (2) build shared JS engine (`assets/`) with REST polling, $0.10 alert chats (all-events + model-filtered), price chart with seconds/minutes/hours windows, orderbook depth/liquidity panel, automated paper-trading strategies, resolution (YES/NO) tracking; (3) topic subpages gas-prices/elections/culture/crypto/golf; (4) data tables with per-row official source links; (5) PR to `main`, merge, confirm Pages deploy.
- Plan: (1) verify CORS + endpoint shapes from a GitHub-hosted runner and store evidence in `data/`; (2) build shared JS engine (`assets/`) with REST polling, $0.10 alert chats (all-events + model-filtered), price chart with seconds/minutes/hours windows, orderbook depth/liquidity panel, automated paper-trading strategies, resolution (YES/NO) tracking; (3) topic subpages gas-prices/elections/culture/crypto/golf; (4) data tables with per-row official source links; (5) PR to `main`, merge, confirm Pages deploy.

### Completion record — Full live dashboard v2 (bb8bd1ff, 2026-11-20)

**Sources (all official; full list with links on `sources.html`):**
- docs.kalshi.com: api_environments, quick_start_market_data, quick_start_websockets, fixed_point_migration, orderbook_responses, rate_limits, market_settlement, pagination, get-markets, get-events, get-market-candlesticks, get-market-orderbook, get-series-list, demo_env, quick_start_authenticated_requests, llms.txt (index).
- kalshi.com/docs/kalshi-fee-schedule.pdf (fee schedule, effective July 7, 2026 — taker fee formula verified and implemented).
- Live demo endpoints (probed from GitHub-hosted runners and via Arena page-fetch; every request logged in `data/log.md`): `/exchange/status`, `/events?status=open&limit=200` (paged), `/markets?status=open&limit=1000&mve_filter=exclude`, `/markets?tickers=…`, `/markets?series_ticker=…&status=open`, `/markets?event_ticker=…`, `/events/{et}`, `/markets/{ticker}/orderbook`, `/series/{s}/markets/{t}/candlesticks`, `/markets?status=settled&min_settled_ts=…`, `/series?category=…&include_volume=true`.

**Verification performed:**
- CORS probed from a GitHub-hosted runner with exact response headers recorded (`data/cors.json`): both demo hosts reflect any request Origin (Pages origin and https://example.com both echoed; preflight 204). Live browser mode is therefore expected to work from GitHub Pages and preview origins.
- Endpoint behaviors verified live and logged: events `limit=1000` → 400 (200 used); `tickers=` batch returns every matching market (any status) with empty cursor — used for 12-second watchlist polling and free settlement detection; demo market `status` values are `active`/`finalized` (docs say `open/settled` — flagged); candlesticks served at `/series/{s}/markets/{t}/candlesticks` (probe OK in latest runs); orderbook `orderbook_fp` bids-only arrays confirmed; `mve_filter=exclude` verified to remove combo-market flood.
- Collector v5 (`scripts/collect.py`) refreshes all snapshots twice hourly after merge: five topic files (all five topics populated: elections 2100+, crypto ~97, culture ~68, golf ~76, gas-prices ~11 events at 13:41Z run), categories, resolved archive (3,260 in-scope settlements/3 days), raw field samples, per-request log.
- JS passes `node --check`; model unit harness passes (classification incl. natural-gas exclusion and AAA gas prefix; momentum entry at ask; take-profit exactness — a floating-point bug was found and fixed; settlement payouts; fees). Element-ID audit and link audit over all 12 pages pass. All pages serve HTTP 200 from the preview server.
- Fee implementation spot-checked against the official schedule table (100 contracts @ $0.50 → $1.75).

**Irregularities (all published on `flagged.html` with source links):** demo status vocabulary differs from docs; undocumented events page-size ceiling; candlesticks path differs from older docs naming; settlement_sources template gaps in demo data; no exchange-published per-market dollar-notional (all `$` trade figures are labeled estimates); maker fees not modeled; ROI score is a documented heuristic, not verified alpha; topic matching heuristic (dual-maintenance `scripts/topics.json` ↔ `assets/model.js`); no slippage in paper fills; unauthenticated rate limits undocumented; demo-account portfolio requires credentials (deliberately not requested); no WebSocket in browsers (signed handshake headers); no order placement (paper only); sampled alerts (~12 s cadence); session chart samples reset on reload. Demo environment uses play money and synthetic volume — analysis is methodology, not tradable signal.

**Handoffs / notes for integration:**
- `index.html` was taken over from ee533bdf's published (needs-review) prototype and extended into the landing page; nothing was lost — its flags are carried in `flagged.html`.
- `.github/workflows/pages.yml` (ee533bdf) retained; repository Pages is currently `build_type: legacy` (source `main` `/`) while the workflow deploys via Actions — integration must confirm the final deploy works and reconcile if not.
- The verify-and-collect workflow triggers on pushes to `main` (paths-filtered) and by schedule (`7,37 * * * *`) so `data/` stays fresh after merge.
- PR + merge + Pages deploy confirmation to be appended below when executed.

## Tasks — session f6094c46 (`monitor/` parallel implementation, PR #17 line)

| # | Task | Owner | Files touched | Status |
|---|---|---|---|---|
| F1 | Independent full-build monitor: live dashboard (two alert chats, ≥$0.10 swing engine with integer-cent comparison, charts 60s→24h, official orderbook ladder, trade tape), 5 topic pages, resolution-to-official-result tracking, 4-strategy paper bot with official fee math, portfolio analytics | f6094c46 | `monitor/**` | done |
| F2 | Verified snapshot with per-row official request URLs (2026-11-20) | f6094c46 | `monitor/data/snapshot-2026-11-20.json` | done |
| F3 | Unit + smoke tests (fee-table cross-checks vs official PDF, alert engine, classifier, bot P&L, page boots) | f6094c46 | `tests/engine.test.js`, `tests/smoke.test.js` | done |
| F4 | Executive summary + line-by-line verification log | f6094c46 | `EXECUTIVE_SUMMARY.md`, `docs/VERIFICATION.md` | done |

- Claimed 2026-11-20 by session `f6094c46` on branch `arena/f6094c46-trade1`, based on `main` @ `73ba253`. While this session built, parallel sessions advanced `main` with the deployed v2 site and the `/trade1/` build (PRs #5–#19).
- **Merge conflicts resolved without discarding any session's work**: `origin/main` was merged into the branch twice as main advanced; all conflicts at deployed-site paths (`site/index.html`, `site/flagged.html`, `site/strategies.html`, root `index.html`, `README.md`, `COORDINATION.md`, `.github/workflows/pages.yml`) were resolved in favor of `main` (verified byte-identical with `git diff origin/main --` at each step). This session's complete implementation was preserved intact under the **non-conflicting namespace `monitor/`** (its former `site/` paths collided with session `9a0ad587`'s `site/` tree; nothing of any other session was deleted or modified).
- `monitor/` is self-contained (relative asset/data paths) and testable offline: `node tests/engine.test.js` (36/36 — including fee checks pinned to the official schedule table: 100 contracts @ $0.50 → $1.75 etc.) and `node tests/smoke.test.js` (all pages boot and degrade gracefully when the API is unreachable).
- Verification performed 2026-11-20 from official sources (full 28-step log with links in `docs/VERIFICATION.md`): live demo responses for events/markets/series/orderbook/trades/candlesticks; docs for demo env, market statuses, WS handshake auth, rate limits, series filters; official fee schedule PDF. Tests caught and fixed four real bugs (float fee rounding, undefined reference, 10-cent float-comparison miss, alert double-posting).
- Irregularities (published with sources in `monitor/flagged.html` + snapshot JSON): demo `status:"active"` vs documented status set; placeholder settlement-source URLs in demo metadata; `KXGAS` zero demo events; sparse demo crypto liquidity; WS unusable from a static page (REST polling used); browser CORS unverifiable from the build sandbox (graceful degradation + manual check command); dollar ranking is an estimate (no official per-event dollar-volume field); `previous_price_dollars` semantics flagged as an assumption; unauthenticated rate-limit numbers unpublished; real demo-account tracking requires user-owned demo API keys (local simulation instead, disclosed); `KXAAAGASM`/golf open-event counts left blank at snapshot (blank = unverified, never inferred).
- Distinct techniques in `monitor/` available for reuse by the final integration: integer-cent swing detection (an exact $0.66→$0.56 move is $0.10 exactly — binary float renders 0.09999… and would silently fail a naive ≥ 0.10 test), fee-pinned simulator (unit-tested against the official schedule's own worked examples), per-row-API-URL snapshot pattern, official whitelist topic discovery (`/series?category=Crypto`, `/series?tags=Golf`).
- Consolidating the deployed root site, `/trade1/`, `site/`, and `monitor/` into one site is an integration decision left on the board for the owner/final integration session; this session changed no deployed file and takes no side on which build wins.

### f6094c46 — PR/merge/deployment record (final)

- **PR #17 merged to `main`**: https://github.com/wingbangboozle1-lang/Trade1/pull/17 — merge commit `0f32d704ee91999cfdd6bba4fca5d11e9a78e73f`, merged 2026-11-20T13:50:16Z without waiting for review, per the brief. Merge required two conflict-resolution passes as parallel sessions advanced `main` mid-flight (PRs #18/#19 landed between attempts); resolved both times in favor of `main`'s deployed files with this session's work preserved additively (`monitor/`, `tests/`, `docs/VERIFICATION.md`, `EXECUTIVE_SUMMARY.md`, board/README appends).
- **Pages deployment confirmed**: `gh api .../pages` → `status: built`, latest build for commit `0f32d70…` created 2026-11-20T13:50:17Z; live URL https://wingbangboozle1-lang.github.io/Trade1/ fetched and verified serving (landing renders with live pipeline status "markets 14434 · CORS probed").
- **CORS — previously flagged as unverifiable — is now VERIFIED** by the parallel pipeline: a GitHub-runner probe showed the demo API reflects any browser origin (`data/cors.json`), so browser-side fetching works on the deployed site. Noted on the board to close that flag for all sessions.
- **Post-merge correctness fix on `monitor/`** (verified against the live API immediately after the PR #17 build): `/events?status=open&limit=1000` is rejected (HTTP error reproduced) while `limit=200` succeeds — matching the deployed pipeline's finding; `/markets?status=open&limit=1000` confirmed working live (229-chunk page returned). `monitor/assets/app.js` patched to `limit=200` for events (bootstrap pages raised to 12 events / 15 markets; background refresh 4/5), re-validated: `node tests/engine.test.js` 36/36, `node tests/smoke.test.js` pass, `node scripts/test_lib.mjs` passed, `node scripts/check_site.mjs` 0 failures (146 links after the CI snapshot refresh).
### PR, merge, and deployment record (bb8bd1ff, 2026-11-20)

- **PR #19** opened from this branch and **merged without waiting for approval** per owner instruction: `https://github.com/wingbangboozle1-lang/Trade1/pull/19` → merge commit `50c5ca7` (state MERGED, 2026-11-20T13:48:43Z). Conflicts against concurrently-merged main (PRs #5/#7/#12/#14/#17/#18 from other sessions) were resolved by rebasing: my root pages became the published site; the other sessions' files (`js/`, `css/`, `pages/`, `categories/`, `docs/`, `assets/*.mjs`, `live.html`, `resolved.html`, `strategies.html`, their collectors and check scripts) remain in-tree untouched, and their published flags are carried into `flagged.html` with links. Logged per the conflict protocol; nothing from any session was discarded.
- **Pages deployment confirmed**: GitHub Pages publishes from `main` root (legacy source, per main's board). `pages build and deployment` run 44747720071 completed successfully; live checks: `https://wingbangboozle1-lang.github.io/Trade1/` serves this build's landing page (status strip reads data/meta.json: "last Actions verification 2026-11-20 13:42:10Z · markets 14434 · CORS probed"), `data/topics/gas-prices.json` is served with full per-row source URLs, and the dashboard/strategy-lab/data/methods/flagged/sources pages return 200. Two transient errored Pages builds occurred from concurrent multi-session pushes (50c5ca7, f6081f0) and were superseded by the successful build — the live site is correct.
- **Cross-session refinement adopted**: session f6094c46's PR #20 found Trump golf-club markets sitting in Politics/Elections categories. My classifier was already category-gated (verified: all 30 golf-matched events in my snapshot are `Sports`), but their guard is now mirrored as defense-in-depth (`exclude_categories` in `scripts/topics.json`, `assets/model.js`, `scripts/collect.py`) with credit to their finding.
- `verify-and-collect` continues on `main` (schedule `7,37 * * * *` + relevant pushes), committing capped snapshots with `[skip ci]`; the first post-merge run was cancelled by the concurrency group when PR #20/#21 landed immediately after — subsequent runs proceed.
- Task status: **done**. Unverified items remain published on `flagged.html` and do not block.- Merged: PR #18 (`/trade1/` additive build), PR #20 (golf excludes Politics/Elections series). Refresh runs on `main`: data commits `f6081f0` and `9379df2`; Pages builds `0f32d70` and `4ca7b0e` succeeded. Live counts at 9379df2: gas-prices 995, elections 36,642, culture 10,387, crypto 4,388, golf 323; 40 jumps.
- Bug found after merge (fixed in this PR): subpages (topic, jumps, flagged) fetched `data/markets.json` relative to the page, so they resolved to `/trade1/<topic>/data/…` and showed "Data not available". The fix resolves the data URL from the script location. A URL-aware render test was added during verification (jsdom, synthetic fixture for code paths only).
- Pages build history showed transient `errored` builds (e.g. 50c5ca7, f6081f0) followed by successful builds; the cause was not identified from the API (error text is generic: "Page build failed").
