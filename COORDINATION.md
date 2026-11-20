# COORDINATION — shared task board

Repo: `wingbangboozle1-lang/Trade1` · Original base: `main` @ `dafd3bc` · Branch for this session: `arena/a2ec5543-trade1`

Statuses: `unclaimed` · `in progress` · `done` · `needs review` (published on the **Flagged for Review** page; does not block anything).

Branch policy: the platform fixes each session to one branch, so the `session-<id>/<task>` naming in the brief is replaced by the assigned branch. Non-overlapping file scopes are still enforced per task below.

## Task board

| ID | Task | Status | Owner session | File scope |
|----|------|--------|---------------|-----------|
| T1 | Repo review (line-by-line, official sources, irregularities) | in progress | a2ec5543 | `reports/REPO_REVIEW.md` |
| T2 | Official-source verification of Kalshi API, endpoints, field semantics | in progress | a2ec5543 | `config/sources.json`, `reports/API_VERIFICATION.md` |
| T3 | Market data pipeline (official Kalshi demo REST → JSON) | in progress | a2ec5543 | `scripts/`, `config/topics.json` |
| T4 | Static GitHub Pages site: landing + category subpages + tables + charts | in progress | a2ec5543 | `site/`, `index.html`, `.github/workflows/site.yml` |
| T5 | Simulated strategy backtests + trade categorisation | in progress | a2ec5543 | `scripts/backtest.py`, `reports/STRATEGY_BACKTEST.md` |
| T6 | Executive summary + Flagged for Review page | in progress | a2ec5543 | `reports/EXECUTIVE_SUMMARY.md`, `site/flagged/` |
| T7 | Integration: build, link check, Pages deploy, PR to `main`, merge | in progress | a2ec5543 | `README.md`, this file |
| T0 | Prototype dashboard (session `ee533bdf`, merged via PR #1) | needs review | ee533bdf | `COORDINATION.md`, `README.md`, `index.html`, `.github/workflows/pages.yml` |

### Handoff note (a2ec5543)

Session `ee533bdf` merged a single-page client-side prototype to `main` (PR #1, merge `73ba253`) and marked its task `needs review`. Per the brief, `needs review` does not block other work, but the brief also requires the site to be reorganised into a landing page with category subpages. This session therefore **takes over** `index.html`, `README.md`, and `.github/workflows/pages.yml` for T4/T7. The prototype stays in git history (`a3fd0e5`, `73ba253`). Its flagged items (heuristic topic matching, volume shown as contracts, browser-only sampling, no news attribution, no authenticated trading) are carried into the Flagged for Review page. Session `ee533bdf` is not active in this branch; if it resumes, please log any conflicting change here rather than editing these files.

## Session log

- **a2ec5543** — claimed T1–T7 at session start (commit `1c37920`). Probe workflow added to read official category/series lists (`976a031`). Merged `origin/main` (PR #1 prototype) and took over the site files per the handoff note above.

## Sources (log)

See `config/sources.json` for URLs, the date each was checked, and what was verified. Primary official sources:

- Kalshi API documentation at `docs.kalshi.com` — environments, Get Markets, Get Events, Get Market Candlesticks, Get Market Orderbook, Historical Data, Fixed-Point Representation, Rate Limits, WebSocket authentication, Market Settlement.
- Kalshi demo REST API `external-api.demo.kalshi.co/trade-api/v2` — public unauthenticated GET endpoints only.

## Irregularities / flagged items

Published on the **Flagged for Review** page of the site and listed in `reports/`.

---

## Log from prior session (verbatim from `origin/main`, session `ee533bdf`)

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |

### Task log (ee533bdf)

### Kalshi demo dashboard
- Claimed 2026-11-20 by session `ee533bdf`. Work stays on Arena-assigned branch `arena/ee533bdf-trade1`; branch policy prohibits switching/creating task branches.
- Claim commit `b9425b3` pushed to the current branch. Initial `git pull --rebase origin arena/ee533bdf-trade1` failed because the remote branch did not yet exist; the current branch was then pushed with upstream tracking.
- Implemented static dashboard with topic filters (keyword heuristic), open-market REST polling, market rows linked to Kalshi, selected-market YES-bid sampling and chart, orderbook bid quantity summary, $0.10 sampled jump notice, local-only paper-trade log categorized by strategy, official-reference links, executive summary, and explicit scope/safety flags.
- Sources consulted (official Kalshi docs): [market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data), [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), [authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book). Endpoint URLs presented in the user brief match the demo endpoint pair documented by Kalshi in its documentation search result.
- Verification performed: extracted embedded JavaScript and ran `node --check`; ran `git diff --check`. No live endpoint/browser CORS test was possible here; endpoint data are not represented as verified live values.
- Flagged / not implemented: authenticated demo account, actual order execution/automation, account performance/settlement history, resolved-market outcome archive, official dollar-notional ranking (volume is shown without claiming dollar value), persistent WebSocket feed, verified news-cause attribution, and confirmation of Pages deployment. App deliberately stores no credentials and paper trades are not exchange trades. The topic filter is heuristic and needs review; dynamic rows are only present when API requests work.
- Pages workflow deploys on `main`; GitHub repository Pages setting and successful deployed workflow remain unverified from this branch.
