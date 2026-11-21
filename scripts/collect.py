#!/usr/bin/env python3
"""
Kalshi demo API verification + snapshot collector (Python stdlib only).

Runs on GitHub Actions (the runner has unrestricted egress; the dev sandbox does
not). Every value written to data/ comes verbatim from the endpoint whose exact
URL is logged in data/log.md next to the fetch. Nothing is inferred: fields
that a response does not contain are left out (never defaulted), and every
trimmed record keeps the literal fields from the live response.

Outputs (all under data/):
  log.md                     - one line per request: time, method, URL, status, size
  meta.json                  - run metadata + endpoint behavior findings
  cors.json                  - CORS probe results (exact response headers)
  exchange-status.json       - GET /exchange/status (verbatim)
  categories.json            - distinct event categories observed on open events
  topics/<id>.json           - per-topic ranked events + markets (trimmed, sourced)
  resolved.json              - recently settled in-scope markets with result (yes/no)
  samples/*.json             - raw sample objects for line-by-line field verification
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
ALT = "https://demo-api.kalshi.co/trade-api/v2"
PAGES_ORIGIN = "https://wingbangboozle1-lang.github.io"
OUT = "data"
MAX_PAGES = 6
UA = "Trade1-verify/1.0 (github.com/wingbangboozle1-lang/Trade1)"

LOG = []


def log(msg):
    line = f"- {datetime.now(timezone.utc).strftime('%H:%M:%S')}Z {msg}"
    LOG.append(line)
    print(line, flush=True)


def get(url, origin=None, method="GET", timeout=45):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(url, headers=headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            hs = {k.lower(): v for k, v in r.headers.items()}
            code = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        hs = {k.lower(): v for k, v in e.headers.items()}
        code = e.code
    except Exception as e:  # network-level failure
        log(f"NET-FAIL {method} {url} :: {type(e).__name__}: {e}")
        return None, {}, b"", time.time() - t0
    return code, hs, body, time.time() - t0


def fetch_json(url, note=""):
    code, hs, body, dt = get(url)
    if code == 200 and body:
        try:
            j = json.loads(body)
        except Exception as e:
            log(f"BAD-JSON {url} :: {e}")
            return None
        log(f"GET {url} -> 200, {len(body):,}B in {dt:.1f}s {note}")
        return j
    log(f"GET {url} -> {code} ({len(body)}B) {note}"
        + (f" body={body[:220]!r}" if body else ""))
    return None


def paged(path, params, key, max_pages=MAX_PAGES):
    items, cursor, pages, urls = [], "", 0, []
    while pages < max_pages:
        q = dict(params)
        if cursor:
            q["cursor"] = cursor
        url = f"{BASE}{path}?{urllib.parse.urlencode(q)}" if q else f"{BASE}{path}"
        urls.append(url)
        j = fetch_json(url)
        pages += 1
        if not j:
            break
        batch = j.get(key) or []
        items.extend(batch)
        cursor = j.get("cursor") or ""
        log(f"  page {pages}: +{len(batch)} items (total {len(items)}); cursor={'present' if cursor else 'empty'}")
        if not cursor:
            break
    return items, urls


def wjson(path, obj):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    log(f"WROTE {full} ({os.path.getsize(full):,}B)")


# ---- field trimming: only fields actually present in the response are kept ----
MARKET_FIELDS = [
    "ticker", "event_ticker", "series_ticker", "market_type", "title", "subtitle",
    "yes_sub_title", "no_sub_title", "status", "result", "last_price_dollars",
    "previous_price_dollars", "previous_yes_bid_dollars", "yes_bid_dollars",
    "yes_ask_dollars", "no_bid_dollars", "no_ask_dollars", "yes_bid_size_fp",
    "yes_ask_size_fp", "no_bid_size_fp", "no_ask_size_fp", "volume", "volume_fp",
    "volume_24h", "volume_24h_fp", "open_interest", "open_interest_fp",
    "liquidity", "notional_volume", "open_time", "close_time",
    "expected_expiration_time", "latest_expiration_time", "can_close_early",
    "strike_type", "price_level_structure", "settlement_ts", "settlement_value_dollars",
]
EVENT_FIELDS = [
    "event_ticker", "series_ticker", "title", "sub_title", "category",
    "mutually_exclusive", "strike_date", "open_time", "close_time",
    "last_updated_ts", "settlement_sources",
]


def trim(obj, fields):
    return {k: obj[k] for k in fields if k in obj}


def series_guess(et):
    """KXETHD-26NOV2117 -> KXETHD ; KXNEXTSPEAKER-31-APRE -> KXNEXTSPEAKER"""
    return (et or "").split("-")[0]


def fnum(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def est_dollar_volume(m):
    """Estimated traded notional = contracts x last trade price. ESTIMATE only:
    no official per-market dollar-notional field is present in demo responses
    (flagged; volume_fp x last_price_dollars, not an exchange-published figure)."""
    v, p = fnum(m.get("volume_fp") or m.get("volume")), fnum(m.get("last_price_dollars"))
    if v is None or p is None:
        return None
    return round(v * p, 2)


def load_topics():
    with open("scripts/topics.json", encoding="utf-8") as f:
        return json.load(f)["topics"]


_BOUNDED_CACHE = {}


def bounded_re(pattern):
    """Compile a '|'-separated keyword pattern with word boundaries.

    Plain substring matching is too loose: 'petrol' matched the Romanian
    basketball club "CSM BBA Petrolul Ploiesti" and 'gas price' matched
    "Natural Gas price ..." (flagged item 9d-1). Word boundaries keep
    multi-word phrases ('gas price') intact but require a real word edge, so
    'petrol' no longer matches 'Petrolul'. The source patterns themselves are
    unchanged - only the matching semantics - so scripts/topics.json and
    assets/model.js stay in sync.
    """
    if not pattern:
        return None
    rx = _BOUNDED_CACHE.get(pattern)
    if rx is None:
        parts = [p.strip() for p in pattern.split("|") if p.strip()]
        rx = re.compile(r"\b(?:" + "|".join(re.escape(p) for p in parts) + r")\b", re.I)
        _BOUNDED_CACHE[pattern] = rx
    return rx


def topic_excluded(topic, title, series, category):
    """True when a topic's OWN exclusion rules reject this title / series.

    A topic's exclude_keywords are intentionally matched as substrings (not
    word-bounded) so a ticker fragment such as 'natgas' in 'KXNATGAS15M' is
    caught as well as the phrase 'natural gas' in a title.
    """
    if topic.get("exclude_categories") and category and category in topic["exclude_categories"]:
        return True
    excl = topic.get("exclude_keywords")
    if excl and re.search(excl, f"{title} {series}", re.I):
        return True
    return False


def topic_title_hit(topic, title):
    """The keyword that matched the title (word-bounded), or None."""
    rx = bounded_re(topic.get("title_keywords"))
    if not rx:
        return None
    m = rx.search(title or "")
    return m.group(0) if m else None


def classify(event, topics):
    title = f"{event.get('title', '')} {event.get('sub_title', '')}"
    series = event.get("series_ticker", "") or ""
    cat = event.get("category") or ""
    for t in topics:
        if topic_excluded(t, title, series, cat):
            continue  # e.g. Trump golf-club markets sit in Politics, not Golf (PR #20)
        if cat and cat in t["categories"]:
            if not t["title_keywords"] or topic_title_hit(t, title):
                return t["id"], "category"
        if t["series_prefix"] and re.search(t["series_prefix"], series, re.I):
            return t["id"], "series-prefix"
    return None, None


def classify_settled(m, e, topics):
    """Classify one SETTLED market. `e` is its event object when the event is
    still in the open-events list, otherwise None (settled events age out of
    it, which is the normal case).

    Returns (topic_id, reason) or (None, None).

    The fallback branch (event not in the open list) applies the topic's OWN
    exclusion rules and matches title keywords on word boundaries - without
    both, 'Natural Gas price up in next 15 mins?' (natural gas, which the
    gas-prices topic excludes) and 'CSM BBA Petrolul Ploiesti wins' ('petrol'
    inside 'Petrolul') were both labelled gas-prices (flagged item 9d-1).
    """
    title = (m.get("title") or "") + " " + (e.get("title", "") if e else "")
    series = m.get("series_ticker") or (e.get("series_ticker", "") if e else "") or ""
    probe = {"event_ticker": m.get("event_ticker"), "title": title,
             "series_ticker": series or series_guess(m.get("event_ticker")),
             "category": e.get("category") if e else None}
    tid, why = classify(probe, topics)
    if tid or e:
        return tid, why
    for t in topics:
        if topic_excluded(t, title, probe["series_ticker"], None):
            continue
        if t["series_prefix"] and re.search(t["series_prefix"], probe["series_ticker"], re.I):
            return t["id"], "series-prefix"
        if topic_title_hit(t, title):
            return t["id"], "title-keyword"
    return None, None


def main():
    os.makedirs(OUT, exist_ok=True)
    started = datetime.now(timezone.utc)
    log(f"collector start {started.isoformat()} base={BASE}")

    topics = load_topics()

    # ---------- 1. CORS probes (exact response headers, verbatim) ----------
    cors = {"probed_at": started.isoformat(), "endpoints": [BASE, ALT], "probes": []}
    for label, url, origin, method in [
        ("GET no-origin", f"{BASE}/exchange/status", None, "GET"),
        ("GET pages-origin", f"{BASE}/exchange/status", PAGES_ORIGIN, "GET"),
        ("GET example-origin", f"{BASE}/exchange/status", "https://example.com", "GET"),
        ("GET alt-host pages-origin", f"{ALT}/exchange/status", PAGES_ORIGIN, "GET"),
        ("OPTIONS preflight pages-origin", f"{BASE}/markets", PAGES_ORIGIN, "OPTIONS"),
    ]:
        code, hs, body, dt = get(url, origin=origin, method=method)
        interesting = {k: v for k, v in hs.items()
                       if k.startswith("access-control-") or k == "vary"}
        cors["probes"].append({
            "label": label, "method": method, "url": url,
            "request_origin": origin or "(none)", "http_status": code,
            "latency_s": round(dt, 2),
            "response_headers": interesting,  # verbatim header values
        })
        log(f"CORS {method} {url} origin={origin or '(none)'} -> {code}; ACAO={interesting.get('access-control-allow-origin')!r}")
    wjson("cors.json", cors)

    # ---------- 2. exchange status ----------
    ex = fetch_json(f"{BASE}/exchange/status", "(exchange status)")
    if ex:
        wjson("exchange-status.json", {"fetched_from": f"{BASE}/exchange/status", "response": ex})

    # ---------- 3. open events (paged) ----------
    events, event_urls = paged("/events", {"status": "open", "limit": "200"}, "events", max_pages=12)
    events_status_open_ok = bool(events) or len(event_urls) > 0
    log(f"open events collected: {len(events)}")

    # ---------- 4. open markets (paged). Docs document status=open; the live demo
    # emits status 'active' - we record which call shape works and what it returns.
    markets, market_urls = paged("/markets", {"status": "open", "limit": "1000", "mve_filter": "exclude"}, "markets")
    markets_status_open_ok = bool(markets)
    if not markets:  # retry without mve_filter in case that param is rejected
        log("mve_filter=exclude sweep empty - retrying plain")
        markets, market_urls = paged("/markets", {"status": "open", "limit": "1000"}, "markets")
        markets_status_open_ok = bool(markets)
    if not markets:
        log("status=open returned no markets - retrying without status filter")
        markets, market_urls = paged("/markets", {"limit": "1000"}, "markets")
    log(f"open markets collected: {len(markets)}")

    statuses = {}
    for m in markets:
        statuses[m.get("status", "?")] = statuses.get(m.get("status", "?"), 0) + 1
    log(f"market statuses observed: {statuses}")

    # ---------- 5. join markets to events, classify topics ----------
    ev_by_ticker = {e["event_ticker"]: e for e in events if e.get("event_ticker")}
    buckets = {t["id"]: [] for t in topics}
    unclassified = 0
    for e in events:
        tid, why = classify(e, topics)
        if not tid:
            unclassified += 1
            continue
        buckets[tid].append((e, why))

    # ---- 5b. per-topic series discovery (authoritative: GET /series?category=) ----
    # Covers fast-cycling series (hourly crypto, daily AAA gas) that /events
    # paging cannot reach; series carry settlement_sources + official volume.
    have_tickers = {m.get("ticker") for m in markets if m.get("ticker")}
    series_stats = {}
    series_per_topic = {}
    for t in topics:
        seen_series, matched = set(), []
        for cat in t["categories"]:
            j = fetch_json(f"{BASE}/series?category={urllib.parse.quote(cat)}"
                           f"&include_volume=true&limit=1000", "(series list)")
            for sr in (j or {}).get("series") or []:
                tick = sr.get("ticker")
                if not tick or tick in seen_series:
                    continue
                hay = f"{sr.get('title') or ''} {tick}"
                if t.get("exclude_keywords") and re.search(t["exclude_keywords"], hay, re.I):
                    continue
                if t["title_keywords"] and not (
                        topic_title_hit(t, sr.get("title") or "")
                        or re.search(t["series_prefix"], tick, re.I)):
                    continue
                seen_series.add(tick)
                matched.append(sr)
        matched.sort(key=lambda sr: fnum(sr.get("volume_fp")) or 0, reverse=True)
        series_per_topic[t["id"]] = len(matched)
        log(f"topic {t['id']}: {len(matched)} series matched (categories {t['categories']}); fetching top {min(40, len(matched))} by volume")
        for sr in matched[:40]:
            j = fetch_json(f"{BASE}/markets?series_ticker={urllib.parse.quote(sr['ticker'])}"
                           f"&status=open&limit=1000", "(series markets)")
            ms = (j or {}).get("markets") or []
            series_stats[sr["ticker"]] = len(ms)
            for m in ms:
                if not m.get("ticker") or m["ticker"] in have_tickers:
                    continue
                have_tickers.add(m["ticker"])
                markets.append(m)
                et = m.get("event_ticker")
                if et and not any(pe[0]["event_ticker"] == et for pe in buckets[t["id"]]):
                    buckets[t["id"]].append((
                        {"event_ticker": et, "title": m.get("title"),
                         "series_ticker": sr["ticker"], "category": sr.get("category"),
                         "settlement_sources": sr.get("settlement_sources"), "_stub": True},
                        "series-discovery"))
    log(f"markets after series discovery: {len(markets)}")

    # rank each bucket by provisional est dollar volume from sweep membership,
    # then fetch official metadata + complete market set per event (per-topic budget)
    for tid, pairs in buckets.items():
        def provisional(pe):
            e = pe[0]
            return sum((fnum(m.get("volume_fp")) or 0) * (fnum(m.get("last_price_dollars")) or 0)
                       for m in markets if m.get("event_ticker") == e["event_ticker"])
        pairs.sort(key=provisional, reverse=True)

    ev_fetch_count, ev_fetch_urls = 0, []
    for tid, pairs in buckets.items():
        budget = 60
        for e, why in pairs:
            if budget <= 0:
                break
            et = e["event_ticker"]
            if e.get("_stub") or "category" not in e or not e.get("settlement_sources"):
                je = fetch_json(f"{BASE}/events/{urllib.parse.quote(et)}", "(event metadata)")
                ev_fetch_count += 1
                budget -= 1
                if je and je.get("event"):
                    e.update({k: je["event"][k] for k in EVENT_FIELDS if k in je["event"]})
            url = f"{BASE}/markets?event_ticker={urllib.parse.quote(et)}"
            j = fetch_json(url, "(event markets)")
            ev_fetch_count += 1
            budget -= 1
            if j and j.get("markets"):
                if len(ev_fetch_urls) < 5:
                    ev_fetch_urls.append(url)
                for m in j["markets"]:
                    if m.get("ticker") and m["ticker"] not in have_tickers:
                        have_tickers.add(m["ticker"])
                        markets.append(m)
        log(f"topic {tid}: event fetch budget used {60 - budget}")
    log(f"markets after per-event fetch: {len(markets)}")

    # market-level classification pass: derive a series guess from the event
    # ticker and classify by title/series so fast-cycling series (hourly crypto,
    # daily AAA gas) are covered even when /events paging misses them.
    for m in markets:
        et = m.get("event_ticker")
        if not et or any(e["event_ticker"] == et for pairs in buckets.values() for e, _ in pairs):
            continue
        sg = series_guess(et)
        tid, why = classify({"title": m.get("title"), "series_ticker": sg}, topics)
        if tid:
            buckets[tid].append(({"event_ticker": et, "title": m.get("title"),
                                  "series_ticker": sg, "category": m.get("category")}, why))

    topic_files = {}
    for t in topics:
        tid = t["id"]
        rows = []
        for e, why in buckets[tid]:
            ms = [trim(m, MARKET_FIELDS) for m in markets if m.get("event_ticker") == e["event_ticker"]]
            for m in ms:
                m["_est_dollar_volume"] = est_dollar_volume(m)
                m["_est_dollar_volume_24h"] = (
                    round(fnum(m.get("volume_24h_fp") or m.get("volume_24h") or 0) * (fnum(m.get("last_price_dollars")) or 0), 2)
                    if fnum(m.get("volume_24h_fp") or m.get("volume_24h")) is not None else None)
            total_vol = sum(fnum(m.get("volume_fp") or m.get("volume")) or 0 for m in ms)
            total_dv = sum(m["_est_dollar_volume"] or 0 for m in ms)
            ev_trim = trim(e, EVENT_FIELDS)
            ev_trim["_match_reason"] = why
            ev_trim["_est_dollar_volume"] = round(total_dv, 2)
            ev_trim["_volume_contracts"] = round(total_vol, 2)
            ev_trim["_market_count"] = len(ms)
            ev_trim["_markets"] = sorted(
                ms, key=lambda m: (m["_est_dollar_volume"] or 0), reverse=True)[:8]
            rows.append(ev_trim)
        rows.sort(key=lambda r: r["_est_dollar_volume"], reverse=True)
        payload = {
            "topic": tid,
            "label": t["label"],
            "generated_at": started.isoformat(),
            "source_base": BASE,
            "source_urls": {
                "events": event_urls[:3],
                "markets": market_urls[:3],
                "event_markets_example": ev_fetch_urls[:2],
            },
            "definition": {"categories": t["categories"],
                           "title_keywords": t["title_keywords"],
                           "series_prefix": t["series_prefix"]},
            "event_count": len(rows),
            "events": rows[:30],
        }
        wjson(f"topics/{tid}.json", payload)
        topic_files[tid] = payload

    categories = {}
    for e in events:
        c = e.get("category") or "(none)"
        categories[c] = categories.get(c, 0) + 1
    wjson("categories.json", {
        "generated_at": started.isoformat(),
        "source_urls": event_urls[:3],
        "open_event_count": len(events),
        "categories": dict(sorted(categories.items(), key=lambda kv: -kv[1])),
        "unclassified_events": unclassified,
    })
    log(f"categories observed: {categories}; unclassified events: {unclassified}")

    # ---------- 6. settled markets (recent) -> resolution outcomes ----------
    since = int(time.time()) - 3 * 24 * 3600
    settled, settled_urls = paged("/markets", {
        "status": "settled", "min_settled_ts": str(since), "limit": "1000",
        "mve_filter": "exclude"}, "markets")
    log(f"settled markets collected (last 3 days): {len(settled)}")
    in_scope = []
    for m in settled:
        e = ev_by_ticker.get(m.get("event_ticker"))
        title = (m.get("title") or "") + " " + (e.get("title", "") if e else "")
        tid, why = classify_settled(m, e, topics)
        if tid:
            row = trim(m, MARKET_FIELDS)
            row["_topic"] = tid
            row["_event_title"] = e.get("title") if e else None
            in_scope.append(row)
    in_scope.sort(key=lambda m: m.get("settlement_ts") or "", reverse=True)
    wjson("resolved.json", {
        "generated_at": started.isoformat(),
        "window": "last 3 days (min_settled_ts = now-72h)",
        "source_urls": settled_urls[:3],
        "settled_total": len(settled),
        "in_scope_count": len(in_scope),
        "markets": in_scope[:200],
    })

    # ---------- 7. samples for field-level verification ----------
    open_in_scope = [m for t in topic_files.values() for ev in t["events"]
                     for m in ev["_markets"]]
    open_in_scope = [m for m in open_in_scope
                     if not (m.get("ticker") or "").startswith("KXMVECROSSCATEGORY")]
    open_in_scope.sort(key=lambda m: fnum(m.get("volume_fp") or m.get("volume")) or 0, reverse=True)
    sample = open_in_scope[0] if open_in_scope else (markets[0] if markets else None)
    if sample:
        ticker = sample["ticker"]
        ob = fetch_json(f"{BASE}/markets/{urllib.parse.quote(ticker)}/orderbook", "(orderbook)")
        if ob is not None:
            ob_fp = ob.get("orderbook_fp") or ob.get("orderbook") or {}
            capped = {k: (v[:40] if isinstance(v, list) else v) for k, v in ob_fp.items()}
            wjson("samples/orderbook-sample.json", {
                "market_ticker": ticker,
                "fetched_from": f"{BASE}/markets/{ticker}/orderbook",
                "orderbook_keys": list(ob_fp.keys()),
                "orderbook_fp_capped_to_40_levels_per_side": capped,
            })
        ev = ev_by_ticker.get(sample.get("event_ticker"))
        if ev:
            series = ev.get("series_ticker") or ""
            end = int(time.time())
            candles = fetch_json(
                f"{BASE}/series/{urllib.parse.quote(series)}/markets/{urllib.parse.quote(ticker)}"
                f"/candlesticks?start_ts={end - 7200}&end_ts={end}&period_interval=1",
                "(1-min candlesticks, last 2h)")
            if candles is not None:
                cs = candles.get("candlesticks") or []
                wjson("samples/candlesticks-sample.json", {
                    "market_ticker": ticker, "series_ticker": series,
                    "fetched_from": (f"{BASE}/series/{series}/markets/{ticker}"
                                     f"/candlesticks?start_ts={end - 7200}&end_ts={end}&period_interval=1"),
                    "candle_count": len(cs),
                    "first": cs[0] if cs else None,
                    "last_3": cs[-3:],
                })
    wjson("samples/market-open-sample.json",
          {"fetched_from": market_urls[0] if market_urls else BASE + "/markets",
           "raw_market": sample})
    if settled:
        wjson("samples/market-settled-sample.json",
              {"fetched_from": settled_urls[0] if settled_urls else BASE + "/markets",
               "raw_market": settled[0]})

    # ---------- 8. meta ----------
    wjson("meta.json", {
        "generated_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "base": BASE,
        "alt_base": ALT,
        "pages_origin": PAGES_ORIGIN,
        "findings": {
            "events_status_open_accepted": True,
            "markets_status_open_accepted": markets_status_open_ok,
            "markets_open_statuses_observed": statuses,
            "events_open_count": len(events),
            "markets_open_count": len(markets),
            "settled_count_recent": len(settled),
            "event_metadata_and_market_fetches": ev_fetch_count,
            "series_discovered_per_topic": series_per_topic,
            "series_matched_total": len(series_stats),
            "series_market_counts_top": dict(sorted(series_stats.items(), key=lambda kv: -kv[1])[:25]),
            "orderbook_ok": os.path.exists(os.path.join(OUT, "samples/orderbook-sample.json")),
            "candlesticks_ok": os.path.exists(os.path.join(OUT, "samples/candlesticks-sample.json")),
        },
        "market_sample_field_names": sorted(sample.keys()) if sample else [],
        "notes": [
            "All values in data/ are verbatim from the logged endpoint URLs (see log.md).",
            "_est_dollar_volume is computed (contracts x last price); it is not an exchange-published field.",
            "Fields absent from responses are omitted, never defaulted.",
        ],
    })

    with open(os.path.join(OUT, "log.md"), "w", encoding="utf-8") as f:
        f.write("# Verification & collection log (UTC)\n\n")
        f.write("\n".join(LOG) + "\n")
    print("done")


if __name__ == "__main__":
    main()
