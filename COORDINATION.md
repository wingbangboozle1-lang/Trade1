# COORDINATION.md — Shared Task Board

Repo: `wingbangboozle1-lang/Trade1` (Kalshi demo dashboard)
Sessions: `session-0db174ef-trade1` (branch `arena/0db174ef-trade1`), `81cacf69` (merged via PR #5).

This is the shared task board. Each task has: id, status, owning session, and the files it touches.
Shared outputs (site index/navigation) are changed only by a final integration session once all
other tasks are done.

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
- [x] Merge conflict resolved (both sessions' work preserved)
- [x] PR #6 merged to `main`
- [ ] GitHub Pages deploy confirmed at https://wingbangboozle1-lang.github.io/Trade1/
- [ ] PR link + merge result recorded here
