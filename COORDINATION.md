# COORDINATION.md — Shared Task Board

Repo: `wingbangboozle1-lang/Trade1` (Kalshi demo dashboard)
Sessions: `session-0db174ef-trade1` (branch `arena/0db174ef-trade1`), `81cacf69` (merged via PR #5),
`sess-a1-9a0ad587` (branch `arena/9a0ad587-trade1`, merged via PR #7).

This is the shared task board. Each task has: id, status, owning session, and the files it touches.
Shared outputs (site index/navigation) are changed only by a final integration session once all
other tasks are done.

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
- Merged PR #7 into `main`, confirmed the Pages build completes and the site responds (see final log entry).

## Handoff / takeover log
(none — no task handovers occurred)
