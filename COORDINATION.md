# Coordination

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup | needs review | ee533bdf | COORDINATION.md, README.md, index.html, .github/workflows/pages.yml |

## Task log

### Kalshi demo dashboard
- Claimed 2026-11-20 by session `ee533bdf`. Work stays on Arena-assigned branch `arena/ee533bdf-trade1`; branch policy prohibits switching/creating task branches.
- Claim commit `b9425b3` pushed to the current branch. Initial `git pull --rebase origin arena/ee533bdf-trade1` failed because the remote branch did not yet exist; the current branch was then pushed with upstream tracking.
- Implemented static dashboard with topic filters (keyword heuristic), open-market REST polling, market rows linked to Kalshi, selected-market YES-bid sampling and chart, orderbook bid quantity summary, $0.10 sampled jump notice, local-only paper-trade log categorized by strategy, official-reference links, executive summary, and explicit scope/safety flags.
- Sources consulted (official Kalshi docs): [market data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data), [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets), [authenticated request guide](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book). Endpoint URLs presented in the user brief match the demo endpoint pair documented by Kalshi in its documentation search result.
- Verification performed: extracted embedded JavaScript and ran `node --check`; ran `git diff --check`. No live endpoint/browser CORS test was possible here; endpoint data are not represented as verified live values.
- Flagged / not implemented: authenticated demo account, actual order execution/automation, account performance/settlement history, resolved-market outcome archive, official dollar-notional ranking (volume is shown without claiming dollar value), persistent WebSocket feed, verified news-cause attribution, and confirmation of Pages deployment. App deliberately stores no credentials and paper trades are not exchange trades. The topic filter is heuristic and needs review; dynamic rows are only present when API requests work.
- Pages workflow deploys on `main`; GitHub repository Pages setting and successful deployed workflow remain unverified from this branch.

## Session 20e3ad14 (branch `arena/20e3ad14-trade1`)

Branch base: `origin/main` @ `73ba253` (includes PR #1 from `ee533bdf`). Claimed 2026-11-20 (UTC).

### Board observation (read-only, from other `arena/*` branches)
Other active sessions on separate branches (`08347343`, `455111c5`, `46259c0d`, `98f1c044`, `a2ec5543`) list overlapping claims for repo review, collector, site, paper trading, and integration. Their claims are not on `main` and conflict with each other (for example, the repo-review claim appears in both `46259c0d` and `a2ec5543`). This session does **not** take those tasks. To avoid duplicate work, this session only claims the gap that no branch currently claims: the authenticated demo account track. The board should name one integration owner before anything is merged to `main`.

| ID | Task | Status | Owner (session) | File scope |
|---|---|---|---|---|
| T-DEMO | Demo account track: authenticated read-only snapshot (balance, positions, fills), signing helper, guarded demo order executor (dry-run by default), scheduled workflow | in progress | 20e3ad14 | `scripts/demo_account/**`, `.github/workflows/demo-account.yml`, `data/demo_account/**` |

### Task T-DEMO: sources used (official)
- [Authenticated requests quick start](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests) (headers, signing string `timestamp+METHOD+path`, RSA-PSS SHA-256 / Ed25519)
- [API keys](https://docs.kalshi.com/getting_started/api_keys) (key types, 30-second timestamp tolerance, scopes, error codes)
- [API environments](https://docs.kalshi.com/getting_started/api_environments) (demo REST host `external-api.demo.kalshi.co`; demo and production keys are separate)
- [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance) and [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions)
- [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2) (`POST /portfolio/events/orders`; the legacy `/portfolio/orders` write path returns 410)
- [Fixed-point representation](https://docs.kalshi.com/getting_started/fixed_point_migration) (`_dollars` and `_fp` fields)
- [Demo environment](https://docs.kalshi.com/getting_started/demo_env) (demo prices "may not be reflective of real markets")

### Flagged for Review (T-DEMO and repo-wide)
1. **Credentials not provided.** A demo API key requires logging in at demo.kalshi.co and creating a key. This sandbox has no credentials, so no authenticated call has been run. The workflow reads `KALSHI_DEMO_KEY_ID` and `KALSHI_DEMO_PRIVATE_KEY` from GitHub Actions secrets and records "not configured" until they exist.
2. **Order execution unverified against the live demo server** until credentials are available. Orders are dry-run by default.
3. **Jurisdiction (California).** Third-party sites disagree on Kalshi availability for California residents. Kalshi's official help center was reachable but did not show a state list in the pages checked. Eligibility must be confirmed by the user on Kalshi's official help center: [help.kalshi.com](https://help.kalshi.com/en/). This project uses the demo environment only.
4. **Demo prices can differ from real markets** per [Kalshi's demo environment docs](https://docs.kalshi.com/getting_started/demo_env).
