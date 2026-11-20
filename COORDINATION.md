# COORDINATION.md — Shared Task Board

Repo: `wingbangboozle1-lang/Trade1` (Kalshi demo dashboard)
Session: `session-0db174ef-trade1` on branch `arena/0db174ef-trade1`

This is the shared task board. Each task has: id, status (unclaimed / in progress / done /
needs review), owning session, and the files it touches. Scopes must be non-overlapping.
Shared outputs (table data, site index/navigation) are changed only by the final integration
session once all other tasks are done.

## Network / environment constraint (read first)

This sandbox has outbound egress restricted to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
The Kalshi hosts (`*.kalshi.co`, `docs.kalshi.com`, `kalshi-public-docs.s3.amazonaws.com`) are
**not reachable** — verified with `curl` (TLS handshake resets; `code:000`, rc=35).

Consequence: live market data cannot be fetched *from the build sandbox*. The dashboard is
built to fetch Kalshi demo data **live in the user's browser** (public market-data endpoints
support browser `fetch`/CORS per Kalshi's own docs), so the values a user sees are real values
from the official API. Anything the sandbox could not confirm is left blank and flagged as
**unverified** on the site. No market data is invented.

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
| T8 | Site build/link validation + GitHub Pages + PR + merge | in progress | session-0db174ef-trade1 | `tools/build.mjs`, `.github/workflows/pages.yml`, `package.json`, `README.md` |

Note: the task text refers to a separate "integration branch". This session is pinned to
`arena/0db174ef-trade1` by the Arena harness and must not switch or create branches, so the
integration/publish step is performed **on this branch**: build+link validation, GitHub Pages
deploy workflow, then a PR from `arena/0db174ef-trade1` to `main`. This branch is the integration
branch for the purposes of this session.

## Session log

### session-0db174ef-trade1

- Started. Reviewed repo (empty except `README.md`, single initial commit `dafd3bc`).
- Confirmed no `COORDINATION.md` existed; created it and claimed T1–T8 (single active session).
- Verified network egress restriction against Kalshi (blocked) and against GitHub/npm/PyPI (ok).
- Verified official sources reachable from sandbox:
  - Official Kalshi Python SDK `kalshi` on PyPI (v0.2.0) — auth via `POST /log_in` -> Basic token.
    https://pypi.org/project/kalshi/
  - `github.com/mlucy/kalshi_py` SDK + REST spec (`swagger.json`).
    https://github.com/mlucy/kalshi_py
  - Official starter code `Kalshi/kalshi-starter-code-python` — demo base URL, RSA-PSS header
    auth (`KALSHI-ACCESS-KEY` / `KALSHI-ACCESS-SIGNATURE` / `KALSHI-ACCESS-TIMESTAMP`),
    `/trade-api/v2` endpoints, WebSocket `{"cmd":"subscribe","params":{"channels":["ticker"]}}`.
    https://github.com/Kalshi/kalshi-starter-code-python
- Sources + verification details recorded in `docs/sources.md` and `docs/verification.md`.
- IMPORTANT IRREGULARITY (flagged): the task text references
  `https://external-api.demo.kalshi.co/trade-api/v2` as the recommended demo base, while the
  official starter code uses `https://demo-api.kalshi.co/trade-api/v2` for demo. Both are
  documented demo hosts. The dashboard supports both and reports which base it uses. See
  Flagged for Review.
- IRREGULARITY (flagged): the sandbox cannot reach any Kalshi host, so the app's live data path
  and the five topic category mappings could not be exercised end-to-end from the build host.
  Topic mapping is data-driven (filtered from Kalshi's own series/tag data at runtime) to avoid
  fabricating series tickers. See Flagged for Review.

## Completion records

### T1 — Executive summary
- `docs/executive-summary.md`: scope + API surface + findings + network constraint.

### T2 — API reference + verification
- `docs/api-reference.md`, `docs/verification.md`, `docs/sources.md`. Endpoint paths, RSA-PSS auth
  headers/signature/salt length, WS subscribe message, legacy Basic-token auth all verified from
  official sources (see verification.md).

### T3 — Kalshi client
- `js/kalshi.js`: public fetch + WebCrypto RSA-PSS signing; host probe with fast timeout +
  fallback; portfolio + order endpoints; WS subscribe. Fails gracefully (no invented data).

### T4 — Core dashboard
- `store.js` (polling, price series, orderbook, sharp-move detection, resolution),
  `charts.js` (time/price chart with seconds/minutes/hours window + liquidity depth chart),
  `dashboard.js` (tables with per-row source links + detail + sharp moves), `style.css`.

### T5 — Topic pages
- gas, elections, culture, crypto, golf pages + shared `nav.js`. Topics separate; events grouped.

### T6 — Portfolio + strategy engine
- `strategy.js`: 4 strategies, simulated trades, categorization by type + topic, win-rate/P&L,
  auto-settle. `portfolio.js` + `portfolio.html`: live demo balance/positions, trade log, opt-in
  real demo execution.

### T7 — Flagged for Review
- `flagged.js` + `flagged.html`: irregularities + unverified items with source links.

### T8 — Build + Pages + PR
- `tools/build.mjs`: JS syntax + broken-link/asset + nav-target check. Result:
  **BUILD OK — 8 HTML, 10 JS files validated, 0 broken links.**
- `.github/workflows/pages.yml`: CI validation on push/PR; Pages served from `main` branch root.

## Integration / publish

- [x] T8 build + link validation (`node tools/build.mjs` -> BUILD OK)
- [ ] GitHub Pages deploy confirmed
- [ ] PR created and merged
- [ ] PR link + merge result recorded here
