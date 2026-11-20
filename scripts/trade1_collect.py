#!/usr/bin/env python3
"""Collect PUBLIC Kalshi market data for the Trade1 dashboard.

Standard library only (python3.11+). Uses only unauthenticated, documented read endpoints
(no API keys, no orders, no account/portfolio access):

  GET /events?status=open&with_nested_markets=true       (get-events)
  GET /series/{series_ticker}                             (get-series, category)
  GET /markets/{ticker}                                   (lifecycle / result)
  GET /historical/markets/{ticker}                        (settled-market fallback)
  GET /markets/{ticker}/orderbook?depth=10                (get-market-orderbook)
  GET /series/{s}/markets/{ticker}/candlesticks           (get-market-candlesticks)

Base: https://external-api.kalshi.com/trade-api/v2 (recommended in docs.kalshi.com).

Output (generated, written to trade1/data/ and committed by .github/workflows/trade1.yml):
  trade1/data/markets.json  current snapshot + top-market detail + jumps
  trade1/data/tracked.json   resolution tracking state (fetched from the live
                           site at the start of each run so it persists)
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://external-api.kalshi.com/trade-api/v2"
OUT = pathlib.Path(os.environ.get("TRADE1_OUT", "trade1/data"))
STATE_URL = os.environ.get("TRADE1_STATE_URL", "")
TOP_N = 6          # per topic: orderbook + hourly candles
TOP_1M = 2         # per topic: also 1-minute candles for the last 24h
JUMP = 0.10        # price move (dollars) that counts as a sharp jump
MAX_ROWS = 150     # rows kept per topic in the published table (counts are full totals)
PAGE_LIMIT = 200
MAX_PAGES = 400    # 200 events/page; must cover all open events, not just the first pages
SLEEP = 0.15       # polite gap between requests
TIME_BUDGET = 900  # seconds for the whole collection; series lookups stop when exceeded
START = time.time()
UA = "Trade1-dashboard/1.0 (+https://github.com/wingbangboozle1-lang/Trade1)"

TOPICS = {
    # Order matters: first match wins. Series category is checked first,
    # then keywords over event/market text (labelled as a keyword match).
    "golf": {"label": "Golf", "cats": [],
             "kw": r"\bgolf\b|\bmasters\b|\bpga\b|\blpga\b|ryder cup|open championship|mcilroy|scheffler"},
    "gas-prices": {"label": "Gas prices", "cats": [],
                   "kw": r"(?<!natural )gas prices?|gasoline|\bdiesel\b"},  # 'natural gas' excluded
    "crypto": {"label": "Crypto", "cats": ["crypto"],
               "kw": r"bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bxrp\b|dogecoin|crypto"},
    "elections": {"label": "Elections", "cats": ["elections"],
                  "kw": r"election|president|senate|congress|governor|primary|nominee|\bvote"},
    "culture": {"label": "Culture", "cats": ["culture", "entertainment"],
                "kw": r"oscar|grammy|emmy|box office|\bmovie|\balbum|billboard|netflix|celebrity|\bmusic\b|\bfilm\b"},
}


def log(msg):
    print(f"[collect] {msg}", file=sys.stderr, flush=True)


def get(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    last_err = None
    for attempt in range(3):
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                time.sleep(SLEEP)
                return json.load(resp)
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code == 404:
                time.sleep(SLEEP)
                raise
            if err.code in (429, 500, 502, 503, 504):
                retry = err.headers.get("Retry-After")
                wait = float(retry) if retry and retry.isdigit() else 2 ** (attempt + 1)
                log(f"HTTP {err.code} on {path}; waiting {wait}s")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as err:
            last_err = err
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"giving up on {path}: {last_err}")


def to_float(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def list_open_events():
    events, cursor = [], ""
    page_no = 0
    for _ in range(MAX_PAGES):
        page_no += 1
        params = {"status": "open", "with_nested_markets": "true", "limit": PAGE_LIMIT}
        if cursor:
            params["cursor"] = cursor
        page = get("/events", params)
        events.extend(page.get("events", []))
        cursor = page.get("cursor") or ""
        if not cursor:
            break
    log(f"open events fetched: {len(events)} (pages={page_no}, last cursor empty={not cursor})")
    return events


_series_cache = {}
SERIES_CATEGORIES = ["Crypto", "Elections", "Culture", "Entertainment", "Sports", "Economics", "Politics",
                     "Companies", "Financials", "Climate and Weather", "Science and Technology", "Energy and Commodities"]


def preload_series_categories():
    """One paged call per category (GET /series?category=...) instead of one call per series."""
    for cat in SERIES_CATEGORIES:
        cursor = ""
        for _ in range(50):
            params = {"category": cat}
            if cursor:
                params["cursor"] = cursor
            try:
                page = get("/series", params)
            except urllib.error.HTTPError as err:
                log(f"series category {cat}: HTTP {err.code}")
                break
            for s in page.get("series", []) or []:
                if s.get("ticker"):
                    _series_cache.setdefault(s["ticker"], s.get("category") or cat)
            cursor = page.get("cursor") or ""
            if not cursor:
                break
    log(f"series categories preloaded: {len(_series_cache)}")


def series_category(series_ticker):
    if series_ticker not in _series_cache:
        if time.time() - START > TIME_BUDGET:
            return None  # over budget: fall back to keyword matching (labelled in match_rule)
        try:
            s = get(f"/series/{urllib.parse.quote(series_ticker)}")
            cat = (s.get("series") or s).get("category")
        except urllib.error.HTTPError:
            cat = None
        _series_cache[series_ticker] = cat or None
    return _series_cache[series_ticker]


def classify(series_cat, text):
    cat = (series_cat or "").lower()
    for key, spec in TOPICS.items():
        if cat and cat in spec["cats"]:
            return key, f"series category: {series_cat}"
    for key, spec in TOPICS.items():
        m = re.search(spec["kw"], text, re.I)
        if m:
            return key, f"keyword match: '{m.group(0)}' in title text (no series category match)"
    return None, None


def build_rows(events):
    rows = []
    for ev in events:
        if time.time() - START > TIME_BUDGET:
            log("time budget reached during row build; remaining events use keyword matching only")
        series = ev.get("series_ticker", "")
        scat = series_category(series)
        for m in ev.get("markets", []) or []:
            text = " ".join(str(x or "") for x in [ev.get("title"), ev.get("sub_title"), m.get("title"),
                                                  m.get("yes_sub_title"), ev.get("event_ticker"), series])
            topic, rule = classify(scat, text)
            if not topic:
                continue
            last = to_float(m.get("last_price_dollars"))
            v24 = to_float(m.get("volume_24h_fp"))
            est = round(v24 * last, 2) if (v24 is not None and last is not None) else None
            rows.append({
                "topic": topic,
                "series_ticker": series,
                "series_category": scat,
                "event_ticker": ev.get("event_ticker"),
                "event_title": ev.get("title"),
                "ticker": m.get("ticker"),
                "market_title": m.get("title"),
                "outcome": m.get("yes_sub_title"),
                "status": m.get("status"),
                "close_time": m.get("close_time"),
                "yes_bid": m.get("yes_bid_dollars"),
                "yes_ask": m.get("yes_ask_dollars"),
                "yes_bid_size": m.get("yes_bid_size_fp"),
                "yes_ask_size": m.get("yes_ask_size_fp"),
                "last_price": m.get("last_price_dollars"),
                "previous_price": m.get("previous_price_dollars"),
                "volume_total": m.get("volume_fp"),
                "volume_24h": m.get("volume_24h_fp"),
                "open_interest": m.get("open_interest_fp"),
                "est_dollars_24h": est,
                "result": m.get("result") or None,
                "match_rule": rule,
                "source_url": f"{BASE}/markets/{m.get('ticker')}",
            })
    return rows


def parse_candles(payload):
    out = []
    for c in payload.get("candlesticks", []) or []:
        price = c.get("price") or {}
        out.append({
            "t": c.get("end_period_ts"),
            "p": to_float(price.get("close_dollars")),
            "vol": c.get("volume_fp"),
        })
    return out


def orderbook_levels(levels):
    res = []
    for lv in levels or []:
        if isinstance(lv, list) and len(lv) == 2:
            res.append({"price": lv[0], "contracts": lv[1]})
    return res


def main():
    now = int(time.time())
    OUT.mkdir(parents=True, exist_ok=True)
    generated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    # ---- 1. current open events -> topic rows
    preload_series_categories()
    events = list_open_events()
    rows = build_rows(events)
    log(f"matched market rows: {len(rows)}")

    # ---- 2. top markets per topic
    by_topic = {k: [] for k in TOPICS}
    for r in rows:
        by_topic[r["topic"]].append(r)
    top_detail, top_tickers = {}, {}
    for key in TOPICS:
        ranked = sorted(by_topic[key], key=lambda r: (r["est_dollars_24h"] is None,
                                                       -(r["est_dollars_24h"] or 0)))
        for rank, r in enumerate(ranked[:TOP_N]):
            top_tickers[r["ticker"]] = key
            r["top_rank"] = rank + 1
            detail = {"ticker": r["ticker"], "series_ticker": r["series_ticker"], "topic": key}
            try:
                ob = get(f"/markets/{r['ticker']}/orderbook", {"depth": 10})
                book = ob.get("orderbook_fp") or {}
                detail["orderbook"] = {"yes_bids": orderbook_levels(book.get("yes_dollars")),
                                       "no_bids": orderbook_levels(book.get("no_dollars")),
                                       "source_url": f"{BASE}/markets/{r['ticker']}/orderbook?depth=10"}
            except urllib.error.HTTPError as err:
                detail["orderbook_error"] = f"HTTP {err.code}"
            cpath = f"/series/{urllib.parse.quote(r['series_ticker'])}/markets/{urllib.parse.quote(r['ticker'])}/candlesticks"
            try:
                c60 = get(cpath, {"start_ts": now - 7 * 86400, "end_ts": now, "period_interval": 60})
                detail["candles_1h"] = parse_candles(c60)
                detail["candles_1h_source"] = f"{BASE}{cpath}?period_interval=60"
            except urllib.error.HTTPError as err:
                detail["candles_1h_error"] = f"HTTP {err.code}"
            if rank < TOP_1M:
                try:
                    c1 = get(cpath, {"start_ts": now - 86400, "end_ts": now, "period_interval": 1})
                    detail["candles_1m"] = parse_candles(c1)
                    detail["candles_1m_source"] = f"{BASE}{cpath}?period_interval=1"
                except urllib.error.HTTPError as err:
                    detail["candles_1m_error"] = f"HTTP {err.code}"
            top_detail[r["ticker"]] = detail
    log(f"top markets detailed: {len(top_detail)}")

    # ---- 3. sharp jumps (>= $0.10 between consecutive hourly closes)
    jumps = []
    for tkr, d in top_detail.items():
        cs = [c for c in d.get("candles_1h", []) if c["p"] is not None and c["t"]]
        for a, b in zip(cs, cs[1:]):
            delta = round(b["p"] - a["p"], 4)
            if abs(delta) >= JUMP - 1e-9:
                jumps.append({
                    "topic": d["topic"], "ticker": tkr,
                    "title": next((r["market_title"] for r in rows if r["ticker"] == tkr), None),
                    "from_ts": a["t"], "to_ts": b["t"],
                    "from_price": a["p"], "to_price": b["p"], "delta": delta,
                    "source_url": d.get("candles_1h_source"),
                    "cause": None,  # no official cause source is collected automatically
                    "cause_status": "unverified: no official source linked",
                })

    # ---- 4. resolution tracking (persisted via the live site between runs)
    tracked = {}
    if STATE_URL:
        try:
            req = urllib.request.Request(STATE_URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as resp:
                tracked = json.load(resp).get("tracked", {})
            log(f"loaded tracking state: {len(tracked)} markets")
        except Exception as err:  # first run or site not yet deployed
            log(f"no prior tracking state ({err}); starting empty")
    for tkr, topic in top_tickers.items():
        tracked.setdefault(tkr, {"topic": topic, "first_seen": generated, "resolved": None})
    for tkr, t in tracked.items():
        if t.get("resolved"):
            continue
        try:
            m = get(f"/markets/{urllib.parse.quote(tkr)}").get("market", {})
            src = f"{BASE}/markets/{tkr}"
        except urllib.error.HTTPError as err:
            if err.code != 404:
                t["lookup_error"] = f"HTTP {err.code}"
                continue
            try:
                m = get(f"/historical/markets/{urllib.parse.quote(tkr)}").get("market", {})
                src = f"{BASE}/historical/markets/{tkr}"
            except urllib.error.HTTPError as err2:
                t["lookup_error"] = f"HTTP {err2.code}"
                continue
        t["status"] = m.get("status")
        t["title"] = m.get("title")
        t["checked_at"] = generated
        t["source_url"] = src
        t.pop("lookup_error", None)
        res = (m.get("result") or "").lower()
        if res in ("yes", "no"):
            t["resolved"] = {"result": res, "status": m.get("status"), "close_time": m.get("close_time"),
                             "source_url": src}

    # ---- 5. write outputs
    topics_out = {}
    for key, spec in TOPICS.items():
        ranked = sorted(by_topic[key], key=lambda r: -(r["est_dollars_24h"] or 0))[:MAX_ROWS]
        rs = sorted(ranked, key=lambda r: (r["event_ticker"] or "", -(r["est_dollars_24h"] or 0)))
        topics_out[key] = {"label": spec["label"], "count": len(by_topic[key]), "shown": len(rs), "rows": rs}

    unverified = []
    for key, t in topics_out.items():
        for r in t["rows"]:
            missing = [f for f in ("yes_bid", "yes_ask", "last_price", "volume_24h", "open_interest", "close_time")
                       if r.get(f) in (None, "")]
            if missing:
                unverified.append({"type": "missing_fields", "topic": key, "ticker": r["ticker"],
                                   "fields": missing, "source_url": r["source_url"]})
    for j in jumps:
        unverified.append({"type": "jump_without_cause", "topic": j["topic"], "ticker": j["ticker"],
                           "source_url": j["source_url"]})
    for tkr, t in tracked.items():
        if t.get("lookup_error"):
            unverified.append({"type": "resolution_lookup_failed", "topic": t.get("topic"), "ticker": tkr,
                               "source_url": f"{BASE}/markets/{tkr}"})

    markets = {
        "generated_at": generated,
        "source": {"api_base": BASE, "docs": "https://docs.kalshi.com/welcome",
                   "note": "All values are copied from Kalshi public API responses at generated_at. "
                           "Blank = not returned by the source (flagged as unverified)."},
        "counts": {k: v["count"] for k, v in topics_out.items()},
        "topics": topics_out,
        "top_detail": top_detail,
        "jumps": sorted(jumps, key=lambda j: -abs(j["delta"])),
        "resolved": [{"ticker": k, **{x: v.get(x) for x in ("topic", "title", "status", "checked_at", "source_url")},
                      "result": v["resolved"]["result"], "resolved_source": v["resolved"]["source_url"]}
                     for k, v in tracked.items() if v.get("resolved")],
        "tracking": [{"ticker": k, "topic": v.get("topic"), "title": v.get("title"), "status": v.get("status"),
                      "first_seen": v.get("first_seen"), "checked_at": v.get("checked_at"),
                      "source_url": v.get("source_url")}
                     for k, v in tracked.items() if not v.get("resolved")],
        "unverified": unverified,
    }
    (OUT / "markets.json").write_text(json.dumps(markets, indent=1, ensure_ascii=False))
    (OUT / "tracked.json").write_text(json.dumps({"generated_at": generated, "tracked": tracked},
                                                 indent=1, ensure_ascii=False))
    log(f"wrote {OUT/'markets.json'}: rows={sum(markets['counts'].values())} jumps={len(jumps)} "
        f"resolved={len(markets['resolved'])} unverified={len(unverified)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # fail loudly so the workflow shows the problem
        log(f"FAILED: {err!r}")
        sys.exit(1)
