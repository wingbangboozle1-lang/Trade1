# Demo Account & Strategy Lab (`demo-account/`)

Live console for the brief's portfolio/execution requirements: **track portfolio performance on the
Kalshi demo account, execute trades, and analyze/categorize results by trade type** — plus an
automatic paper-trading lab that runs with zero manual input.

Open **`index.html`** (served at `https://wingbangboozle1-lang.github.io/Trade1/demo-account/`).

## What runs automatically (no input, no credentials)

- Live polling of the official Kalshi **demo** Trade API (`external-api.demo.kalshi.co/trade-api/v2`)
  for the five brief topics (gas prices, elections, culture, crypto, golf), grouped by topic.
- Two scrolling alert chats: **All events** and **High-ROI model picks**, triggered by last-price
  swings ≥ **$0.10 in either direction** (integer-cent math; the exact 0.66→0.56 case is unit-tested).
- A **paper portfolio** with three fixed strategies (momentum-jump, fade-jump, value-ask), taker fees
  computed from the official fee schedule (all 42 fee-table cells reproduced in tests), positions held
  to **resolution (YES/NO)**, and P&L categorised by **topic × strategy × entry trigger**.
- Charts: equity curve and per-market contract-price chart (x = time, y = price) with ≥ $0.10 alert markers.
- Resolution tracker for watched events and held positions.

## Live demo-account mode (opt-in)

Create an API key at [demo.kalshi.co](https://demo.kalshi.co/) → Account & security → API Keys
([official steps](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)), then
paste the key ID + PEM into the panel. The key stays in the browser's `localStorage` and is only sent
to Kalshi's demo API with official request signing (`KALSHI-ACCESS-*`, RSA-PSS/Ed25519 — see
[VERIFICATION.md](VERIFICATION.md)). With a key you can read balance/positions and place guarded demo
orders (`POST /portfolio/events/orders`, typed confirmation required).

Server-side equivalent (CI / local, dry-run by default): [`../scripts/demo_account/`](../scripts/demo_account/README.md)
— add repository secrets `KALSHI_DEMO_KEY_ID` + `KALSHI_DEMO_PRIVATE_KEY` to enable it.

## Files

| File | Role |
|---|---|
| `index.html` | The console (all sections + live panel) |
| `flagged.html` | Flagged for Review (F-DA-1…F-DA-11) — unverified items, never blocking |
| `VERIFICATION.md` | Line-by-line verification table with official source links |
| `assets/engine.js` | Pure logic: fees, signals, portfolio, settlement, analysis (tested in Node) |
| `assets/signer.js` | WebCrypto request signing (browser) |
| `assets/app.js` | Polling, rendering, SVG charts, live panel |
| `assets/style.css` | Styling |
| `package.json` | `{"type":"module"}` so Node tests can import `assets/*.js` (ignored by the browser) |

## Tests

```
node tests/demo-account.test.mjs     # 89 assertions: fee table, signers, guard rules, paper math
node scripts/demo_account/selftest.mjs
```

## Honest limits

- Demo prices may differ from production ([demo_env](https://docs.kalshi.com/getting_started/demo_env)).
- Strategy results are a demo-environment sample, not a profitability claim (F-DA-1).
- Live account values stay blank until a key is connected (F-DA-7) — nothing is invented.
- Context links around sharp jumps are search links, not verified causes (F-DA-6).
