# Verification record — session `fa530a2c` (2026-11-21)

Scope at claim: collector rate-limit resilience (`scripts/collect.py`), Resolved-page
empty-snapshot repair (`resolved.html`), stale open-PR integration review.
**Supersession note:** while this session worked, session `c96a21b7`'s PR #80 landed
essentially the same collector fail-closed repair on `main` (richer: `FAILURES` tracking,
per-section trusted flags, `KEPT` artifact preservation, an incident test). This session
therefore **dropped its own `collect.py` + `test_collect.py` changes during rebase** and
ships only what `main` did not have. Every claim below was checked against an official
Kalshi source or a live repo/GitHub observation on 2026-11-21. Nothing is inferred;
values that could not be confirmed are left blank and flagged.

## 1. Official sources re-read this session

| Claim | Official source | What it says (verbatim where quoted) |
|---|---|---|
| Demo REST root + alt host; demo WS hosts | [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env) | "Demo's recommended Trade API root is `https://external-api.demo.kalshi.co/trade-api/v2`." Table: REST recommended `https://external-api.demo.kalshi.co/trade-api/v2`, also supported `https://demo-api.kalshi.co/trade-api/v2`; WebSocket `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`, also `wss://demo-api.kalshi.co/trade-api/ws/v2`. Matches `BASE`/`ALT` in `scripts/collect.py` and the brief's URLs. |
| 429 handling = exponential backoff | [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits) | "Unauthenticated public requests are subject to separate limits. Authenticate requests where supported and back off on `429`." … "Apply exponential backoff on `429`." Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` ("Seconds, to the millisecond, until the bucket is full again"), `X-RateLimit-Cost`. "429 responses carry the rate limit headers below, but not `Retry-After`." 429 body: `{"error": {"code": "too_many_requests", "message": "too many requests"}}` — exactly the body in `data/log.md`. |
| Settlement result semantics (unchanged) | [Market Lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle) · [Market Settlement](https://docs.kalshi.com/getting_started/market_settlement) | `result` (yes/no) is set when determined; it pays out at settlement and the REST status becomes `finalized`. Cited on `resolved.html` and `flagged.html` FA-2. |

## 2. Live observations (2026-11-21)

- **Rate-limited run:** `data/log.md` (06:58Z run) contains dozens of
  `429 … body=b'{"error":{"code":"too_many_requests","message":"too many requests"}}'`
  lines; `data/meta.json` recorded `markets_open_count: 33`,
  `settled_count_recent: 0`; `data/topics/gas-prices.json` had
  `"event_count": 0`; `data/resolved.json` was
  `{"settled_total": 0, "in_scope_count": 0, "markets": []}` because the
  settled-markets request itself returned 429. The 429 body matches the
  official doc verbatim (§1).
- **Live site at claim:** https://wingbangboozle1-lang.github.io/Trade1/resolved.html
  fetched 2026-11-21 showed "No resolved markets in the snapshot." — the FA-2
  dead-end (page source returned before `loadScope()`/`pollLive()`).
- **Restoration, then refresh — D1 confirmed:** PR #80 (merged 07:14:53Z)
  first restored the pre-incident 03:59:57Z snapshot (`settled_total: 6000`,
  `in_scope_count: 1904`; that restored file **still contained 4 pre-fix
  natural-gas rows** — `KXNATGAS15M-26NOV202300-00`, `…2245-45`, `…2230-30`,
  `…2215-15`, verified — because the 03:59 run used the pre-D1-fix collector).
  The **scheduled 07:17:44Z run** (first with the fixed, fail-closed collector)
  then regenerated the snapshot: `in_scope_count: 2675`, `gas-prices` 10 events,
  and **no pre-fix `KXNATGAS15M` / `PLOPIT` rows remain in
  `data/resolved.json`** (verified by reading the regenerated file). D1's
  snapshot correction is therefore confirmed, not pending. No snapshot was
  hand-edited at any point.
- **Pages:** `gh api repos/wingbangboozle1-lang/Trade1/pages` → `status: built`,
  `build_type: legacy`, source `main /`, https enforced (re-checked during the
  session; re-checked again after this PR merges).
- **Parallel-session churn (verified via GitHub API, 07:00–07:20Z):** PRs
  #58/#64/#70 merged by their own sessions (see §4); PR #80 + #81 (fail-closed
  collector + records), #74 (dashboard column rename), #77/#78/#72/#76/#73
  merged; #67/#68/#75/#79/#82/#83/#84 open at the time of this writing.

## 3. What this PR contains — and what was superseded

| File | Change | Verification |
|---|---|---|
| `resolved.html` | **Unique:** empty snapshot falls through to `loadScope()`/`pollLive()` and renders live rows; explicit empty-state only when both sources return nothing; D1 note rewritten to the restored-snapshot reality (FA-3). | `npm run check` green; `tools/render_test.mjs --offline` green (§5). `main` still had the `fail(); return;` dead-end at review time (verified by reading `origin/main:resolved.html`). |
| `flagged.html` | **Unique:** new FA-1…FA-4 section, each row with evidence + official source, written after the integration review (statuses reflect actual PR outcomes, not intentions). | `npm run check` green (nav parity + links). |
| `COORDINATION.md` | Claim (pushed at start) + salvage of PR #67's unique records + completion record. | See §4/§6. |
| `reports/VERIFICATION_D256BFAC.md` | Salvaged one line from PR #67 (the 429 follow-up observation), attributed; facts re-verified against `data/log.md` and the official rate-limits doc. | File diff shown in this PR. |
| `reports/VERIFICATION_FA530A2C.md` | This record. | — |
| ~~`scripts/collect.py`~~ | **Dropped during rebase** — superseded by PR #80's fail-closed implementation (exponential backoff on 429/5xx/network, 0.25 s pacing, `FAILURES`/`KEPT` preservation). This session's parallel version (backoff + `paged()` ok-flag + clobber guards) was equivalent in intent and is not shipped to avoid a conflicting second implementation. | Equivalence checked by diffing both versions and reading PR #80's `tests/test_collect_failclosed.py` (6 tests: retry-then-success, retry-gives-up, definitive-4xx, empty-200-body, **all-429 incident keeps every verified artifact**, empty-200 don't-wipe — a superset of this session's planned tests). |
| ~~`tests/test_collect.py`~~ | **Dropped during rebase** — this session's 6 backoff tests targeted its own removed helpers; PR #80's incident test file covers the same ground against the shipped code. Main's 4 classification tests are untouched. | `python3 tests/test_collect.py` → 4/4 OK on this branch. |

## 4. Stale-PR integration review (FA-4) — final outcomes

| PR | State at claim | Review finding | Final outcome (verified via GitHub API) |
|---|---|---|---|
| #58 `arena/6916270f-trade1` | OPEN, CONFLICTING, stale since 2026-11-20 20:58Z | Unique content: per-row `api_market_url()` source links (batched `?tickers=…` URL on every trade/alert/resolution row). Not in `main` at review time — my initial "superseded" reading was corrected by diffing the branch. | **MERGED 07:08:09Z, merge commit `fdd4af3a`** — taken over per the board's 60-minute rule by `6877ec31` (PR #70) and landed; `data/portfolio.json` re-projected (11 trades + 29 alerts per-row links). Not merged or closed by this session. |
| #64 `arena/c96a21b7-trade1` | OPEN, MERGEABLE | Board record only (claim-withdrawal note for #65). | **MERGED 07:04:32Z, merge commit `d949035c`** by its own session. |
| #67 `arena/d256bfac-trade1` | OPEN, CONFLICTING | Unique records: d256bfac completion (PR #65 merge `a006b5eb`, Pages run 44877397735, CI run 44877167769) + the 429 follow-up observation — **not in `main`**. All four GitHub facts re-verified by API before salvage. | **Left OPEN** — its session pushed a new commit at 07:10:51Z ("docs: record collector rate-limit follow-up"), i.e. it is active; the takeover rule does not apply. Unique records **salvaged additively** into `COORDINATION.md` and `reports/VERIFICATION_D256BFAC.md` by this session; nothing discarded, nothing closed. |
| #68 `arena/6b112481-trade1` | OPEN, CONFLICTING | D1 collector fix already in `main` via PR #65; broader site/verify changes would conflict with several merged PRs. | **Left OPEN** — last commit 06:51:44Z (inside the 60-minute window at review time); left for its owner or a later integrator, noted in `COORDINATION.md`. |
| #70 `arena/6877ec31-trade1` | OPEN, CONFLICTING | Takeover of #58 + EXECUTIVE_SUMMARY N3 correction + `reports/VERIFICATION_6877ec31.md`. | **MERGED 07:08:07Z, merge commit `948488e6`** by its own session. |

No stale branch was merged by this session: each was diffed against `main`, and
the ones with unique content were either merged by their own (active) sessions or
salvaged additively here. Nothing this session did could regress `main`.

## 5. Full local validation (this branch, after rebase onto `f1f34f3`)

- `npm run check` → BUILD OK, 18 HTML / 6 JS / 0 broken links;
  `check_site.mjs` rows/resolved, 0 failures; `check_links.mjs` 16 pages,
  0 failures (results recorded in the PR).
- `npm test` → all suites pass, including `tests/test_collect.py` 4/4,
  `tests/test_collect_failclosed.py` (PR #80), portfolio 60/60,
  demo-account 89/89.
- `node tools/render_test.mjs --offline` → 16 pages, 0 JS errors.
- `python3 scripts/portfolio_engine.py selftest` → all checks pass.

## 6. Irregularities — final status

- **FA-1 / D1 refresh: RESOLVED 2026-11-21 07:17:44Z** — the scheduled run
  with the fixed, fail-closed collector regenerated the snapshot with no
  pre-fix rows (§2). Published on `flagged.html` with the full incident trail
  (root cause → PR #80 repair → restore → confirmation).
- **AA-8 (carried):** live demo-API runtime shapes are confirmed by CI runs
  and the browser, not by this sandbox (no route to `*.kalshi.co`).
- **Demo-account credentials (carried):** real demo balance/positions/orders
  need the owner's demo API key + private key (`KALSHI_DEMO_KEY_ID` /
  `KALSHI_DEMO_PRIVATE_KEY` secrets). The console stays inert without them;
  the paper dashboard needs no credentials.
- **Open PRs left for their owners:** #67 (active session; records salvaged
  here), #68 (within window at review), #75 (final-integration claim — its
  `resolved.html` denominator note and `flagged.html` section are additive to
  this PR's changes), #79 (its `collect.py` backoff is redundant with merged
  PR #80 — overlap note already recorded in `COORDINATION.md` by `c96a21b7`;
  its unique value is the portfolio entry guards), #82/#83/#84 (board-only).
