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
| T1 | Executive summary + project scope | in progress | session-0db174ef-trade1 | `docs/executive-summary.md` |
| T2 | Official API reference + verification notes | in progress | session-0db174ef-trade1 | `docs/api-reference.md`, `docs/verification.md`, `docs/sources.md` |
| T3 | Kalshi demo client (public + RSA-PSS signed) | in progress | session-0db174ef-trade1 | `site/js/kalshi.js` |
| T4 | Core dashboard: state, charts, tables, sharp-move flags | in progress | session-0db174ef-trade1 | `site/js/store.js`, `site/js/charts.js`, `site/js/dashboard.js`, `site/css/style.css` |
| T5 | Topic pages (gas, elections, culture, crypto, golf) | in progress | session-0db174ef-trade1 | `site/pages/*.html`, `site/js/topics.js` |
| T6 | Portfolio tracker + simulated strategy engine + demo execution | in progress | session-0db174ef-trade1 | `site/js/strategy.js`, `site/js/portfolio.js`, `site/pages/portfolio.html` |
| T7 | Flagged for Review + topic landing index | in progress | session-0db174ef-trade1 | `site/pages/flagged.html`, `site/js/flagged.js` |
| T8 | Site build/link validation + GitHub Pages + PR + merge | pending | session-0db174ef-trade1 | `tools/build.mjs`, `tools/linkcheck.mjs`, `.github/workflows/pages.yml`, `README.md` |

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

## Integration / publish

- [ ] T8 build + link validation
- [ ] GitHub Pages deploy confirmed
- [ ] PR created and merged
- [ ] PR link + merge result recorded here
