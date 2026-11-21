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
import hashlib
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
# The settled sweep covers a 72 h window, and the demo environment settles
# fast-cycling markets continuously (BTC 15-minute, hourly crypto, daily AAA
# gas). The default 6-page cap therefore truncates the sweep: the 2026-11-21
# 03:59:57Z run logged `page 6: +1000 items (total 6000); cursor=present`,
# i.e. the cursor was STILL present when the cap was reached, so `settled_total`
# 6000 was a LOWER BOUND and not the exchange's total for the window. The
# collector now sweeps up to 20 pages (20,000 markets) and publishes the
# truncation flag either way, so the site never presents a partial denominator
# as a complete one.
SETTLED_MAX_PAGES = 20
UA = "Trade1-verify/1.0 (github.com/wingbangboozle1-lang/Trade1)"

# Fail-closed reads (COORDINATION c96a21b7): a 429 / 5xx / network error is retried with
# backoff; if it still fails, the run records it and does NOT overwrite the artifact it feeds.
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 5
PACE_S = 0.25          # small pause before each API call, to stay under the demo rate limit
BACKOFF_CAP_S = 60.0   # never wait longer than this between two attempts
FAILURES = []          # every transient upstream failure this run (url, status, attempts)
KEPT = []              # artifacts deliberately NOT rewritten because their inputs failed

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


def get_with_retry(url):
    """GET with backoff on 429 / 5xx / network failure. Returns (code, body, dt, attempts).

    Backoff order (official Rate Limits and Tiers page,
    https://docs.kalshi.com/getting_started/rate_limits):
      1. `X-RateLimit-Reset` (seconds until the bucket is full) when the API
         sends it - it is the only server-supplied hint about when to retry;
      2. `Retry-After` when it is a plain number of seconds;
      3. otherwise exponential backoff, 2^n seconds.
    Every wait is capped at BACKOFF_CAP_S so one throttled sweep cannot stall
    the whole job, and the number of attempts is bounded by MAX_ATTEMPTS.
    """
    code, body, dt = None, b"", 0.0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        time.sleep(PACE_S)
        code, hs, body, dt = get(url)
        if code == 200 or (code is not None and code not in RETRY_STATUSES):
            return code, body, dt, attempt
        if attempt < MAX_ATTEMPTS:
            wait = None
            reset = (hs.get("x-ratelimit-reset") or "").strip()
            if re.fullmatch(r"\d+(\.\d+)?", reset):
                wait = float(reset)
            if wait is None:
                ra = (hs.get("retry-after") or "").strip()
                if re.fullmatch(r"\d+(\.\d+)?", ra):
                    wait = float(ra)
            if wait is None:
                wait = 2 ** attempt
            wait = min(float(wait), BACKOFF_CAP_S)
            log(f"RETRY {attempt}/{MAX_ATTEMPTS - 1} in {wait:.0f}s: {code or 'NET-FAIL'} {url}")
            time.sleep(wait)
    return code, body, dt, MAX_ATTEMPTS


def fetch_json(url, note=""):
    code, body, dt, attempts = get_with_retry(url)
    if code == 200 and body:
        try:
            j = json.loads(body)
        except Exception as e:
            log(f"BAD-JSON {url} :: {e}")
            FAILURES.append({"url": url, "status": code, "attempts": attempts, "reason": "bad-json"})
            return None
        log(f"GET {url} -> 200, {len(body):,}B in {dt:.1f}s {note}")
        return j
    if code == 200 and not body:  # a 200 with no body is not a valid read
        FAILURES.append({"url": url, "status": code, "attempts": attempts, "reason": "empty-body"})
    # a definitive 4xx (other than 429) is an answer, not a failed read; transient codes are failures
    elif code is None or code in RETRY_STATUSES:
        FAILURES.append({"url": url, "status": code, "attempts": attempts, "reason": "transient"})
    log(f"GET {url} -> {code} ({len(body)}B) after {attempts} attempt(s) {note}"
        + (f" body={body[:220]!r}" if body else ""))
    return None


def paged(path, params, key, max_pages=MAX_PAGES):
    """Page a cursor-paginated endpoint.

    Returns (items, urls, stats). `stats` records whether the sweep ran to the
    end of the collection or was cut short by `max_pages`: a truncated sweep
    means the item count is a LOWER BOUND, not the exchange's total for the
    query, and any published figure derived from it must say so.
    """
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
    truncated = bool(cursor)
    stats = {"pages": pages, "max_pages": max_pages,
             "truncated": truncated, "returned": len(items)}
    if truncated:
        log(f"  PAGINATION TRUNCATED at {pages}/{max_pages} pages "
            f"({len(items)} items, cursor still present) - counts are a lower bound")
    return items, urls, stats


def collector_code_sha256():
    """Fingerprint of the code that produced a snapshot.

    The collector writes this into every file it generates, so a reader can
    tell whether the committed snapshot was produced by the CURRENT collector
    code or by an older revision. That distinction matters: a snapshot taken
    before a classification fix legitimately still contains the rows the fix
    removes, and a gate must report "stale snapshot" rather than "the
    collector produced bad data".

    The fingerprint covers scripts/collect.py and scripts/topics.json - the
    two files that determine which rows are collected and how they are
    labelled. The recipe is reproducible: sha256 of collect.py bytes, then a
    NUL byte, then sha256 of topics.json bytes.
    """
    h = hashlib.sha256()
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("collect.py", "topics.json"):
        path = os.path.join(here, name)
        try:
            with open(path, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"<missing:" + name.encode() + b">")
        h.update(b"\0")
    return h.hexdigest()


COLLECTOR_CODE_SHA256 = collector_code_sha256()


def wjson(path, obj):
    if KEPT and (path.startswith("samples/") or path == "meta.json"):
        log(f"SKIP WRITE {path}: this run kept previous artifacts ({len(KEPT)}); last verified copy stays")
        return
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if isinstance(obj, dict):
        # Provenance: which collector code produced this file.
        obj = dict(obj)
        obj["collector_code_sha256"] = COLLECTOR_CODE_SHA256
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


def keyword_match(pattern, text):
    """Match configured keywords as words/phrases, not substrings of other words."""
    return bool(pattern and re.search(rf"(?<!\w)(?:{pattern})(?!\w)", text or "", re.I))


def topic_excluded(topic, title, series=""):
    return keyword_match(topic.get("exclude_keywords"), f"{title} {series}")


def classify(event, topics):
    title = f"{event.get('title', '')} {event.get('sub_title', '')}"
    series = event.get("series_ticker", "") or ""
    cat = event.get("category") or ""
    for t in topics:
        if t.get("exclude_categories") and cat and cat in t["exclude_categories"]:
            continue  # e.g. Trump golf-club markets sit in Politics, not Golf (PR #20)
        if topic_excluded(t, title, series):
            continue
        if cat and cat in t["categories"]:
            if not t["title_keywords"] or keyword_match(t["title_keywords"], title):
                return t["id"], "category"
        if t["series_prefix"] and re.search(t["series_prefix"], series, re.I):
            return t["id"], "series-prefix"
    return None, None


def classify_settled_without_event(title, series, topics):
    """Fallback for settled rows whose event is absent from the open-event list."""
    for t in topics:
        if topic_excluded(t, title, series):
            continue
        if t["series_prefix"] and re.search(t["series_prefix"], series or "", re.I):
            return t["id"], "series-prefix"
        if keyword_match(t["title_keywords"], title):
            return t["id"], "title-keyword"
    return None, None


def classify_settled(market, event, topics):
    """Classify a SETTLED market row.

    `market` is a market object from `GET /markets` (the settled sweep);
    `event` is the matching event object when that event is still in the
    open-events list, else None.

    A settled event is no longer returned by `GET /events?status=open`, so for
    most settled rows there is no event - and therefore no category - to
    classify against. `classify_settled_without_event()` then matches on the
    series prefix and the topic's title keywords, while applying the topic's
    exclusion rules and whole-word keyword boundaries exactly as `classify()`
    does.

    When the event IS known, `classify()` is authoritative and the fallback is
    not used: the event's own category then decides.

    Official defect reference: flagged item 9d-1 - a natural-gas market and a
    basketball match matched on the substring "petrol" were labelled
    `gas-prices` before this rule existed.
    """
    title = f"{market.get('title', '')} {event.get('title', '') if event else ''}"
    series = (market.get("series_ticker")
              or (event.get("series_ticker", "") if event else "")
              or series_guess(market.get("event_ticker")))
    if event:
        return classify({"event_ticker": market.get("event_ticker"), "title": title,
                         "series_ticker": series,
                         "category": event.get("category")}, topics)
    return classify_settled_without_event(title, series, topics)


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
    base_fail = len(FAILURES)  # failures from here on make this run's discovery untrustworthy
    events, event_urls, events_pagination = paged("/events", {"status": "open", "limit": "200"}, "events", max_pages=12)
    events_status_open_ok = bool(events) or len(event_urls) > 0
    log(f"open events collected: {len(events)}")

    # ---------- 4. open markets (paged). Docs document status=open; the live demo
    # emits status 'active' - we record which call shape works and what it returns.
    markets, market_urls, markets_pagination = paged("/markets", {"status": "open", "limit": "1000", "mve_filter": "exclude"}, "markets")
    markets_status_open_ok = bool(markets)
    if not markets:  # retry without mve_filter in case that param is rejected
        log("mve_filter=exclude sweep empty - retrying plain")
        markets, market_urls, markets_pagination = paged("/markets", {"status": "open", "limit": "1000"}, "markets")
        markets_status_open_ok = bool(markets)
    if not markets:
        log("status=open returned no markets - retrying without status filter")
        markets, market_urls, markets_pagination = paged("/markets", {"limit": "1000"}, "markets")
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
                if topic_excluded(t, sr.get("title") or "", tick):
                    continue
                if t["title_keywords"] and not (
                        keyword_match(t["title_keywords"], sr.get("title") or "")
                        or re.search(t["series_prefix"], tick, re.I)):
                    continue
                seen_series.add(tick)
                matched.append(sr)
        matched.sort(key=lambda sr: fnum(sr.get("volume_fp")) or 0, reverse=True)
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
    # Trust gate for this run: no transient read failure in events/markets/series discovery,
    # and the open sweeps returned data. Otherwise topic and category files are not rewritten.
    discovery_ok = (len(FAILURES) == base_fail) and bool(events) and bool(markets)
    log(f"discovery trusted: {discovery_ok} (transient failures this run so far: {len(FAILURES)})")

    # then fetch official metadata + complete market set per event (per-topic budget)
    for tid, pairs in buckets.items():
        def provisional(pe):
            e = pe[0]
            return sum((fnum(m.get("volume_fp")) or 0) * (fnum(m.get("last_price_dollars")) or 0)
                       for m in markets if m.get("event_ticker") == e["event_ticker"])
        pairs.sort(key=provisional, reverse=True)

    ev_fetch_count, ev_fetch_urls = 0, []
    topic_ok = {}
    for tid, pairs in buckets.items():
        nt = len(FAILURES)
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
        topic_ok[tid] = discovery_ok and len(FAILURES) == nt
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
        if topic_ok.get(tid):
            wjson(f"topics/{tid}.json", payload)
            topic_files[tid] = payload
        else:
            KEPT.append(f"topics/{tid}.json")
            log(f"KEEP data/topics/{tid}.json: upstream read failed during this run; last verified snapshot kept")

    categories = {}
    for e in events:
        c = e.get("category") or "(none)"
        categories[c] = categories.get(c, 0) + 1
    if discovery_ok:
        wjson("categories.json", {
            "generated_at": started.isoformat(),
            "source_urls": event_urls[:3],
            "open_event_count": len(events),
            "categories": dict(sorted(categories.items(), key=lambda kv: -kv[1])),
            "unclassified_events": unclassified,
        })
    else:
        KEPT.append("categories.json")
        log("KEEP data/categories.json: discovery not trusted this run")
    log(f"categories observed: {categories}; unclassified events: {unclassified}")

    # ---------- 6. settled markets (recent) -> resolution outcomes ----------
    since = int(time.time()) - 3 * 24 * 3600
    n_set = len(FAILURES)
    settled, settled_urls, settled_pagination = paged("/markets", {
        "status": "settled", "min_settled_ts": str(since), "limit": "1000",
        "mve_filter": "exclude"}, "markets", max_pages=SETTLED_MAX_PAGES)
    settled_ok = len(FAILURES) == n_set
    log(f"settled markets collected (last 3 days): {len(settled)}")
    in_scope = []
    for m in settled:
        e = ev_by_ticker.get(m.get("event_ticker"))
        # One entry point for both cases: the event is known (classify() is
        # authoritative) or it is gone (the fallback matches the series prefix
        # and the title keywords, and still honours the topic exclusions and
        # whole-word keyword boundaries). See classify_settled().
        tid, why = classify_settled(m, e, topics)
        if tid:
            row = trim(m, MARKET_FIELDS)
            row["_topic"] = tid
            row["_event_title"] = e.get("title") if e else None
            in_scope.append(row)
    in_scope.sort(key=lambda m: m.get("settlement_ts") or "", reverse=True)
    # Publication slice: the site tracks FIVE topics, but the demo environment
    # settles fast-cycling crypto series continuously, so a plain
    # "newest 200 settled markets" slice is almost entirely crypto and the
    # Resolved page would show no elections, culture, golf or gas rows at all.
    # Publish a topic-balanced slice instead: round-robin over the topics by
    # settlement time, so every tracked topic is represented, then fill any
    # remaining capacity with the globally newest rows. Deterministic, and
    # the per-topic counts are published next to the rows.
    rows_published = min(200, len(in_scope))
    by_topic = {}
    for r in in_scope:
        by_topic.setdefault(r.get("_topic"), []).append(r)
    balanced = []
    topic_ids = sorted(by_topic)
    i = 0
    while len(balanced) < rows_published and any(by_topic[t] for t in topic_ids):
        t = topic_ids[i % len(topic_ids)]
        if by_topic[t]:
            balanced.append(by_topic[t].pop(0))
        i += 1
        if i > rows_published * 4:   # safety valve; every row is visited
            break
    rows_by_topic = {}
    for r in balanced:
        rows_by_topic[r.get("_topic")] = rows_by_topic.get(r.get("_topic"), 0) + 1
    prev_rows = 0
    prev_path = os.path.join(OUT, "resolved.json")
    if os.path.exists(prev_path):
        try:
            with open(prev_path, encoding="utf-8") as f:
                prev_rows = len((json.load(f) or {}).get("markets") or [])
        except Exception:
            prev_rows = 0
    if settled_ok and (settled or prev_rows == 0):
        wjson("resolved.json", {
            "generated_at": started.isoformat(),
            "window": "last 3 days (min_settled_ts = now-72h)",
            "source_urls": settled_urls[:3],
            "settled_total": len(settled),
            # The settled sweep is cursor-paginated and capped (SETTLED_MAX_PAGES).
            # When it is truncated, `settled_total` and `in_scope_count` are LOWER
            # BOUNDS for the 72 h window, not the exchange's totals. Both flags are
            # published so the site never presents a partial denominator as a
            # complete one.
            "settled_pagination": settled_pagination,
            "settled_total_is_lower_bound": bool(settled_pagination.get("truncated")),
            "in_scope_count": len(in_scope),
            "in_scope_count_is_lower_bound": bool(settled_pagination.get("truncated")),
            "rows_published": len(balanced),
            "rows_by_topic": rows_by_topic,
            "markets": balanced,
        })
    else:
        KEPT.append("resolved.json")
        why = "read failed" if not settled_ok else f"0 settled rows returned while {prev_rows} were on file"
        log(f"KEEP data/resolved.json: {why}; last verified snapshot kept")

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
            "settled_pagination": settled_pagination,
            "settled_count_is_lower_bound": bool(settled_pagination.get("truncated")),
            "event_metadata_and_market_fetches": ev_fetch_count,
            "series_discovered_per_topic": {t["id"]: sum(1 for k in series_stats if k) for t in topics},
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

    wjson("collect_status.json", {
        "run_started_at": started.isoformat(),
        "transient_read_failures": len(FAILURES),
        "failures_first_20": FAILURES[:20],
        "kept_previous_artifacts": KEPT,
        "status": "degraded: previous verified artifacts kept" if KEPT else "ok",
        "retry_policy": {"statuses": sorted(RETRY_STATUSES), "max_attempts": MAX_ATTEMPTS,
                         "backoff": "X-RateLimit-Reset header if numeric, else Retry-After if numeric, "
                                   "else 2^attempt seconds (max 60 s)"},
    })

    with open(os.path.join(OUT, "log.md"), "w", encoding="utf-8") as f:
        f.write("# Verification & collection log (UTC)\n\n")
        f.write("\n".join(LOG) + "\n")
    print("done")


if __name__ == "__main__":
    main()
