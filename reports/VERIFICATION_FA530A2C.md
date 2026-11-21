# Verification record — session `fa530a2c` (2026-11-21)

Scope: collector rate-limit resilience (`scripts/collect.py`), Resolved-page
empty-snapshot repair (`resolved.html`), stale open-PR integration review.
Every claim below was checked against an official Kalshi source or a live
repo/site observation on 2026-11-21. Nothing is inferred; values that could
not be confirmed are left blank and flagged.

## 1. Official sources re-read this session

| Claim | Official source | What it says (verbatim where quoted) |
|---|---|---|
| Demo REST root + alt host; demo WS hosts | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | "Demo's recommended Trade API root is `https://external-api.demo.kalshi.co/trade-api/v2`." Table: REST recommended `https://external-api.demo.kalshi.co/trade-api/v2`, also supported `https://demo-api.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, also `wss://demo-api.kalshi.co/trade-api/ws/v2`. Matches `BASE`/`ALT` in `scripts/collect.py` and the brief's URLs. |
| 429 handling = exponential backoff | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) | "Unauthenticated public requests are subject to separate limits. Authenticate requests where supported and back off on `429`." … "429 responses carry the rate limit headers below, but not `Retry-After`. … Apply exponential backoff on `429`." Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` ("Seconds, to the millisecond, until the bucket is full again"), `X-RateLimit-Cost`. 429 body: `{"error": {"code": "too_many_requests", "message": "too many requests"}}` — exactly the body in `data/log.md`. |
| Settlement result semantics (unchanged) | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) · [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | `result` (yes/no) is set when determined; REST status becomes `finalized` at settlement. Cited on `resolved.html` and `flagged.html` FA-2. |

## 2. Live observations (2026-11-21)

- **Rate-limited run:** `data/log.md` (06:58Z run) contains dozens of
  `429 … body=b'{"error":{"code":"too_many_requests","message":"too many requests"}}'`
  lines; `data/meta.json` records `markets_open_count: 33`,
  `settled_count_recent: 0`; `data/topics/gas-prices.json` has
  `"event_count": 0`; `data/resolved.json` is
  `{"settled_total": 0, "in_scope_count": 0, "markets": []}` because the
  settled-markets request itself returned 429. The 429 body matches the
  official doc verbatim (see §1).
- **Live site:** https://wingbangboozle1-lang.github.io/Trade1/resolved.html
  fetched 2026-11-21 shows "No resolved markets in the snapshot." — the
  FA-2 dead-end (page source returned before `loadScope()`/`pollLive()`).
- **Pages:** `gh api repos/wingbangboozle1-lang/Trade1/pages` →
  `status: built`, `build_type: legacy`, source `main /`, https enforced.
- **Open PRs:** `gh pr list` → #58, #64, #67, #68, #70 open; #58/#67/#68/#70
  `CONFLICTING`, #64 `MERGEABLE`. File lists inspected (see §4).

## 3. Changes and verification performed (this branch)

| File | Change | Verification |
|---|---|---|
| `scripts/collect.py` | Exponential backoff on 429/5xx/network failure (max 4 retries, 1→2→4→8 s, cap 20 s), honoring `X-RateLimit-Reset`; 0.15 s inter-request pacing; `paged()` returns an `ok` flag; clobber guards preserve previous `data/topics/*.json`, `data/categories.json`, `data/resolved.json` when the primary fetch fails outright; `meta.json` gains `preserved_on_fetch_failure`. | `python3 -m py_compile` OK; `tests/test_collect.py` 10/10 (4 pre-existing classification + 6 new: delay math, reset honoring, 429-retry-then-success, exhaustion, 400-no-retry, paged ok flag). |
| `tests/test_collect.py` | 6 new offline tests (mocked `get`/`sleep`/`fetch_json`; no network). | 10/10 pass in 0.006 s. |
| `resolved.html` | Empty snapshot falls through to `loadScope()`/`pollLive()` and renders live rows; explicit empty-state only when both sources return nothing; stale D1 note corrected (FA-3). | `npm run check` (build + check_site + check_links) green; `tools/render_test.mjs --offline` green (see §5). |
| `flagged.html` | New FA-1…FA-4 section (this session's findings, each with evidence + official source). | `npm run check` green (nav parity + links). |
| `COORDINATION.md` | Claim (committed + pushed at start) + completion record (this section's summary). | — |

**Not verified / not done (no inference):** a live collector run against the
demo API — this sandbox has no route to `*.kalshi.co` (curl returns 000).
The backoff/guard code paths are verified offline with mocks; the next
scheduled CI run (`.github/workflows/pages.yml`, every 3 h) exercises them
for real. The empty `data/resolved.json` is **not** hand-edited; it is
refreshed by that run. Live runtime behavior of the Resolved-page fix is
verified by the offline render gate, not by a live browser.

## 4. Stale-PR integration review (FA-4)

| PR | Branch | State | Verdict |
|---|---|---|---|
| #58 | `arena/6916270f-trade1` | OPEN, CONFLICTING | Superseded: per-row official market links are already in `main` (`data/portfolio.json` rows carry source URLs; `tests/portfolio.test.mjs` asserts them, 60/60). Close with pointer to `main`. |
| #64 | `arena/c96a21b7-trade1` | OPEN, MERGEABLE (COORDINATION.md only) | Superseded: the D1 collector fix is already in `main` (`keyword_match` word boundaries + `topic_excluded` in the settled fallback; `tests/test_collect.py` 4/4 on `main`). Close. |
| #67 | `arena/d256bfac-trade1` | OPEN, CONFLICTING (COORDINATION.md only) | Superseded/record-only; the classifier delivery it records is in `main`. Close. |
| #68 | `arena/6b112481-trade1` | OPEN, CONFLICTING | Superseded: D1 fix + later engine fixes (PR #71, `aa7d3d27`) are in `main`; merging this stale branch would regress `main`. Close. |
| #70 | `arena/6877ec31-trade1` | OPEN, CONFLICTING | Superseded: portfolio ledger per-row links already in `main` (see #58). Close. |

No stale branch is merged: each was diffed against `main` and its content
is already present. Closing (not merging) is the integration action that
cannot regress `main`; the PR links + merge commits that superseded them
are recorded in `COORDINATION.md`.

## 5. Full local validation (this branch, before PR)

- `npm run check` → BUILD OK, 18 HTML / 6 JS / 0 broken links;
  `check_site.mjs` 1,183 rows / 625 resolved / 0 failures;
  `check_links.mjs` 16 pages / 400 local + 236 external / 0 failures.
- `npm test` → engine, live_fixes, live_dash, lib, fees, model,
  root_engine, model.test, portfolio 60/60, demo-account 89/89,
  `tests/test_collect.py` 10/10 — all pass.
- `node tools/render_test.mjs --offline` → 16 pages, 0 JS errors.
- `python3 scripts/portfolio_engine.py selftest` → 50/50.

## 6. Irregularities carried forward (do not block)

- **FA-1 (pending refresh):** committed `data/resolved.json` is empty and
  `data/topics/gas-prices.json` has 0 events until the next successful
  scheduled collector run. Published on `flagged.html`.
- **AA-8 (carried):** live demo-API runtime shapes are confirmed by CI runs
  and the browser, not by this sandbox. Published on `flagged.html`.
- **Demo-account credentials (carried, F-DA-7/I4):** real demo
  balance/positions/orders need the owner's demo API key + private key
  (`KALSHI_DEMO_KEY_ID` / `KALSHI_DEMO_PRIVATE_KEY` secrets). The console
  stays inert without them; the paper dashboard needs no credentials.
