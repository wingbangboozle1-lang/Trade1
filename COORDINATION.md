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
| T-DEMO | Demo account track: authenticated read-only snapshot (balance, positions), signing helper, guarded demo order executor (dry-run by default), scheduled workflow | needs review (blocked on demo API key secrets) | 20e3ad14 | `scripts/demo_account/**`, `.github/workflows/demo-account.yml`, `data/demo_account/**` |

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

### T-DEMO log (session 20e3ad14)
- Claimed 2026-11-20 (claim commit `28459f3`). Code pushed in `9ae3ded` and `88c0a38` on `arena/20e3ad14-trade1`. Status: **needs review**.
- Built (files in scope only): `scripts/demo_account/{kalshi_auth,order_rules,snapshot,make_plan,execute,selftest}.mjs`, `scripts/demo_account/README.md`, `.github/workflows/demo-account.yml`, and `data/demo_account/` (generated output only).
- **Verification performed**
  - `node scripts/demo_account/selftest.mjs`: 16/16 pass. Covers Ed25519 and RSA-PSS signatures checked with Node's independent `crypto.verify`, query-string stripping, price-grid checks, and each guardrail (side=bid only, count cap, price range, active status, run caps).
  - Workflow `Demo account track` run [44741428538](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44741428538) on this branch (push trigger, `plan` mode, dry-run): **success**. The plan step read 2,000 open markets from the public demo endpoint `GET /markets?status=open` and produced 0 orders (no open market in that scan had a YES spread of $0.01–$0.03 with a resting bid). No order was sent. Credentials were absent, so `status.json` records `configured: false` and no authenticated request was sent.
  - YAML parsed with `js-yaml`. Workflow triggers: `schedule` (snapshot only, every 6 h), `push` (path-filtered, dry-run plan), `workflow_dispatch` (snapshot / plan / live).
- **Sources (official)**: [Authenticated requests](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests), [API keys](https://docs.kalshi.com/getting_started/api_keys), [API environments](https://docs.kalshi.com/getting_started/api_environments), [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance), [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions), [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2), [Order direction](https://docs.kalshi.com/getting_started/order_direction), [Market lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle), [Fixed-point representation](https://docs.kalshi.com/getting_started/fixed_point_migration), [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets), [Demo environment](https://docs.kalshi.com/getting_started/demo_env).
- **Irregularities / flags for review**
  1. **Blocked: no demo credentials.** The sandbox cannot create a Kalshi demo account or API key. Owner steps are in `scripts/demo_account/README.md`. Until `KALSHI_DEMO_KEY_ID` and `KALSHI_DEMO_PRIVATE_KEY` are set as Actions secrets, no authenticated call runs and no demo orders can be placed. Live server acceptance of signatures is unverified.
  2. `GET /markets/{ticker}` wrapper (`market` field) is not confirmed in the docs. The code accepts both shapes.
  3. Order-response fields used in the execution log come from the schema text and are not confirmed against a live response.
  4. The `join-best-yes-bid` strategy is a test strategy with no performance claim. It places no order when no market passes its filter, which is what happened on the first run.
  5. Market scan is capped at 2,000 markets (`scan_truncated` is recorded in the plan).
  6. Fees are not modeled.
  7. Demo prices may not reflect real markets ([demo environment docs](https://docs.kalshi.com/getting_started/demo_env)).
  8. **Jurisdiction (California):** third-party sites disagree on Kalshi availability for California. Official confirmation was not found in the Kalshi help-center pages checked. The user must confirm eligibility at [help.kalshi.com](https://help.kalshi.com/en/). This track uses demo only.
- **Handoff to integration session:** the demo outputs are `data/demo_account/status.json`, `snapshot.json` (balance and positions, raw API objects), `order_plan.json`, and `execution_log.json`. Any site page that shows the demo account should read these files and link each row to the source endpoint above. This session does not edit `index.html` or other site files.
- Not done by this session: the site, the collector, paper trading, repo review, and the final integration PR. Those are claimed by other sessions (see the board observation above).
