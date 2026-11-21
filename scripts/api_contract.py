#!/usr/bin/env python3
"""Live endpoint-contract probe for the Trade1 dashboard.

The dashboard is a static page that calls the Kalshi DEMO Trade API straight from
the browser. Every feature on it therefore depends on a set of exact request shapes
and response fields. This script checks those contracts against the live demo API
and writes the evidence to data/endpoint_contract.json, which the Data page
publishes ("is the feed I am looking at still the feed the docs describe?").

Design rules (the same rules the rest of the repo follows):
  * Nothing is inferred. A case records the HTTP status, byte size, latency, the
    top-level response keys, and the presence of each required field as observed.
    A case that cannot reach the API is recorded as `unreachable`, never as pass.
  * Each case carries the official doc URL that states the rule it tests, so a
    reader can check the claim line by line.
  * Expected statuses are documented values, not guesses. Where the docs do not
    state a behaviour (e.g. whether an over-limit `limit` is clamped or rejected),
    the case records the observation and is marked `informative` — it cannot fail.
  * Rate limits are respected: one request per PACE_S, and on 429 a single retry
    after an exponential wait, per https://docs.kalshi.com/getting_started/rate_limits

Run:  python3 scripts/api_contract.py [--out data/endpoint_contract.json]
      python3 scripts/api_contract.py --selftest     (offline; no network)
Exit: 0 if every non-informative case passes, 1 otherwise (evidence is written
      either way, so the site can show what changed).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
PAGES_ORIGIN = "https://wingbangboozle1-lang.github.io"
UA = "Trade1-endpoint-contract/1.0 (github.com/wingbangboozle1-lang/Trade1)"
PACE_S = 0.35          # one request per 350 ms: ~17/min, far below any documented budget
RETRY_WAITS = (3.0,)   # on 429: one retry after 3 s ("apply exponential backoff")

DOCS = {
    "environments": "https://docs.kalshi.com/getting_started/api_environments",
    "rate_limits": "https://docs.kalshi.com/getting_started/rate_limits",
    "get_markets": "https://docs.kalshi.com/api-reference/market/get-markets",
    "get_events": "https://docs.kalshi.com/api-reference/events/get-events",
    "get_series": "https://docs.kalshi.com/api-reference/market/get-series",
    "get_series_list": "https://docs.kalshi.com/api-reference/market/get-series-list",
    "orderbook": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    "orderbook_format": "https://docs.kalshi.com/getting_started/orderbook_responses",
    "trades": "https://docs.kalshi.com/api-reference/market/get-trades",
    "candlesticks": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    "lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
    "settlement": "https://docs.kalshi.com/getting_started/market_settlement",
}


def req(url, method="GET", origin=None, timeout=30):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if origin:
        headers["Origin"] = origin
    r = urllib.request.Request(url, headers=headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, dict(resp.headers.items()), resp.read(), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read(), time.time() - t0
    except Exception as e:  # DNS, TLS, timeout — reported, never papered over
        return None, {}, str(e).encode(), time.time() - t0


def probe(url, expect, note=""):
    """One request, one 429 retry. Returns the observation dict."""
    out = {"url": url, "expected_status": expect, "note": note}
    status, headers, body, dt = req(url, origin=PAGES_ORIGIN)
    if status == 429:
        time.sleep(RETRY_WAITS[0])
        status, headers, body, dt = req(url, origin=PAGES_ORIGIN)
        out["retried_after_429"] = True
    out["http_status"] = status
    out["latency_ms"] = round(dt * 1000, 1)
    out["bytes"] = len(body)
    acao = headers.get("access-control-allow-origin") or headers.get("Access-Control-Allow-Origin")
    if acao:
        out["access_control_allow_origin"] = acao
    rl = {k.lower(): v for k, v in headers.items() if k.lower().startswith("x-ratelimit")}
    if rl:
        out["rate_limit_headers"] = rl
    if status is None:
        out["verdict"] = "unreachable"
        out["error"] = body.decode("utf-8", "replace")[:300]
        return out, None
    js = None
    if status == 200:
        try:
            js = json.loads(body.decode("utf-8", "replace"))
        except Exception as e:
            out["verdict"] = "bad-json"
            out["error"] = str(e)[:300]
            return out, None
    if status not in (expect if isinstance(expect, (list, tuple)) else [expect]):
        out["verdict"] = "status-mismatch"
    return out, js


def check_fields(case, js, top_keys, item_keys):
    """Record presence exactly as observed; missing keys are listed, never filled."""
    missing = [k for k in top_keys if not isinstance(js, dict) or k not in js]
    case["missing_top_level_fields"] = missing
    if item_keys and isinstance(js, dict):
        arr = js.get("markets") or js.get("events") or js.get("series") or js.get("trades") or js.get("candlesticks") or []
        sample = arr[0] if isinstance(arr, list) and arr else None
        case["items_seen"] = len(arr) if isinstance(arr, list) else 0
        if sample is None:
            case["item_fields_missing"] = item_keys
            case["item_note"] = "no items in this response, so item fields could not be checked"
        else:
            case["item_fields_present"] = [k for k in item_keys if k in sample]
            case["item_fields_missing"] = [k for k in item_keys if k not in sample]
    bad = [k for k in case.get("missing_top_level_fields", []) ]
    if bad or case.get("item_fields_missing"):
        case["verdict"] = "field-mismatch"
    elif "verdict" not in case:
        case["verdict"] = "ok"


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out_path = "data/endpoint_contract.json"
    if "--out" in argv:
        out_path = argv[argv.index("--out") + 1]
    started = datetime.now(timezone.utc)
    log = []

    def say(msg):
        line = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')}Z {msg}"
        log.append(line)
        print(line, flush=True)

    cases = []
    no_sample = [False]   # set if the discovery sweep produced no market at all
    say(f"endpoint contract probe start base={BASE}")

    def add(cid, url, expect, doc, what, top_keys=(), item_keys=(), informative=False, mutate=None, needs_sample=False):
        time.sleep(PACE_S)
        if needs_sample and no_sample[0]:
            # The per-market cases are meaningless without a real ticker: say so
            # instead of asking the API about a made-up one (an unknown order-book
            # ticker legitimately answers 200 with empty arrays, which would look
            # like a pass).
            cases.append({"id": cid, "url": url, "doc": doc, "note": what,
                          "verdict": "no-sample", "informative": True,
                          "expected_status": expect})
            say(f"{cid}: skipped (no market was discovered to build this request from)")
            return None
        obs, js = probe(url, expect, what)
        obs["id"] = cid
        obs["doc"] = doc
        obs["informative"] = informative
        if js is not None:
            check_fields(obs, js, list(top_keys), list(item_keys))
            if mutate:
                try:
                    mutate(obs, js)
                except Exception as e:  # an assertion that cannot run is recorded, not skipped
                    obs["derived_error"] = str(e)[:200]
        elif obs.get("verdict") not in ("status-mismatch", "unreachable", "bad-json"):
            # a request that returned no JSON body but the documented status code
            obs["verdict"] = "ok"
        say(f"{cid}: {obs.get('http_status')} -> {obs['verdict']}"
            + (f" (missing {obs.get('item_fields_missing')})" if obs.get("item_fields_missing") else ""))
        cases.append(obs)
        return js

    # ---- discovery: pick a real, liquid market to drive the per-market cases ----
    now = int(time.time())
    js = add("markets-open", f"{BASE}/markets?status=open&limit=1000&mve_filter=exclude", 200,
             DOCS["get_markets"],
             "status=open is the documented listing filter (values: unopened|open|paused|closed|settled); "
             "the market object's own status field reads 'active' — filter value and field value differ by design.",
             ["markets", "cursor"],
             ["ticker", "event_ticker", "status", "result", "last_price_dollars", "yes_bid_dollars",
              "yes_ask_dollars", "yes_bid_size_fp", "yes_ask_size_fp", "volume_fp", "volume_24h_fp",
              "open_interest_fp", "close_time", "notional_value_dollars", "price_level_structure"])
    mkts = (js or {}).get("markets") or []
    def vol(m):
        try:
            return float(m.get("volume_24h_fp") or 0)
        except (TypeError, ValueError):
            return 0.0
    pick = sorted(mkts, key=vol, reverse=True)[0] if mkts else None
    no_sample[0] = pick is None
    say(f"markets-open items: {len(mkts)}; sample market for per-market cases: "
        + (pick["ticker"] if pick else "(none — per-market cases will report unreachable/empty)"))
    tk = pick["ticker"] if pick else "CONTRACT-PROBE-NO-MARKET"
    et = pick.get("event_ticker") if pick else "CONTRACT-PROBE-NO-MARKET"
    st = (pick.get("series_ticker") or (et or "").split("-")[0]) if pick else "CONTRACT-PROBE"

    # ---- the endpoints the browser engine actually calls ----
    add("markets-tickers-batch", f"{BASE}/markets?tickers={urllib.parse.quote(tk)}", 200,
        DOCS["get_markets"],
        "watchlist polling shape: with tickers as the only filter every matching market is returned in one "
        "response and the cursor is empty (documented), so one request can carry 200 tickers.",
        ["markets"], ["ticker", "status"],
        mutate=batch_check, needs_sample=True)
    add("markets-event", f"{BASE}/markets?event_ticker={urllib.parse.quote(et)}", 200,
        DOCS["get_markets"], "event expansion: one request returns every market of the event.",
        ["markets"], ["ticker", "event_ticker"], needs_sample=True)
    add("markets-series", f"{BASE}/markets?series_ticker={urllib.parse.quote(st)}&status=open&limit=1000", 200,
        DOCS["get_markets"], "series discovery: the sweep that catches fast-cycling series /events paging misses.",
        ["markets"], ["ticker", "series_ticker"])
    add("orderbook", f"{BASE}/markets/{urllib.parse.quote(tk)}/orderbook?depth=10", 200,
        DOCS["orderbook"],
        "depth = price levels per side, counted from the best bid; 1-100 valid; bids only (asks are the "
        "documented reciprocal). Ascending order with the best bid LAST is what the ladder in the UI assumes.",
        ["orderbook_fp"],
        mutate=ascending_check, needs_sample=True)
    add("orderbook-depth-rejected", f"{BASE}/markets/{urllib.parse.quote(tk)}/orderbook?depth=101", 400,
        DOCS["orderbook"], "documented: values above 100 are rejected with 400.", needs_sample=True)
    add("trades", f"{BASE}/markets/trades?ticker={urllib.parse.quote(tk)}&limit=1000&min_ts={now - 3600}&max_ts={now}", 200,
        DOCS["trades"],
        "the seconds/minutes chart windows are built from this tape (candlesticks have no sub-minute period).",
        ["trades", "cursor"],
        ["trade_id", "ticker", "count_fp", "yes_price_dollars", "no_price_dollars",
         "taker_outcome_side", "taker_book_side", "created_time", "is_block_trade"], needs_sample=True)
    add("trades-ms-rejected", f"{BASE}/markets/trades?ticker={urllib.parse.quote(tk)}&min_ts={now * 1000}", 400,
        DOCS["trades"], "documented: min_ts/max_ts are seconds; millisecond values are rejected with 400.", needs_sample=True)
    n = 1
    for interval, label in (("1", "1-min"), ("60", "60-min"), ("1440", "daily")):
        add(f"candles-{interval}", f"{BASE}/series/{urllib.parse.quote(st)}/markets/{urllib.parse.quote(tk)}"
            f"/candlesticks?start_ts={now - 6 * 3600 * (1 if interval == '1' else (60 if interval == '60' else 1440))}"
            f"&end_ts={now}&period_interval={interval}", 200, DOCS["candlesticks"],
            f"{label} candles: the only intervals the endpoint accepts (1, 60, 1440).",
            ["candlesticks"], ["end_period_ts", "price", "volume_fp", "open_interest_fp"],
            needs_sample=True)
    add("candles-interval-rejected", f"{BASE}/series/{urllib.parse.quote(st)}/markets/{urllib.parse.quote(tk)}"
        f"/candlesticks?start_ts={now - 3600}&end_ts={now}&period_interval=0", 400,
        DOCS["candlesticks"], "period_interval 0 is not one of 1/60/1440 — the request the chart used to make, before the fix.", needs_sample=True)
    add("events-open", f"{BASE}/events?status=open&limit=200", 200, DOCS["get_events"],
        "the discovery sweep's page size.", ["events", "cursor"],
        ["event_ticker", "series_ticker", "title", "sub_title", "mutually_exclusive", "settlement_sources"])
    add("events-limit-1000", f"{BASE}/events?status=open&limit=1000", [200, 400], DOCS["get_events"],
        "documented maximum is 200; the docs do not say whether an over-limit page size is clamped or "
        "rejected, so this case only records which it is (the client keeps to 200 either way).",
        informative=True)
    add("markets-status-active-filter", f"{BASE}/markets?status=active&limit=10", [400], DOCS["get_markets"],
        "the /markets status FILTER enum is unopened|open|paused|closed|settled — 'active' is a market's own "
        "status VALUE, not a filter value. Recorded so a future API change is visible.", informative=True)
    add("settled-resolutions", f"{BASE}/markets?status=settled&min_settled_ts={now - 72 * 3600}&limit=1000&mve_filter=exclude",
        200, DOCS["get_markets"],
        "the Resolved page's source: settled markets must carry the official result (yes/no) and settlement "
        "fields, which is how a resolution is recorded without a websocket.",
        ["markets", "cursor"], ["ticker", "status", "result"],
        mutate=result_check, needs_sample=True)
    add("series-list", f"{BASE}/series?category=Crypto&include_volume=true&limit=1000", 200,
        DOCS["get_series_list"],
        "per-topic series listing: carries the official volume, the per-series fee multiplier the paper "
        "broker uses, and the settlement sources the alert chats link.",
        ["series"], ["ticker", "title", "category", "fee_multiplier", "fee_type"])
    add("series-detail", f"{BASE}/series/{urllib.parse.quote(st)}", 200, DOCS["get_series"],
        "one series record: fee_multiplier/fee_type and settlement_sources for the selected market's series.",
        ["series"], ["ticker", "title"])
    add("exchange-status", f"{BASE}/exchange/status", 200, DOCS["environments"],
        "exchange/trading flags the status strip reads.", ["exchange_active", "trading_active"])

    # ---- CORS: the whole live model depends on the browser being allowed to call ----
    obs, _ = probe(f"{BASE}/markets?limit=1", 200,
                   "browser fetch from the Pages origin: the demo API reflects the caller's Origin, which is "
                   "what makes an unauthenticated live dashboard from a static page possible.")
    obs["id"] = "cors-origin"
    obs["doc"] = DOCS["environments"]
    acao = obs.get("access_control_allow_origin")
    obs["requested_origin"] = PAGES_ORIGIN
    obs["verdict"] = "ok" if acao == PAGES_ORIGIN else ("cors-missing" if acao is None else "origin-not-echoed")
    say(f"cors-origin: {obs.get('http_status')} -> {obs['verdict']} (allow-origin={acao!r})")
    obs["informative"] = False
    cases.append(obs)

    summary = {
        "cases": len(cases),
        "ok": sum(1 for c in cases if c.get("verdict") == "ok"),
        "failed": sum(1 for c in cases if c.get("verdict") not in ("ok", None) and not c.get("informative")),
        "informative": sum(1 for c in cases if c.get("informative")),
    }
    summary["all_ok"] = summary["failed"] == 0
    payload = {
        "generated_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "base": BASE,
        "origin_sent": PAGES_ORIGIN,
        "sample_market": {"ticker": tk, "event_ticker": et, "series_ticker": st} if pick else None,
        "policy": {
            "pace_s": PACE_S,
            "on_429": "single retry after " + str(RETRY_WAITS[0]) + " s, per the official instruction to back off exponentially",
            "no_inference": "a case records what the API returned; unreachable and mismatch are reported as such",
        },
        "docs": DOCS,
        "summary": summary,
        "cases": cases,
        "log": log,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
    print(f"wrote {out_path}: {summary['ok']}/{summary['cases']} ok, "
          f"{summary['failed']} failed, {summary['informative']} informative")
    return 0 if summary["all_ok"] else 1


def batch_check(c, j):
    """Documented paging shape the watchlist poll relies on: with `tickers` as the
    only filter every matching market arrives in one response, `limit` is not
    applied, and the returned cursor is empty."""
    c["returned"] = len(j.get("markets") or [])
    c["cursor_empty_as_documented"] = not j.get("cursor")
    if not c["cursor_empty_as_documented"]:
        c["verdict"] = "paging-shape-mismatch"


def ascending_check(c, j):
    """The order-book ladder in the UI assumes: ascending prices, best (highest) bid last."""
    ob = (j or {}).get("orderbook_fp") or {}
    for side in ("yes_dollars", "no_dollars"):
        levels = ob.get(side) or []
        prices = []
        shape_ok = True
        for lv in levels:
            if not isinstance(lv, list) or len(lv) != 2:
                shape_ok = False
                continue
            try:
                prices.append(float(lv[0]))
                float(lv[1])  # contract count must parse
            except (TypeError, ValueError):
                shape_ok = False
        c[f"{side}_levels"] = len(levels)
        c[f"{side}_ascending_as_documented"] = (shape_ok and prices == sorted(prices))
    if c.get("yes_dollars_ascending_as_documented") and c.get("no_dollars_ascending_as_documented"):
        c.setdefault("verdict", "ok")
    else:
        c["verdict"] = "ladder-order-mismatch"


def result_check(c, j):
    """Settled rows must expose the official result; the Resolved page prints it verbatim."""
    arr = (j or {}).get("markets") or []
    enum = {"yes", "no", "scalar", ""}
    seen = sorted({str(m.get("result")) for m in arr})
    c["result_values_seen"] = seen
    c["results_within_documented_enum"] = all(v in enum for v in seen)
    with_ts = sum(1 for m in arr if m.get("settlement_ts"))
    c["rows_with_settlement_ts"] = with_ts
    c["settled_rows"] = len(arr)
    if arr and not c["results_within_documented_enum"]:
        c["verdict"] = "field-mismatch"
    elif arr and with_ts == 0:
        c["verdict"] = "field-mismatch"
        c["item_note"] = "settled rows carried no settlement_ts"
    else:
        c.setdefault("verdict", "ok")


def selftest():
    """Offline checks of the assertion helpers, using the committed official samples."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fails = 0

    def eq(got, want, label):
        nonlocal fails
        if got == want:
            print(f"pass {label}")
        else:
            fails += 1
            print(f"FAIL {label}: got {got!r} want {want!r}")

    live = json.load(open(os.path.join(here, "data/samples/orderbook-live-sample.json"), encoding="utf-8"))
    c = {}
    ascending_check(c, live["response"])
    eq(c.get("verdict"), "ok", "the verbatim live ladder satisfies the documented order")
    eq((c.get("yes_dollars_levels"), c["no_dollars_levels"]), (5, 3), "level counts read from the live book")

    c = {}
    ascending_check(c, {"orderbook_fp": {"yes_dollars": [["0.5000", "10.00"], ["0.4000", "5.00"]], "no_dollars": []}})
    eq(c.get("verdict"), "ladder-order-mismatch", "a descending book is reported, not silently plotted")

    settled = json.load(open(os.path.join(here, "data/samples/settled-markets-live-sample.json"), encoding="utf-8"))
    c = {}
    result_check(c, settled["response"])
    eq(c.get("verdict"), "ok", "the verbatim settled rows satisfy the result/settlement_ts contract")
    eq(c.get("results_within_documented_enum"), True, "results stay inside the documented enum")

    c = {}
    result_check(c, {"markets": [{"ticker": "T", "result": "maybe", "settlement_ts": None}]})
    eq(c.get("verdict"), "field-mismatch", "an undocumented result value fails the contract")

    c = {}
    result_check(c, {"markets": []})
    eq(c.get("verdict"), "ok", "an empty settled window is not by itself a mismatch (it may be a quiet hour)")

    c = {}
    batch_check(c, {"markets": [{"ticker": "T"}], "cursor": ""})
    eq(c.get("verdict"), None, "the documented single-response paging shape is accepted")
    c = {}
    batch_check(c, {"markets": [{"ticker": "T"}], "cursor": "SHOULD-BE-EMPTY"})
    eq(c.get("verdict"), "paging-shape-mismatch", "a cursor on a tickers-only request breaks the polling assumption")

    print("selftest:", "FAILED" if fails else "ok")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
