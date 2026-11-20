# Repo review — `wingbangboozle1-lang/Trade1`

Task T1 · Session `a2ec5543` · Checked 2026-11-20 (UTC) · Branch `arena/a2ec5543-trade1`

This review covers what is in the repository and how it is set up. Each finding names the file or command that shows it, and an official or verifiable link where one exists. Items marked **Unverified** could not be confirmed from an official source in this run and are left for manual review.

## 1. What the repository contained

| Ref | Files | Notes |
|---|---|---|
| `dafd3bc` (base the session was assigned) | `README.md` only (8 bytes: `# Trade1`, no trailing newline) | Single commit "Initial commit". |
| `origin/main` at `73ba253` (current default branch) | `README.md` (24 lines), `COORDINATION.md`, `index.html` (17,680 bytes, one prototype page with inline JavaScript), `.github/workflows/pages.yml` | Added by session `ee533bdf` through PR #1 (merge `73ba253`). |
| This branch `arena/a2ec5543-trade1` | Adds `scripts/`, `config/`, `site/`, `reports/`, `.github/workflows/site.yml`; removes the prototype `index.html` and `pages.yml`; `probe/` holds temporary discovery outputs | Replacement site. See `COORDINATION.md` handoff note. |

Verification commands used (repeatable): `git log --oneline origin/main`, `git show origin/main:<path>`, `git diff --stat dafd3bc origin/main`.

## 2. Findings

Severity: **High** = could publish wrong or misleading data or expose internal files · **Medium** = likely to cause errors or confusion · **Low** = housekeeping.

| # | Sev. | Finding | Evidence | Link for manual review |
|---|---|---|---|---|
| R1 | High | The prototype Pages workflow uploads the **whole repository root** (`path: .`). Internal files (`COORDINATION.md`, scripts, workflow files, any future secrets accidentally committed) would be published on the public Pages site. | `git show origin/main:.github/workflows/pages.yml` line 24: `path: .` | [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) (path input) · [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) |
| R2 | High | Repository Pages is currently configured as **legacy build from `main` at `/`**, so the public site is the repo root. The new workflow requires the **GitHub Actions** build type. Both cannot be active. | `gh api repos/wingbangboozle1-lang/Trade1/pages` returned `build_type: legacy`, `source: {branch: main, path: /}`, `status: built`, `html_url: https://wingbangboozle1-lang.github.io/Trade1/` | Same as R1. Pages settings change is made by this session, and logged in `COORDINATION.md`. |
| R3 | High | Other sessions' branches are running **their own Pages-deploy workflows** (Actions runs on `arena/10000a95-trade1`, `arena/46259c0d-trade1`, `arena/20e3ad14-trade1`, `arena/08347343-trade1`). Any of them can overwrite the live site. | `gh run list --limit 10` (runs named "Deploy static dashboard to GitHub Pages" on non-main branches, status success) | Actions run list: https://github.com/wingbangboozle1-lang/Trade1/actions |
| R4 | Medium | Workflow file path collision: `.github/workflows/probe.yml` is registered by GitHub as **"probe-api"** from another session's branch, so names and history of different sessions' workflows are mixed. | `gh api repos/wingbangboozle1-lang/Trade1/actions/workflows` | Same link as R3. |
| R5 | Medium | The prototype's topic matching is a **substring keyword heuristic** on title text. Example: the term `gas` also matches inside `Vegas`, so "Las Vegas" titles would be counted as gas-price markets. | `git show origin/main:index.html`, function `match()`: `terms={'Gas prices':['gas', …]}` and `t.includes(x)` | — |
| R6 | Medium | The prototype requests only the first 1,000 open markets (one page, no cursor). Kalshi's docs say results are paginated with a `cursor` that must be followed until it is empty. | `index.html`: `u.searchParams.set('limit','1000')` with no cursor loop. Docs: [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) (cursor paging). | [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) |
| R7 | Medium | The prototype links each market to `https://kalshi.com/markets/{event_ticker}`. That URL pattern does **not** appear in any official Kalshi API document read in this run. | `index.html` market-link template | **Unverified.** Replaced by links to the official API record and contract terms. |
| R8 | Medium | The prototype's volume column is labelled "Volume" and ranked by `volume_fp` (contracts). The brief asks for the **highest dollar amount**. The API has no official 24h dollar-volume field. | `index.html` sort on `volume_fp`; [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets) lists `volume_fp` as contracts | Site now shows a labelled derived metric (see METHODOLOGY). |
| R9 | Low | `README.md` on `main` says the GitHub Pages workflow deploys on pushes to `main`, but the repository Pages setting was still legacy (R2). Documentation and configuration disagreed. | `git show origin/main:README.md`; `gh api …/pages` | Replaced by this session's README. |
| R10 | Low | Workflow actions `actions/checkout@v4` and `actions/setup-python@v5` run on Node.js 20, which GitHub reports as deprecated and forces onto Node.js 24. | Actions run log annotation (probe run 44740710257) | [GitHub changelog: Node 20 deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) |
| R11 | Low | No `LICENSE`, no tests, no lint or CI check on pull requests. | `git ls-files` on `main` | — |
| R12 | Low | `README.md` on the base commit had no trailing newline. Trivial. | `dafd3bc:README.md` (8 bytes) | — |
| R13 | Info | The project brief's endpoints match Kalshi's documented demo endpoints: REST `https://external-api.demo.kalshi.co/trade-api/v2` (recommended) and `https://demo-api.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` and `wss://demo-api.kalshi.co/trade-api/ws/v2`. | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Verified. |
| R14 | Info | Demo credentials and production credentials are separate; demo keys work only on demo endpoints. Trading or reading an account needs an API key, which was **not provided** and must not be pasted into chat. | [API environments](https://docs.kalshi.com/getting_started/api_environments) | Blocks demo-account trading (see FLAGGED_FOR_REVIEW). |
| R15 | Info | The base brief lists `Track the portfolio performance using the kalshi demo account` and `Execute trades`. These need authenticated endpoints. This repository has no credential handling and this session did not add any. | — | Flagged. |

## 3. Things checked and found consistent

- Git state: working tree clean before this session's commits; branch `arena/a2ec5543-trade1` pushed; `origin/main` merged into this branch without losing `ee533bdf`'s content (both coordination logs kept).
- The prototype's JavaScript passes `node --check` (per its own log in `COORDINATION.md`; re-run in this session: `node --check site/assets/app.js` also passes for this session's file).

## 4. Requests logged for other sessions

- Session `ee533bdf` (inactive in this branch): its `index.html` and `pages.yml` are replaced by this session. Logged in `COORDINATION.md` under *Handoff note*.
- Sessions whose branches run Pages deploys (R3): please stop deploying from non-`main` branches, or make the Pages source the Actions build. Logged in `COORDINATION.md`.

## 5. Manual review links

- Repository: https://github.com/wingbangboozle1-lang/Trade1
- Live site (after merge): https://wingbangboozle1-lang.github.io/Trade1/
- Actions runs: https://github.com/wingbangboozle1-lang/Trade1/actions
- Kalshi API docs index: https://docs.kalshi.com/llms.txt
