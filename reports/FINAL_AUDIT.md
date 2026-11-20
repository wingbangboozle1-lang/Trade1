# Final current-branch audit

**Checked:** 2026-11-20 UTC  
**Branch:** `arena/1db0a677-trade1`  
**Audited base:** `069a1db6026f573f7b1227115c04e5cf481a9ed3` (same as `origin/main` at audit start); final integration also includes later mainline PRs #29–#38.

## Result

The canonical GitHub Pages site is already integrated at the repository root and published from `main` (`/`). This audit did not rebuild or replace the site. It re-ran the existing checks, verified Pages configuration and successful deploy through GitHub's API, preserved the latest mainline summary corrections after checking them against the current deployment, and recorded remaining scope limits below.

## Verification performed

- `npm run build` — pass on the updated mainline: 15 HTML pages and 2 JavaScript files checked; 0 broken links. Build command: [`tools/build.mjs`](../tools/build.mjs).
- `npm test` — pass: 23/23 DOM/engine assertions and `scripts/test_lib.mjs` passed.
- `node tests/root_engine.test.js` — pass: 40 assertions, including exact ±$0.10 alert boundaries, classification, and paper-broker behavior. Fee fixtures are cross-checked against Kalshi's [official fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf).
- `npm run check` — pass: build plus site validation; 15 HTML pages, 274 links, 1,118 snapshot rows, 625 resolved entries, 0 failures. Checker: [`scripts/check_site.mjs`](../scripts/check_site.mjs).
- GitHub Pages API reports `status: built`, public, HTTPS enforced, legacy source `main` at `/`: [Pages API](https://api.github.com/repos/wingbangboozle1-lang/Trade1/pages).
- Latest completed Pages deployment after the current integration, [run 44802648997](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44802648997), succeeded on 2026-11-20 at the current `main` site build.
- The matching `Site checks + data refresh` run [44802649528](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44802649528) completed successfully.
- Scheduled official API verification/collection [run 44797727149](https://github.com/wingbangboozle1-lang/Trade1/actions/runs/44797727149) also passed its verification, collection, snapshot-commit, and artifact-upload steps.
- GitHub Actions emitted a maintenance warning in recent runs: `actions/checkout@v4` and/or `actions/upload-artifact@v4` target Node.js 20 and are being forced to run on Node.js 24; see GitHub's [Node 20 deprecation notice](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/). This is not a failed check, but action versions/runtime policy should be reviewed.

The public landing page was fetched after deploy and displayed the current 2026-11-20 19:12:41 UTC snapshot time and 15,208 open markets; the Ideas page and live dashboard links also rendered. This was a page fetch, not an independent end-user browser session. Build/test success does not prove live market polling from every user's browser/network.

## Source and claim checks

- Environment and endpoint references: Kalshi's official [demo environment documentation](https://docs.kalshi.com/getting_started/demo_env) and [API environments documentation](https://docs.kalshi.com/getting_started/api_environments).
- Market/status schema and observed demo market data: official [Get Markets documentation](https://docs.kalshi.com/api-reference/market/get-markets) and the exact [demo markets request](https://external-api.demo.kalshi.co/trade-api/v2/markets?status=open&limit=2). The mismatch between demo `status:"active"` and the documented filter vocabulary remains explicitly flagged; it must not be silently normalized as an official status definition.
- WebSocket authentication: Kalshi's official [WebSocket quick start](https://docs.kalshi.com/getting_started/quick_start_websockets).
- Order book and candles: official [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook) and [Get Market Candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks).
- Dollar ranking is an estimate rather than an exchange-published per-event dollar-notional value; the repository's methods and Flagged pages disclose this. Demo API data do not establish causation for jumps: news links are context/search links, not verified explanations.
- CORS: [`data/cors.json`](../data/cors.json) and [`data/log.md`](../data/log.md) hold observed GitHub-runner response headers for the tested origins/requests. This is measurement evidence, not an official Kalshi promise and not a full end-user browser test.

## Scope limits and irregularities

1. **Real demo-account portfolio and order execution are not implemented.** The strategy lab is local paper simulation; no account is connected, and no exchange orders are submitted. Real account use would require user-owned demo credentials and a security-reviewed authenticated integration; no credentials were requested or added.
2. **Historical findings remain, but alternate site trees were removed by the latest integration.** Earlier build-specific statements and review results remain in `docs/` and `reports/`; prior duplicate site trees were removed from the current mainline. The canonical Pages site is the repository root. This audit preserved the latest integration cleanup and did not restore superseded pages.
3. **Evidence has limits.** A passing link checker establishes local link resolution and required source URLs in checked data; it does not prove every evolving market value is economically accurate, establish profitability, or verify a news cause.

## Corrections in this audit

The earlier executive summary named `site/` as the published Pages source and described CORS as untested. During this audit, mainline integration updated `EXECUTIVE_SUMMARY.md` with the repository-root Pages source and the runner-probe status; this branch preserved that newer mainline version rather than overwriting parallel-session changes. The current summary's CORS caveat and the evidence in `data/cors.json` and `data/log.md` distinguish a measured probe from a guarantee or end-to-end browser verification.

## Manual review links

- [Live GitHub Pages site](https://wingbangboozle1-lang.github.io/Trade1/)
- [Flagged for Review page](https://wingbangboozle1-lang.github.io/Trade1/flagged.html)
- [Source index](https://wingbangboozle1-lang.github.io/Trade1/sources.html)
- [Raw CORS probe](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/cors.json)
- [Collection request log](https://github.com/wingbangboozle1-lang/Trade1/blob/main/data/log.md)
- [Kalshi demo API docs](https://docs.kalshi.com/llms.txt)
