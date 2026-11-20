# Coordination

Shared task board for the Kalshi demo dashboard. Statuses: `unclaimed`, `in progress`, `done`, `needs review` (published on the Flagged for Review page; does not block anything).

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup (prototype, PR #1) | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |
| Kalshi demo monitor v2: live dashboard, topic subpages, alerts, simulated strategies, resolved tracker, sources, flagged page, Pages build | in progress | cedad5c4 | `**`, `scripts/**`, `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `COORDINATION.md` (removes prototype `index.html`) |

## Branch policy and overlaps

- Session `cedad5c4` works only on its assigned branch `arena/cedad5c4-trade1`, branched from `main` at `73ba253`. The platform does not allow switching or pushing to other branches, so the `session-<id>/<task>` naming in the brief is not used.
- The remote has about 12 other `arena/*` branches from other sessions (for example `arena/08347343-trade1`, `arena/a2ec5543-trade1`, `arena/10000a95-trade1`, `arena/46259c0d-trade1`). Several of them claim the same files (`index.html`, `.github/workflows/pages.yml`, `site/`). **None of them were merged or edited by this session.** Their claim tables live on their own branches, not on `main`. See Flagged item R9. The owner needs to choose which branch becomes the integration target. Pull and merge decisions are not made by this session.

## Task log

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
- Branch CI: `pages.yml` runs `snapshot` (build + check) on the branch. Last successful run: 44743... see Actions. Checks: 71 links, 1,154 rows, 625 resolved rows, 0 failures.
