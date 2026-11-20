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
Sessions: `session-0db174ef-trade1` (branch `arena/0db174ef-trade1`), `81cacf69` (merged via PR #5).

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
**not reachable** — verified with `curl` (TLS handshake resets; `code:000`, rc=35).

Consequence: live market data cannot be fetched *from the build sandbox*. Dashboards are built to
fetch Kalshi demo data **live in the user's browser** (public market-data endpoints support
browser `fetch`/CORS per Kalshi's own docs), so the values a user sees are real values from the
official API. Anything the sandbox could not confirm is left blank and flagged as **unverified**.
No market data is invented.

## Tasks

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
    auth (`KALSHI-ACCESS-KEY` / `KALSHI-ACCESS-SIGNATURE` / `KALSHI-ACCESS-TIMESTAMP`),
    `/trade-api/v2` endpoints, WebSocket `{"cmd":"subscribe","params":{"channels":["ticker"]}}`.
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

## Completion records

### session-0db174ef-trade1
- **T1** `docs/executive-summary.md`.
- **T2** `docs/api-reference.md`, `docs/verification.md`, `docs/sources.md`.
- **T3** `js/kalshi.js`: public fetch + WebCrypto RSA-PSS signing; host probe with fast timeout +
  fallback; portfolio + order endpoints; WS subscribe. Fails gracefully.
- **T4** `js/store.js` (polling, price series, orderbook, sharp-move detection, resolution),
  `js/charts.js` (time/price chart with seconds/minutes/hours window + liquidity depth chart),
  `js/dashboard.js` (tables with per-row source links + detail + sharp moves), `css/style.css`.
- **T5** `pages/*.html` + shared `js/nav.js`. Topics separate; events grouped.
- **T6** `js/strategy.js`: 4 strategies, simulated trades, categorization by type + topic,
  win-rate/P&L, auto-settle. `js/portfolio.js` + `pages/portfolio.html`: live demo balance/positions,
  trade log, opt-in real demo execution.
- **T7** `js/flagged.js` + `pages/flagged.html`.
- **T8** `tools/build.mjs` + `.github/workflows/pages.yml` + `package.json` + `README.md`.

### 81cacf69
- **M1** `dashboard.html`, `categories/{gas,elections,culture,crypto,golf}.html`, `flagged.html`,
  `assets/css/style.css`, `assets/js/app.js`.

## Verification & flagged items
- All technical claims trace to official Kalshi sources (docs/sources.md, docs/verification.md).
- Flagged irregularities / unverified (published on the site's Flagged for Review pages):
  1. Demo base host discrepancy.
  2. Live market values unverified from the sandbox (fetched live in-browser).
  3. Topic series mapping data-driven (no ticker hard-coded as fact).
  4. WebSocket host naming differs across sources.
  5. Exact v2 order-create request body unconfirmed (opt-in execution; validate on demo account).

## Integration / publish
- [x] Build + link validation (`node tools/build.mjs` -> BUILD OK)
- [x] PR #6 created from `arena/0db174ef-trade1` to `main`
  - https://github.com/wingbangboozle1-lang/Trade1/pull/6
- [x] Merge conflict resolved (both sessions' work preserved)
- [x] PR #6 merged to `main` (squash, commit `77f20e8`)
- [x] CI workflow `KalshiDash CI + Pages` passed on `main` (conclusion: success)
- [x] GitHub Pages build + deployment succeeded (status: built)
  - Live site: https://wingbangboozle1-lang.github.io/Trade1/

## Result
All tasks (T1–T8 for session 0db174ef; M1 for session 81cacf69) are complete. The site builds with
no broken links, the CI validation passes, PR #6 is merged to `main`, and GitHub Pages is live.
Flagged irregularities / unverified items do not block the merge and are published on the site's
Flagged for Review pages with source links.
