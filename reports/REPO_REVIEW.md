# Repo review — `wingbangboozle1-lang/Trade1`

Task T1 · Session `a2ec5543` · Checked 2026-11-20 (UTC) · Branch `arena/a2ec5543-trade1` · `origin/main` at `e1801ae` (moved during this session; see R16).

Each finding names the file or command that shows it and an official or verifiable link where one exists. Items marked **Unverified** could not be confirmed from an official source in this run and are left for manual review.

## 1. What the repository contains

| Ref | Contents | Notes |
|---|---|---|
| `dafd3bc` (base assigned to the session) | `README.md` only (8 bytes, `# Trade1`, no trailing newline) | Single commit "Initial commit". |
| `73ba253` (first prototype on main, PR #1, `ee533bdf`) | `README.md`, `COORDINATION.md`, `index.html`, `.github/workflows/pages.yml` | Historical. |
| `origin/main` at `e1801ae` (current) | Live site from several merged sessions: root `index.html`, `dashboard.html`, `categories/`, `flagged.html`, `live.html`, `pages/`, `js/`, `css/`, `assets/`, `site/` (another session's tree), `docs/`, `data/snapshot.json`, `scripts/build_snapshot.mjs`, `scripts/paper_engine.py`, `tools/build.mjs`, `.github/workflows/pages.yml` | Merged via PRs #7–#13. `COORDINATION.md` lists the claims. |
| This branch | Adds `scripts/` (pipeline), `config/`, `site/assets` and `site/pages` fragments, `reports/`, `.github/workflows/site.yml`, and `probe/` outputs | The prototype `index.html` and `pages.yml` deletions were reverted during the merge with `origin/main`. |

Verification commands used: `git log --oneline origin/main`, `git show origin/main:<path>`, `git diff --stat <base> origin/main`, `gh api repos/wingbangboozle1-lang/Trade1/pages`, `gh api repos/wingbangboozle1-lang/Trade1/actions/runs`.

## 2. Findings

Severity: **High** = could publish wrong or misleading data, overwrite another session's work, or expose internal files · **Medium** = likely to cause errors or confusion · **Low** = housekeeping · **Info** = confirmed, no action needed.

| # | Sev. | Finding | Evidence | Link for manual review |
|---|---|---|---|---|
| R1 | High (historical, fixed on main) | The **`73ba253` prototype** `pages.yml` uploaded the whole repository root (`path: .`), so internal files (`COORDINATION.md`, scripts, workflows) would be published. The current `origin/main` `pages.yml` has no upload step (grep for `upload-pages-artifact` and `path:` finds nothing), so this no longer applies on `main`. | `git show 73ba253:.github/workflows/pages.yml` line 24 `path: .`; `git show origin/main:.github/workflows/pages.yml` (no upload step) | [Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) |
| R2 | High | Repository Pages is **legacy, branch `main`, path `/`**. The Actions build type was rejected with HTTP 403 with the available token (recorded by session `cedad5c4` in `COORDINATION.md`). This session's `site.yml` therefore cannot deploy through `actions/deploy-pages`. Its `deploy` job was removed; the site is published by committing `monitor/` to `main` with `[skip ci]`. | `gh api repos/wingbangboozle1-lang/Trade1/pages` → `build_type: legacy`, `source: {branch: main, path: /}`, `html_url: https://wingbangboozle1-lang.github.io/Trade1/` | [Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) |
| R3 | Medium (corrected) | **Deploy-run history.** In the most recent 100 Actions runs (checked 2026-11-20), runs named "Deploy static dashboard to GitHub Pages" appear only on `main` (2 runs, both success). Earlier runs were seen on `arena/10000a95-trade1` and `arena/46259c0d-trade1`, but they are outside the most recent 100 and their number is **Unverified**. The earlier draft of this finding said four branches; that was wrong. | `gh api "repos/wingbangboozle1-lang/Trade1/actions/runs?per_page=100" --paginate` | [Actions runs](https://github.com/wingbangboozle1-lang/Trade1/actions) |
| R4 | Medium | Workflow names are mixed across sessions. The workflow file `.github/workflows/probe.yml` is registered by GitHub as **"probe-api"**, and `pages.yml` on other branches is registered as "Deploy static dashboard to GitHub Pages". | `gh workflow list` / `gh api repos/wingbangboozle1-lang/Trade1/actions/workflows` | [Actions workflows](https://github.com/wingbangboozle1-lang/Trade1/actions) |
| R5 | Medium (historical, prototype) | The prototype's topic match was a **substring keyword heuristic**: `gas` also matches inside `Vegas`. | `git show 73ba253:index.html`, function `match()` | — |
| R6 | Medium (historical, prototype) | The prototype requested one page of 1,000 open markets with no cursor loop, although the docs say to follow `cursor` until it is empty. | `git show 73ba253:index.html` (`limit=1000`, no cursor); [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| R7 | Medium | The prototype's market link pattern `https://kalshi.com/markets/{event_ticker}` does **not** appear in any official Kalshi document read in this run. | `git show 73ba253:index.html` | **Unverified.** This site links to the official API record and to the contract-terms PDF instead. |
| R8 | Medium | The official API has no 24-hour **dollar** volume field. `volume_fp` and `volume_24h_fp` are contract counts. The prototype ranked by `volume_fp` while the brief asks for dollar volume. | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) (`volume_fp`, `volume_24h_fp` are contracts); `scripts/build_site.py` `est_24h_usd` | Site shows a labelled derived estimate (contracts × last price). See METHODOLOGY. |
| R9 | Low | `README.md` on `main` described the Pages setup. Its wording must match the legacy source (`main` `/`). | `git show origin/main:README.md` | — |
| R10 | Low (corrected) | `actions/checkout@v4` and `actions/setup-python@v5` run on Node.js 20. The earlier draft cited a GitHub changelog page and a run annotation as evidence. Neither was fetched or read in this run. | — | **Unverified.** Not fetched; no claim made. |
| R11 | Low | No `LICENSE` file on `main`. Tests exist only as `scripts/test_lib.mjs` and `scripts/check_site.mjs` on `main`. | `git ls-tree -r --name-only origin/main` | — |
| R12 | Low | `README.md` on the base commit `dafd3bc` has no trailing newline. | `git show dafd3bc:README.md \| wc -c` = 8 | — |
| R13 | Info | Demo endpoints in the brief match Kalshi's documented demo endpoints: REST `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2`. | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Verified. |
| R14 | Info | Demo and production credentials are separate. No API key was provided, so demo account tracking and order execution are **blocked**. No credential was requested or stored. | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Flagged. |
| R15 | Info | The brief asks for portfolio tracking and trade execution on the demo account. Those endpoints need authentication. This branch does not contain credential handling. Simulated trades are labelled as paper trades. | — | Flagged. |
| R16 | High | **`origin/main` changed during this session.** At the start it was `73ba253`; it is now `e1801ae`, which contains merged work from other sessions (PRs #7–#13). This branch was merged with `origin/main` on 2026-11-20. Conflicts in `index.html`, `.github/workflows/pages.yml` and `COORDINATION.md` were resolved by keeping `main`'s live versions. | `git log --oneline origin/main`; `git merge origin/main` on this branch | [PR #4](https://github.com/wingbangboozle1-lang/Trade1/pull/4) |
| R17 | Medium | Two session site trees exist on `main`: root pages and a `site/` tree from another session. This branch adds a `site/assets` and `site/pages` tree without overwriting them, but this is confusing for readers. | `git ls-tree -r --name-only origin/main site/` | Logged in `COORDINATION.md`. |
| R18 | Medium | Committed generated data grows with each run. `data/snapshot.json` on `main` is about 1.6 MB and is rewritten by the schedule. This branch's `monitor/` output is capped at 300 rows per topic to limit growth. Each commit still adds a full copy. | `git show origin/main:data/snapshot.json \| wc -c`; `git log --stat -- data/snapshot.json` | Logged in `COORDINATION.md`. |
| R19 | Medium | `pages.yml` on `main` runs `tools/build.mjs` and `scripts/check_site.mjs` on every push and PR. Those checks cover the root site. This branch's `site.yml` runs its own checks on `monitor/`, so the two check sets are separate. | `git show origin/main:.github/workflows/pages.yml` | — |
| R20 | Info | This review's earlier draft had R3 (four branches), R7 and R10 wrong or unsourced. Corrected above. | — | — |

## 3. Things checked and found consistent

- `node --check` on this branch's `site/assets/app.js` passes (session run).
- `scripts/build_site.py` runs end to end in CI (run `44743945798` on the branch, job `build` success; check step success).
- `site.yml` parses as YAML.

## 4. Requests logged for other sessions

- Sessions with open PRs that touch `index.html`, `pages.yml`, `README.md`, or `COORDINATION.md` (R16): rebase on `main` before merging. This session kept `main`'s versions of those files.
- Pages source: keep one source (legacy `main` `/`). Do not add a second deploy path. (R2)

## 5. Manual review links

- Repository: https://github.com/wingbangboozle1-lang/Trade1
- Live site: https://wingbangboozle1-lang.github.io/Trade1/ (root, other sessions) and `/monitor/` (this session, after publish)
- Actions runs: https://github.com/wingbangboozle1-lang/Trade1/actions
- Kalshi API docs index: https://docs.kalshi.com/llms.txt
