# Verification record — session `3c017782` (final integration)

**Date:** 2026-11-21 UTC · **Branch:** `arena/3c017782-trade1` (base `main` @ `2acfa8e`)
**Role:** final integration session — reconcile the five open parallel branches, re-verify the combined
data line by line against official sources, confirm the site builds with no broken links, publish to
GitHub Pages.

Every claim below was checked in this session. Where a value could not be confirmed from an official
source it is left blank and published on the Flagged page rather than filled in.

---

## 1. Official sources read directly in this session

The build sandbox has no route to `*.demo.kalshi.co` (`curl` returns `000` before TLS), so **no live market
value could be re-read here**. The official **documentation** *was* fetched and read during this session:

| Source | URL | What it was used for |
|---|---|---|
| Rate Limits and Tiers | `https://docs.kalshi.com/getting_started/rate_limits` | The 429 contract quoted verbatim in Flagged BE-1 and §4 below |
| Fee Schedule for July 2026 | `https://kalshi.com/docs/kalshi-fee-schedule.pdf` | The taker/maker formulas, the 21-row General Trading Fees table, and the Non-Standard Fees rows transcribed in §6 |

Quoted verbatim from the Rate Limits page (fetched 2026-11-21):

> “A rate-limited request returns `429 Too Many Requests` with the body:
> `{"error": {"code": "too_many_requests", "message": "too many requests"}}` … 429 responses carry the
> rate limit headers below, **but not `Retry-After`**. … **Apply exponential backoff on 429**.”

> `X-RateLimit-Reset` | Seconds, to the millisecond, until the bucket is full again.

> “Unauthenticated public requests are subject to separate limits. Authenticate requests where supported
> and back off on `429`.”

That confirms three things the code now relies on: the 429 body in `data/log.md` is the documented body;
`Retry-After` is **not** sent (so the retry must not depend on it); and `X-RateLimit-Reset` is a
(millisecond-precision) number of seconds — which is how the collector now reads it.

---

## 2. Parallel-branch reconciliation

Five PRs were open. Each was read line by line before anything was taken. **Three of them would have
reverted a fix that had already merged**, which is why they were ported rather than merged wholesale.

| PR | Branch | Disposition and reason |
|---|---|---|
| #67 | `arena/d256bfac-trade1` | **Ported** — board/verification record only. |
| #74 | `arena/aa7d3d27-trade1` | **Ported** — the “Market favours” rename. It also removed the conflict markers in `COORDINATION.md`. Its two remaining “Best price” references in `suggestions.html` were fixed here. |
| #79 | `arena/0b68e1e4-trade1` | **Partly ported** — its `portfolio_engine.py` 429 retry and ledger entry guards are new and were taken. Its `scripts/collect.py` hunk **reverts** PR #80's fail-closed collector, so it was not taken; `main`'s version is strictly stronger (it retries *and* refuses to overwrite an artifact whose inputs failed). |
| #75 | `arena/725b09a7-trade1` | **Partly ported** — the new per-row official-source gate, the collector/browser parity test and fixture, the pagination-truncation reporting and the collector-code fingerprint are new and were taken. Its `scripts/collect.py` hunk likewise **reverts** PR #80's gates, and its `scripts/portfolio_engine.py` hunk **reverts** `main`'s stronger per-row source rule. Its `EXECUTIVE_SUMMARY.md` fee-multiplier wording was **rejected**: it describes a resolution order the code does not implement. |
| #68 | `arena/6b112481-trade1` | **Superseded** by #75 — the three new files are byte-identical and #75 carries the newer review report. Nothing lost; #75 is credited. |

The two workflow regressions in #75 were also rejected: it removed `tests/live_dash.test.mjs`, removed
`tests/test_collect_failclosed.py`, and dropped `--offline` from the render gate — all three are the
fixes for the CI flake recorded on the board. `main`'s versions were kept.

---

## 3. Defects found and fixed in this session

### 3.1 `COORDINATION.md` shipped unresolved conflict markers — **fixed**

`main` carried `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` at lines 1359–1450, committed by an
earlier merge. The file is published on the live site, so the markers were visible to readers.

*Fixed:* the markers are removed and **both** sides are preserved — session `6877ec31`'s record and
session `6de17567`'s record are both still on the board. A new gate in `scripts/check_site.mjs` fails
the build if any tracked text file contains a merge marker.

*Mutation-tested:* injecting `<<<<<<< HEAD … >>>>>>> origin/main` into `COORDINATION.md` makes
`check_site.mjs` exit 1 with `unresolved merge conflict marker in COORDINATION.md (line 1484)`;
removing it returns the gate to 0 failures.

### 3.2 The browser classifier and the Python collector disagreed — **fixed**

`scripts/collect.py` matched topic keywords as whole words (`(?<!\w)(?:…)(?!\w)`). The live browser
mirror `assets/model.js` matched them as bare substrings. So `petrol` matched inside `Petrolul`:

* `KXROMLNBMGAME-26NOV201200PLOPIT-PLO` — “CSM BBA Petrolul Ploiesti wins”, a Romanian basketball match —
  was labelled **gas-prices** by the browser while the collector excluded it.
* The same mismatch applied to the exclusion rule, so `natural gas` could be caught by the `gas price`
  keyword.

*Fixed:* `assets/model.js` now mirrors the collector's word-boundary semantics (implemented without
lookbehind so it behaves identically in every browser). Both implementations are now tested against
**one** shared corpus of official records (`tests/fixtures/topic_cases.json`).

*Regression:* `tests/collector.test.mjs` §3 went from **1 failing check** (“`Petrolul` does not match” →
got `gas-prices`, want `null`) to 18/18 passing after the fix; `tests/test_collect.py` §1–3 (38/38).

### 3.3 The settled sweep was truncated but published as a total — **fixed**

The collector's own log of the official responses (commit `a15a941`) records:

```
- 04:02:59Z   page 6: +1000 items (total 6000); cursor=present
```

The cursor was **still present** when the collector hit its 6-page cap, so the sweep was truncated:
`settled_total: 6000` and `in_scope_count: 1904` were **lower bounds** for the 72-hour window, not the
exchange's totals. The Resolved page printed “settled in window: 6000 · in scope: 1904” as if they were
totals.

*Fixed:*
* the settled sweep cap is raised from 6 to 20 pages (`SETTLED_MAX_PAGES`);
* `paged()` returns a stats object recording `pages`, `max_pages`, `truncated` and `returned`;
* `data/resolved.json` publishes `settled_pagination`, `settled_total_is_lower_bound` and
  `in_scope_count_is_lower_bound`;
* `resolved.html` prints **“at least 6000”** and adds a denominator line naming the pagination facts;
* the committed snapshot was given the truthful flags for the 03:59:57Z run, with the log line quoted
  in the file as the evidence.

*Gate:* `tests/test_collect.py` §8 asserts that `paged()` returns pagination facts, that the resolved
snapshot publishes them, and that the settled cap is larger than the default page cap.

### 3.4 The published “Gas prices” resolved section was entirely natural gas — **fixed**

The committed `data/resolved.json` published 196 crypto rows and **4** “gas” rows. All four were:

| ticker | title |
|---|---|
| `KXNATGAS15M-26NOV202300-00` | Natural Gas price up in next 15 mins? |
| `KXNATGAS15M-26NOV202245-45` | Natural Gas price up in next 15 mins? |
| `KXNATGAS15M-26NOV202230-30` | Natural Gas price up in next 15 mins? |
| `KXNATGAS15M-26NOV202215-15` | Natural Gas price up in next 15 mins? |

The gas topic excludes `natural gas|natgas|propane|heating oil`, so there were **zero** genuine
gasoline rows in the published resolved list.

*Fixed:* the 4 rows were removed offline by re-applying the collector's own rule to the verbatim
committed rows. No value was altered; the removal, the rule, the tickers and the official record URLs
are recorded inside `data/resolved.json` under `removed_out_of_scope`. The collector now also publishes
a **topic-balanced** slice (round-robin over the five topics by settlement time, then fill the
remaining capacity with the globally newest rows) so a future snapshot shows all five topics instead of
a slice the demo's continuous crypto settlement fills with crypto.

*Verification that nothing else changed:* the committed file was compared field-by-field before and
after the correction — every field other than the four removed rows is byte-identical.

### 3.5 Nothing checked that a published row links its own official record — **fixed**

`scripts/check_site.mjs` proves the source links for the frozen snapshot, but the pages that are
actually published (`data.html`, `resolved.html`) build each row's link in JavaScript at render time, so
a static check of the HTML cannot see it.

*Fixed:* `scripts/check_row_sources.mjs` renders both pages in jsdom against the real data files and
asserts, row by row, that each rendered row carries at least one link on the official demo base, that
the link is the row's **own** record (`/events/{event_ticker}` for an event row, `/markets/{ticker}`
for a market row), and that every row in the data files is rendered (nothing silently dropped).

*Result:* `{"counts":{"rows":271,"rowLinks":413,"expected":271},"renderedTopicRows":71,
"renderedResolvedRows":200,"failures":0}`.

### 3.6 Two positions stacked on one market, both losing everything — **fixed**

The committed ledger held `KXETHD-26NOV2017-T1659.99` **twice** — once opened by `momentum`, once by
`harvest` — both with `entry_usd 0.95`, both `reason: "settlement (no)"`, both `pnl_usd −24.8665`.

*Fixed (from PR #79, credited):* one open position per ticker **across all strategies**, and the
directional strategies (momentum, fade, breakout) refuse an ask above **$0.90**. Harvest is exempt by
design (it buys $0.90–$0.99 YES near expiry). Past ledger rows were **not** rewritten — the two losses
stand in the record. Mirrored in `assets/model.js`.

*Gates:* `scripts/test_model.mjs` §4c (new checks) and `portfolio_engine.py selftest` §9 (new checks);
84/84 selftest checks pass.

### 3.7 Ledger exit rows linked the cycle's batch quote URL — **fixed**

`trade_public()` preferred the stored exit source, which for the older state rows was the cycle's
400-ticker `/markets?tickers=…` request. Every published row now links its own
`GET /markets/{ticker}` record; the batch URL stays published in `sources.quote_endpoints` and in
`data/log.md` as the provenance of the prices.

The committed artifact was re-sourced offline with the new `portfolio_engine.py resource` command.
*Verification:* a field-by-field comparison of `data/portfolio.json` before and after showed **every
field other than `source` identical** — no price, size, P&L or timestamp changed. The command is
idempotent (a second run reports `re-sourced 0 of 75 ledger rows`).

### 3.8 The collectors ignored 429 — **fixed**

See §1 for the official text. Both Python fetchers now pace their requests, retry a 429 with bounded
exponential backoff, honour `X-RateLimit-Reset` when the API sends it, and — in the collector — **fail
closed**: an artifact whose inputs failed is not overwritten (`tests/test_collect_failclosed.py`, 6/6).

---

## 4. Collector provenance — a new, reproducible fingerprint

The collector now writes `collector_code_sha256` into every artifact it produces: the SHA-256 of
`scripts/collect.py` bytes, a NUL byte, then `scripts/topics.json` bytes. A reader can therefore tell
whether a committed snapshot was produced by the **current** collector code or by an older revision —
which matters, because a snapshot taken before a classification fix legitimately still contains the rows
the fix removes, and a gate must report “stale snapshot” rather than “the collector produced bad data”.

The committed snapshot was produced by commit `a15a941`, whose fingerprint is:

```
01bc2a00514482c8615cf3550cc64735a1465960d754e6c0838b486170ba1a78
```

Reproducible by anyone with:

```sh
python3 - <<'PY'
import hashlib, subprocess
h = hashlib.sha256()
for n in ("scripts/collect.py", "scripts/topics.json"):
    h.update(subprocess.run(["git","show",f"a15a941:{n}"],capture_output=True,check=True).stdout)
    h.update(b"\0")
print(h.hexdigest())
PY
```

The value was backfilled into `data/resolved.json`, `data/meta.json`, `data/categories.json` and
`data/topics/*.json`, together with a note in `data/resolved.json` recording that the 4 natural-gas
rows were removed afterwards by session `3c017782` — so the file never claims more provenance than it has.

---

## 5. What the final site publishes, and where every number comes from

| Page | Rows | Source of each row |
|---|---|---|
| `dashboard.html` | live markets, ranked by estimated traded dollars | official `/markets` (`yes_bid_size_fp`, `yes_ask_size_fp`, `volume_fp`, `volume_24h_fp`) — computed estimate, labelled as such |
| `data.html` | the per-topic event tables | official `/events/{event_ticker}` — **gate-checked row by row** (`scripts/check_row_sources.mjs`) |
| `resolved.html` | 821 resolved rows (196 from `data/resolved.json`, 625 from the archive in `data/snapshot.json`) | official `/markets/{ticker}` — **gate-checked row by row** |
| `portfolio.html` | 12 trades, 30 alerts, resolutions | official `/markets/{ticker}` per row — **gate-checked** |
| `topics/*.html` | the five tracked topics only | the committed topic snapshots |

The five topics are gas prices, elections, culture, crypto and golf, as the brief requires, and each
topic keeps its events together (`data/topics/<topic>.json`, one page per topic).

---

## 6. Fee schedule — re-read from the official PDF

The PDF was fetched directly in this session. Confirmed verbatim:

* taker `fees = round up(M × 0.07 × C × P × (1−P))`;
* maker `fees = round up(M × 0.0175 × C × P × (1−P))`, “M = the multiplier for each contract (**default
  is 0** unless otherwise indicated)”;
* “There is no settlement fee”;
* the General Trading Fees Table — all 21 price points, e.g. `$0.50 → $0.02` for 1 contract and
  `$50.00 → $1.75` for 100 contracts (the naive float expression returns `$1.76`, which is the bug the
  integer fee function exists to prevent).

**Non-Standard Fees table — transcription.** The PDF's text layer is garbled in the middle pages. Rows
whose ticker, title and multipliers align unambiguously were transcribed; the rest were not.

*Transcribed in this session (13):* `KXMARMAD` (College Basketball Champion, 1, 1) and the 12
`KXNFL*`/`KXNHL*` rows — each confirmed by its own title in the PDF and by the already-transcribed rows
that share the same block (`KXPAHLAVIHEAD`, `KXPAYROLLS`, `KXPGARYDER`, `KXPGASOLHEIM`).

*Still untranscribed (29):* the MLB / NBA / NCAA rows, whose ticker column and title column are
interleaved in the text layer. **They were left alone rather than guessed**, and they keep the default
taker multiplier M = 1.

*Effect on published numbers:* none. Every row transcribed has taker M = 1, which is the default the
paper brokers already applied, and none of the 29 remaining rows belongs to the five tracked topics.

---

## 7. Gates run after the changes (all local, exit 0)

| Gate | Result |
|---|---|
| `npm test` | engine 23/23 · live_fixes 3/3 · live_dash 6/6 · lib ok · fees 50 · model 36 · root_engine 48/48 · model.test 21/21 · portfolio 60/60 · demo-account 89/89 · `tests/test_collect.py` 38/38 |
| `python3 tests/test_collect_failclosed.py` | 6/6 |
| `node tests/collector.test.mjs` | 18/18 |
| `python3 scripts/portfolio_engine.py selftest` | 84/84 |
| `node tools/build.mjs` | BUILD OK — 18 HTML, 6 JS validated, 0 broken links |
| `node scripts/check_site.mjs` | 434 links, 1,249 rows, 821 resolved, **0 failures** |
| `node scripts/check_links.mjs` | 16 published pages, 400 local + 236 external links, **0 failures** |
| `node scripts/check_row_sources.mjs` | 271 rendered rows, 413 official links, **0 failures** |
| `node tools/render_test.mjs --offline` | every published page renders with 0 JS errors |

---

## 8. Not verified — published, not hidden

| Item | Why | Where |
|---|---|---|
| Live demo-API **market values** | the build sandbox has no route to `*.demo.kalshi.co` (`curl` → `000` before TLS). The official **documentation** was re-read directly and is quoted verbatim; only live market data is unconfirmed. | Flagged 3c-7 |
| A live collector run with the new code | same reason. The next scheduled `pages.yml` data job is the first real run; the collector's fail-closed gates mean a degraded run cannot overwrite the verified snapshot. | Flagged BE-4 |
| The topic mix of the committed resolved slice | it is 196 crypto rows; the sweep's other rows were never stored, so the slice could not be re-balanced offline. The collector now publishes a balanced slice; the committed composition is stated on the page rather than hidden. | Flagged 3c-8 |
| 29 fee-schedule rows | the PDF's text layer interleaves their ticker and title columns. Left untranscribed rather than guessed; they keep the default taker M = 1 and none is in a tracked topic. | Flagged 725-10 |
| Maker fees, the ROI score's predictive power, the demo-account track | pre-existing disclosed limitations, unchanged by this session. | Flagged 725-7, 725-8, 725-6 |

---

## 9. Irregularities flagged for the owner

1. **`COORDINATION.md` was published with conflict markers** and nothing caught it — a check suite that
   validates HTML and JSON cannot see a conflict in a Markdown file. The new gate closes that class of
   defect for every tracked text file.
2. **Three of the five open branches would have reverted a merged fix** (#79 and #75 both pre-date PR #80's
   fail-closed collector; #75 also reverts `main`'s per-row source rule). Any future session that merges
   a branch without reading it against `main` can reintroduce a fixed defect. The board now records the
   disposition of every open PR.
3. **`scripts/collect.py` and `scripts/portfolio_engine.py` are duplicated logic in two languages** (the
   Python collector and the browser mirror `assets/model.js` were out of sync until this session found
   it). The shared fixture corpus now checks both against one set of official records, but a second
   divergence in a rule that has no fixture would still be possible.
4. **The demo environment settles crypto continuously**, so any "newest N settled markets" window is
   crypto-dominated by construction. The topic-balanced slice fixes the published snapshot, but the
   underlying shape of the demo data is worth knowing before reading any resolved-market statistic.
5. **The sandbox has no route to Kalshi**, so no session can verify a live value locally; every such
   statement on the site is marked as unverified rather than asserted.
