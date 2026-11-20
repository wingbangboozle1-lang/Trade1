# Demo account track (Kalshi DEMO environment only)

This folder contains the authenticated part of the project: a read-only snapshot of the Kalshi **demo** account, and a guarded executor that can place small **demo** orders. It is owned by session `20e3ad14` (see `COORDINATION.md`, task T-DEMO).

**Scope and limits**

- Demo environment only. The host is hard-coded to `https://external-api.demo.kalshi.co` (`kalshi_auth.mjs`). Production keys do not work on demo, and demo keys do not work on production ([API environments](https://docs.kalshi.com/getting_started/api_environments)).
- Orders are **buy YES only** (`side: bid`). The executor never sells, never buys NO, and never crosses the book (`post_only: true`).
- Hard limits (`order_rules.mjs`): at most 3 orders and $3.00 notional per run, 1 contract per order, price $0.01 to $0.99 on the market's own `price_ranges` grid, market must be `active`.
- Dry-run is the default. Orders are sent only when `ALLOW_DEMO_ORDERS=true` and both secrets are present.
- Nothing here stores credentials. Secrets are read from environment variables only.

## Files

| File | Purpose |
|---|---|
| `kalshi_auth.mjs` | Request signing (Ed25519 or RSA-PSS SHA-256), authenticated `demoRequest`, public `demoPublicGet` |
| `order_rules.mjs` | Pure validation rules: integer price math, price-grid check, hard caps |
| `snapshot.mjs` | Read-only `GET /portfolio/balance` and `GET /portfolio/positions?count_filter=position` → `data/demo_account/snapshot.json` |
| `make_plan.mjs` | Builds `data/demo_account/order_plan.json` from public demo markets. Strategy `join-best-yes-bid`. Sends nothing. |
| `execute.mjs` | Re-checks the plan against live market data, then dry-runs or sends `POST /portfolio/events/orders`. Logs to `data/demo_account/execution_log.json`. |
| `selftest.mjs` | 16 offline tests: signature round-trips verified with Node's own verifier, query stripping, price grid, guardrails |
| `../../.github/workflows/demo-account.yml` | Scheduled read-only snapshot every 6 hours. Manual `snapshot`, `plan`, or `live` modes. |

## Setup (one-time, by the account owner)

1. Log in to the demo site at [demo.kalshi.co](https://demo.kalshi.co). Go to **Account & security → API Keys → Create Key** ([official steps](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)).
2. Save the **API Key ID** and the **private key PEM** (it cannot be retrieved later).
3. In the GitHub repository settings, add two Actions secrets: `KALSHI_DEMO_KEY_ID` and `KALSHI_DEMO_PRIVATE_KEY`.
4. Run the workflow manually with `mode=snapshot`. Check `data/demo_account/status.json`.

Until step 3 is done, every run records `configured: false` and sends no request.

## Verified against official docs (2026-11-20)

- Signing string is `timestamp + METHOD + path`, with the query string removed. The timestamp is in ms and must be within 30 s of Kalshi's clock. RSA keys use RSA-PSS SHA-256 with MGF1 and salt equal to the digest length. Ed25519 keys sign the text directly. Source: [API keys](https://docs.kalshi.com/getting_started/api_keys).
- Balance: `GET /portfolio/balance` returns `balance` (cents), `balance_dollars`, `portfolio_value` (cents), `updated_ts`. Source: [Get Balance](https://docs.kalshi.com/api-reference/portfolio/get-balance).
- Positions: `GET /portfolio/positions` returns `market_positions[]` with `ticker`, `position_fp` (signed; positive = YES), `market_exposure_dollars`, `realized_pnl_dollars`, `fees_paid_dollars`, `total_traded_dollars`. Source: [Get Positions](https://docs.kalshi.com/api-reference/portfolio/get-positions).
- Orders: `POST /portfolio/events/orders` with `ticker`, `side` (`bid` = buy YES, `ask` = sell YES), `count` (fixed-point string), `price` (fixed-point dollars), `time_in_force`, `self_trade_prevention_type`. Source: [Create Order (V2)](https://docs.kalshi.com/api-reference/orders/create-order-v2) and [Order direction](https://docs.kalshi.com/getting_started/order_direction). The legacy `/portfolio/orders` write path returns `410 Gone`.
- Market status: REST value `active` means tradeable. `finalized` means settled. Source: [Market lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle).
- Prices are fixed-point dollars (up to 4 decimals). Valid prices come from each market's `price_ranges`. Source: [Fixed-point representation](https://docs.kalshi.com/getting_started/fixed_point_migration).

## Not verified (flagged for review)

- **No live authenticated call has been made.** This sandbox has no demo credentials. Server acceptance of signatures, the snapshot output, and order placement are untested against the live demo server. Self-tests verify the local implementation only.
- `GET /markets/{ticker}` wraps the market in a `market` field in the code (`res.market ?? res`). The wrapper was not confirmed from the docs, so the code accepts either form.
- `POST /portfolio/events/orders` response fields used in the log (`order_id`, `fill_count`, `remaining_count`, `average_fill_price`, `ts_ms`) come from the schema text the docs page showed. A live response has not been checked.
- The `join-best-yes-bid` strategy is a test strategy with no performance claim. Demo prices may not match real markets ([demo environment](https://docs.kalshi.com/getting_started/demo_env)).
- `make_plan.mjs` scans at most 2,000 open demo markets (10 pages). The plan records `scan_truncated`.
- Fees are not modeled. Positions report `fees_paid_dollars` from the API.
- Demo account trading is not the same thing as the paper-trading engine in other sessions' branches.
