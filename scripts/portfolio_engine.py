#!/usr/bin/env python3
"""Trade1 — persistent paper-trading ledger (CI-side strategy engine), stdlib only.

Why this exists
---------------
The browser Strategy Lab (`assets/model.js`, `trades.html`) already runs four automated
paper strategies on live quotes, but it can only persist to `localStorage`: the track
record dies when the tab's storage is cleared, and the sample never grows over time.
This engine runs the *same documented strategies* on a schedule inside GitHub Actions,
appends every fill and settlement to a committed ledger, and writes `data/portfolio.json`
for `portfolio.html`. Result: a portfolio performance record that accumulates across runs
and is visible to every visitor — the "track the portfolio performance / analyze and
categorize trades" part of the brief.

It is a SIMULATION. It never authenticates, never sends an order, and never touches an
account endpoint. See flagged.html for the limitations (notably: no real demo-account
tracking without the owner's own demo API key).

Data discipline (same rules as scripts/collect.py)
--------------------------------------------------
* Every value written here comes verbatim from the endpoint whose exact URL is recorded in
  the artifact (`sources` array) or from the committed snapshot files produced by
  `scripts/collect.py` (`data/topics/*.json`), which carry their own `source_urls`.
* Nothing is inferred. A field missing from a response is left missing.
* Money and prices use exact integers: prices in 1e-4 USD ("bits", the official 4-decimal
  price precision), contract sizes in 1e-2 contracts (official 2-decimal `_fp` precision),
  cash in micro-dollars (1e-6 USD) with the cent balance alignment described at
  https://docs.kalshi.com/getting_started/fee_rounding ("trade fee = ceil_6dp(model fee)").
  Float arithmetic is never used for the >= $0.10 test: 0.66-0.56 is 0.09999999999999998
  in binary float and would silently fail a naive `>= 0.10` comparison.

Official sources used for the rules in this file (all read 2026-11-20 UTC)
--------------------------------------------------------------------------
* Demo endpoints:      https://docs.kalshi.com/getting_started/demo_env
* Get Markets:         https://docs.kalshi.com/api-reference/market/get-markets
* Market lifecycle:    https://docs.kalshi.com/getting_started/market_lifecycle
* Fixed-point units:   https://docs.kalshi.com/getting_started/fixed_point_migration
* Fee schedule (PDF):  https://kalshi.com/docs/kalshi-fee-schedule.pdf
  "fees = roundup(M x 0.07 x C x P x (1-P))"; "There is no settlement fee.";
  last updated and effective July 7, 2026.
* Rate limits:         https://docs.kalshi.com/getting_started/rate_limits

Usage
-----
  python3 scripts/portfolio_engine.py run            # one engine cycle (used by CI)
  python3 scripts/portfolio_engine.py run --offline  # no network; quotes from data/topics/*.json
  python3 scripts/portfolio_engine.py seed           # build the watchlist, take a baseline, no trades
  python3 scripts/portfolio_engine.py selftest       # offline deterministic checks, no network
"""

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from fractions import Fraction

# ----------------------------------------------------------------------------- config
BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
OUT_DIR = "data"
STATE_PATH = os.path.join(OUT_DIR, "portfolio_state.json")
ART_PATH = os.path.join(OUT_DIR, "portfolio.json")
TOPICS_DIR = os.path.join(OUT_DIR, "topics")
TOPICS = ["gas-prices", "elections", "culture", "crypto", "golf"]
UA = "Trade1-portfolio-engine/1.0 (github.com/wingbangboozle1-lang/Trade1)"

ENGINE_VERSION = 1
BANKROLL_BITS = 1_000_000_000     # $1,000.00 in micro-dollars (1e-6 USD) - same starting bankroll as the
PER_TRADE_BITS = 25_000_000     # $25.00 target cost per paper trade, micro-dollars
MAX_OPEN_POSITIONS = 8
FEE_MULTIPLIER = Fraction(1)    # taker multiplier M = 1 (general schedule; KXAAAGASM is 1 as well)
ALERT_THRESHOLD_BITS = 1000     # $0.10 exactly, in 1e-4 USD units
MIN_MODEL_SCORE = Fraction(450, 1000)   # mirror of assets/model.js momentum.minScore
MAX_TICKERS_PER_REQUEST = 200   # URL-length safety; docs: tickers-only queries return everything in one response
REQUEST_SLEEP_S = 0.35          # stay far below any published limit; unauthenticated limits are not published

# Strategy parameters. These mirror assets/model.js where the sampling interval does not
# matter, and are re-tuned where it does: the CI engine samples every ~30 minutes (the
# browser lab samples every ~12 seconds), so the browser's 10-30 minute time-exits would
# always fire on the next sample. Time-based exits are therefore expressed as a maximum
# holding time; beyond it the position is closed at the official bid. Every number here is
# printed on portfolio.html so a reader can audit the rule behind each trade.
RULES = {
    "momentum": {
        "enter": "a sampled >= $0.10 move whose model score >= 0.45 and YES spread <= $0.06; buy the side the move points to (up -> YES, down -> NO)",
        "exit": "take-profit +$0.15, stop-loss -$0.10, else max 12 samples (~6 h) at the official bid, else settlement",
        "take_profit_bits": 1500, "stop_loss_bits": 1000, "max_samples": 12,
        "max_spread_bits": 600, "min_score": 0.45,
    },
    "fade": {
        "enter": "a sampled >= $0.10 move whose model score < 0.45, spread <= $0.04 and 24 h volume >= 100 contracts; buy the opposite side",
        "exit": "take-profit +$0.08, stop-loss -$0.08, else max 4 samples (~2 h) at the official bid, else settlement",
        "take_profit_bits": 800, "stop_loss_bits": 800, "max_samples": 4,
        "max_spread_bits": 400, "min_vol24h_contracts": 100,
    },
    "breakout": {
        "enter": "last price crosses the 50c line between two samples, with 24 h volume >= 500 contracts and spread <= $0.05; buy the side it crossed to",
        "exit": "take-profit +$0.12, stop-loss -$0.10, else max 48 samples (~24 h) at the official bid, else settlement",
        "take_profit_bits": 1200, "stop_loss_bits": 1000, "max_samples": 48,
        "max_spread_bits": 500, "min_vol24h_contracts": 500,
    },
    "harvest": {
        "enter": "last price between $0.90 and $0.99, spread <= $0.03, market closes within 72 h; buy YES to settlement (no take-profit, no stop)",
        "exit": "settlement only: $1.00 per winning contract, $0.00 per losing contract; no settlement fee",
        "min_price_bits": 9000, "max_price_bits": 9900, "max_spread_bits": 300,
        "max_close_hours": 72, "cooldown_hours": 6,
    },
}
MODEL_SCORE_FORMULA = ("score = 0.30*min(vol24/2000,1) + 0.25*min(vol/10000,1) "
                       "+ 0.20*max(0,1-spread/0.15) + 0.25*min(|delta|/0.25,1)")

MAX_TRADES_KEPT = 1200
MAX_ALERTS_KEPT = 400
MAX_EQUITY_KEPT = 2400
MAX_RESOLUTIONS_KEPT = 400
MAX_RUNS_KEPT = 120


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_line(lines, msg):
    line = f"- {datetime.now(timezone.utc).strftime('%H:%M:%S')}Z {msg}"
    lines.append(line)
    print(line, flush=True)


# ----------------------------------------------------------------------- exact parsing
def bits(value):
    """Official `*_dollars` price -> integer 1e-4 USD units. Returns None when absent."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    s = str(value).strip()
    if not s:
        return None
    neg = s.startswith("-")
    s = s[1:] if neg else s
    m = re.fullmatch(r"(\d+)(?:\.(\d{1,6}))?", s)
    if not m:
        return None
    whole, frac = m.group(1), (m.group(2) or "").ljust(6, "0")
    n = int(whole) * 1_000_000 + int(frac)          # micro-dollars (1e-6 USD)
    v = (n + 50) // 100                             # round half-up to bits (1e-4 USD)
    return -v if neg else v


def contracts(value):
    """Official `*_fp` contract count -> integer hundredths of a contract. None when absent."""
    if value is None or isinstance(value, bool):
        return None
    s = str(value).strip()
    if not s:
        return None
    m = re.fullmatch(r"(\d+)(?:\.(\d+))?", s)
    if not m:
        return None
    frac = (m.group(2) or "")[:2].ljust(2, "0")
    return int(m.group(1)) * 100 + int(frac)


def money_str(micro):
    """micro-dollars -> '$x.xxxxxx' string, always exact."""
    sign = "-" if micro < 0 else ""
    a = abs(int(micro))
    dollars, frac = divmod(a, 1_000_000)
    s = f"{sign}${dollars}.{frac:06d}".rstrip("0")
    return s[:-1] if s.endswith(".") else s + ("0" if not s.endswith("0") and "." not in s else "")


def usd(micro, dp=4):
    """micro-dollars -> float dollars rounded for display (tables use this)."""
    return round(int(micro) / 1_000_000, dp)


def usd_str(micro, dp=2):
    sign = "-" if micro < 0 else ""
    a = abs(int(micro)) / 1_000_000.0
    return f"{sign}${a:,.{dp}f}"


def price_str(b):
    if b is None:
        return None
    sign = "-" if b < 0 else ""
    a = abs(int(b))
    d, f = divmod(a, 10000)
    s = f"{sign}${d}.{f:04d}"
    return s[:-2] if s.endswith("00") else s


# -------------------------------------------------------------------------- fee engine
# Units used throughout: micro-dollars (1e-6 USD). That is the finest precision a fill's
# revenue can occupy and the granularity the official Fee Rounding page assigns to the
# trade fee ("trade fee = ceil_6dp(model fee)"), so every ledger amount is an exact integer.
#   price  `*_dollars`  -> 1e-4 USD units ("bits")   -> x100  -> micro-dollars
#   size   `*_fp`        -> 1e-2 contracts            -> x P   -> micro-dollars
#   cash                -> micro-dollars
FEE_MODEL = Fraction(7, 100)          # general taker rate 0.07 (fee schedule PDF)

FEE_RULE_TEXT = (
    "taker: fees = roundup(M x 0.07 x C x P x (1-P)) where M is the per-series fee_multiplier "
    "published by the demo API on GET /series/{ticker} (official Get Series schema: "
    "https://docs.kalshi.com/api-reference/market/get-series), cached in series_fees and defaulting "
    "to 1 when a series record has not been fetched (fee schedule PDF "
    "https://kalshi.com/docs/kalshi-fee-schedule.pdf, effective 2026-07-07: 'default is 1 unless "
    "otherwise indicated'). The production PDF's Non-Standard table lists taker M=0 for KXBTCY/KXETHY "
    "while the demo API publishes fee_multiplier=1 for them - that official-source conflict is "
    "published on flagged.html and the environment-matched demo value is the one modelled. The model "
    "fee is rounded up to 6 decimals - the official Fee Rounding page states 'trade fee = "
    "ceil_6dp(model fee)' - and the resulting balance change is then floored to the $0.01 alignment "
    "used for non-direct members, with the difference booked as the rounding fee "
    "(https://docs.kalshi.com/getting_started/fee_rounding). Settlement is free: 'There is no "
    "settlement fee.' Resting-order (maker) fees are not modeled because every simulated fill "
    "crosses the spread."
)


def series_of(ticker):
    """Series prefix of a market ticker: 'KXAAAGASM-26NOV30-3.90' -> 'KXAAAGASM'."""
    t = str(ticker or "")
    return (t.split("-", 1)[0] or t).upper()


def series_multiplier(st, ticker):
    """Taker multiplier M for a ticker: the cached demo fee_multiplier, else the
    schedule default 1. Never inferred - only values the API actually published."""
    rec = ((st or {}).get("series_fees") or {}).get(series_of(ticker))
    if isinstance(rec, dict) and isinstance(rec.get("fee_multiplier"), (int, float)) \
            and not isinstance(rec.get("fee_multiplier"), bool):
        return Fraction(str(rec["fee_multiplier"]))
    return FEE_MULTIPLIER


def trade_multiplier(st, t):
    """The multiplier recorded on the trade at entry (falls back to the cache)."""
    v = (t or {}).get("fee_m")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return Fraction(str(v))
    return series_multiplier(st, (t or {}).get("ticker"))


def taker_fee(contracts_h, price_b, multiplier=FEE_MULTIPLIER):
    """Taker fee in micro-dollars: ceil_6dp(M x 0.07 x C x P x (1-P))."""
    if not contracts_h or price_b is None:
        return 0
    c = Fraction(contracts_h, 100)
    p = Fraction(price_b, 10000)
    exact = multiplier * FEE_MODEL * c * p * (1 - p)          # dollars, exact
    return math.ceil(exact * 1_000_000)                        # micro-dollars, rounded up


def position_cost(contracts_h, price_b):
    """Cost/revenue in micro-dollars, exact: (1e-2 contracts) x (1e-4 USD bits) = 1e-6 USD."""
    return int(contracts_h or 0) * int(price_b or 0)


def align_down(x):
    """Non-direct-member balance alignment: the exchange floors the balance change to a cent."""
    return (int(x) // 10000) * 10000


def cash_debit(contracts_h, price_b, multiplier=FEE_MULTIPLIER):
    """What a buyer actually pays: align_down(cost + fee), plus the rounding fee explicitly."""
    cost, fee = position_cost(contracts_h, price_b), taker_fee(contracts_h, price_b, multiplier)
    aligned = align_down(cost + fee)
    return aligned, cost, fee, aligned - cost        # debit, cost, net fee, (fee+rounding)


def cash_credit(contracts_h, price_b, multiplier=FEE_MULTIPLIER):
    """What a seller actually receives: align_down(revenue - fee)."""
    rev, fee = position_cost(contracts_h, price_b), taker_fee(contracts_h, price_b, multiplier)
    aligned = align_down(rev - fee)
    return aligned, rev, fee, rev - aligned


def gross_for_budget(budget, price_b, multiplier=FEE_MULTIPLIER):
    """Largest whole-0.01-contract size whose aligned cost+fee fits the budget (0 if none)."""
    if not price_b or price_b <= 0 or budget <= 0:
        return 0
    lo, hi, best = 1, max(1, int(budget * 100 / price_b) + 1000), 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if cash_debit(mid, price_b, multiplier)[0] <= budget:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return best


# ------------------------------------------------------------------- ROI/model score
def model_score(delta_bits, vol24_c, vol_c, spread_bits):
    """Documented heuristic screen, mirror of assets/model.js score() (see methods.html)."""
    def clamp(frac):
        return max(Fraction(0), min(Fraction(1), frac))
    s = (Fraction(30, 100) * clamp(Fraction(vol24_c or 0, 2000 * 100))
         + Fraction(25, 100) * clamp(Fraction(vol_c or 0, 10000 * 100))
         + Fraction(20, 100) * max(Fraction(0), 1 - Fraction(abs(spread_bits or 0), 1500))
         + Fraction(25, 100) * clamp(Fraction(abs(delta_bits), 2500)))
    return int(math.floor(s * 1000 + Fraction(1, 2))) / 1000.0   # 3 dp, half-up like JS Math.round


# --------------------------------------------------------------------------- snapshot
def load_topic_rows():
    """In-scope markets from the committed, source-linked snapshots written by collect.py."""
    rows = []
    for topic in TOPICS:
        path = os.path.join(TOPICS_DIR, topic + ".json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        for ev in doc.get("events") or []:
            for m in ev.get("_markets") or []:
                if not m.get("ticker"):
                    continue
                rows.append({
                    "ticker": m["ticker"],
                    "event_ticker": m.get("event_ticker") or ev.get("event_ticker"),
                    "topic": topic,
                    "title": m.get("title") or ev.get("title"),
                    "yes_sub_title": m.get("yes_sub_title"),
                    "close_time": m.get("close_time"),
                    "status": m.get("status"),
                    "result": m.get("result"),
                    "last_price_dollars": m.get("last_price_dollars"),
                    "yes_bid_dollars": m.get("yes_bid_dollars"),
                    "yes_ask_dollars": m.get("yes_ask_dollars"),
                    "no_bid_dollars": m.get("no_bid_dollars"),
                    "no_ask_dollars": m.get("no_ask_dollars"),
                    "volume_24h_fp": m.get("volume_24h_fp"),
                    "volume_fp": m.get("volume_fp"),
                    "_est_dollar_volume_24h": m.get("_est_dollar_volume_24h"),
                    "_source_url": (doc.get("source_urls") or {}).get("markets") or [],
                    "source_url": doc.get("source_base", BASE) + "/markets?tickers=" + m["ticker"],
                })
    return rows


def pick_watchlist(rows, per_topic=16, total=72):
    """Top in-scope markets by *24 h traded-dollar estimate*, with a per-topic floor.

    The API publishes no per-market dollar-notional field, so the ranking uses the
    computed estimate volume_24h_fp x last_price_dollars that the snapshot already labels
    as an estimate (see flagged.html).
    """
    def dv(r):
        v = r.get("_est_dollar_volume_24h")
        if isinstance(v, (int, float)):
            return v
        c = contracts(r.get("volume_24h_fp"))
        p = bits(r.get("last_price_dollars"))
        if c is None or p is None:
            return -1
        return (c * p) / 1e6 / 1e4 * 1e4   # contracts x dollars, comparable ordering only
    by_topic = {}
    for r in rows:
        by_topic.setdefault(r["topic"], []).append(r)
    picked, seen = [], set()
    for topic in TOPICS:
        lst = sorted(by_topic.get(topic, []), key=dv, reverse=True)
        for r in lst[:per_topic]:
            if r["ticker"] in seen or dv(r) < 0:
                continue
            seen.add(r["ticker"])
            picked.append(r)
    rest = sorted([r for r in rows if r["ticker"] not in seen], key=dv, reverse=True)
    for r in rest:
        if len(picked) >= total:
            break
        seen.add(r["ticker"])
        picked.append(r)
    return picked


# -------------------------------------------------------------------------- HTTP layer
def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = e.read()[:300].decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, {"_error": body}
    except Exception as e:                      # network-level failure (the dev sandbox has no route)
        return 0, {"_error": f"{type(e).__name__}: {e}"}


def fetch_quotes(tickers, log_list):
    """Batched live quotes: GET /markets?tickers=a,b,c (tickers-only queries are unpaged
    and return every matching market, status included, per the official endpoint notes)."""
    out, sources = {}, []
    for i in range(0, len(tickers), MAX_TICKERS_PER_REQUEST):
        chunk = tickers[i:i + MAX_TICKERS_PER_REQUEST]
        url = f"{BASE}/markets?{urllib.parse.urlencode({'tickers': ','.join(chunk)})}"
        code, j = http_get(url)
        if code == 200 and isinstance(j, dict) and j.get("markets") is not None:
            for m in j["markets"]:
                if m.get("ticker"):
                    out[m["ticker"]] = m
            log_line(log_list, f"GET {url} -> 200 ({len(j['markets'])} markets)")
        else:
            log_line(log_list, f"GET {url} -> {code} {str(j)[:180]}")
        sources.append(url)
        if i + MAX_TICKERS_PER_REQUEST < len(tickers):
            time.sleep(REQUEST_SLEEP_S)
    return out, sources


def fetch_series_fees(st, series_list, log_list, cap=40):
    """Cache GET /series/{ticker} for the trade universe and read the official
    per-series fee_multiplier (Get Series schema, required field:
    https://docs.kalshi.com/api-reference/market/get-series). Only values the
    API actually publishes are stored - a record without a numeric
    fee_multiplier is skipped and the schedule default M=1 stays in force
    (never inferred). Returns the list of request URLs fetched this call."""
    cache = st.setdefault("series_fees", {})
    urls = []
    for s in series_list:
        key = series_of(s)
        if not key or key in cache or len(urls) >= cap:
            continue
        url = f"{BASE}/series/{urllib.parse.quote(key)}"
        code, j = http_get(url)
        urls.append(url)
        if code == 200 and isinstance(j, dict) and isinstance(j.get("series"), dict):
            sr = j["series"]
            mult = sr.get("fee_multiplier")
            if isinstance(mult, (int, float)) and not isinstance(mult, bool):
                cache[key] = {"fee_multiplier": mult, "fee_type": sr.get("fee_type"),
                              "source_url": url, "checked": now_iso()}
                log_line(log_list, f"GET {url} -> 200 fee_multiplier={mult} fee_type={sr.get('fee_type')}")
            else:
                log_line(log_list, f"GET {url} -> 200 but no numeric fee_multiplier (left at default M=1)")
        else:
            log_line(log_list, f"GET {url} -> {code} {str(j)[:160]}")
        time.sleep(REQUEST_SLEEP_S)
    return urls


# --------------------------------------------------------------------------- bookkeeping
def quote_view(m):
    """Trim one API market object to the fields the ledger consumes (verbatim values)."""
    return {
        "last": bits(m.get("last_price_dollars")),
        "yes_bid": bits(m.get("yes_bid_dollars")),
        "yes_ask": bits(m.get("yes_ask_dollars")),
        "no_bid": bits(m.get("no_bid_dollars")),
        "no_ask": bits(m.get("no_ask_dollars")),
        "vol24": contracts(m.get("volume_24h_fp")),
        "vol": contracts(m.get("volume_fp")),
        "status": m.get("status"),
        "result": m.get("result"),
        "settlement_ts": m.get("settlement_ts"),
        "close_time": m.get("close_time"),
        "title": m.get("title"),
        "event_ticker": m.get("event_ticker"),
    }


def bid_ask(q, side):
    if side == "yes":
        return q.get("yes_bid"), q.get("yes_ask")
    return q.get("no_bid"), q.get("no_ask")


def spread(q):
    if q.get("yes_bid") is None or q.get("yes_ask") is None:
        return None
    return q["yes_ask"] - q["yes_bid"]


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            st = json.load(f)
        if st.get("version") == ENGINE_VERSION:
            return st
    return {
        "version": ENGINE_VERSION,
        "created_at": now_iso(),
        "updated_at": None,
        "cash_cc": BANKROLL_BITS,
        "watch": {},            # ticker -> {topic, title, event_ticker, samples, last_quote}
        "trades": [],
        "alerts": [],
        "resolutions": [],
        "equity": [],
        "runs": [],
        "crossed50": {},
        "harvest_cool": {},
        "log": [],
    }


def save_state(st):
    st["updated_at"] = now_iso()
    st["log"] = st.get("log", [])[-60:]
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(st, f, separators=(",", ":"), sort_keys=True)


def open_positions(st):
    return [t for t in st["trades"] if t["status"] == "open"]


def find_open(st, ticker, strategy):
    for t in st["trades"]:
        if t["status"] == "open" and t["ticker"] == ticker and t["strategy"] == strategy:
            return t
    return None


def enter(st, ticker, side, strategy, q, note, sources, when):
    if len(open_positions(st)) >= MAX_OPEN_POSITIONS:
        return None
    if find_open(st, ticker, strategy):
        return None
    bid, ask = bid_ask(q, side)
    if ask is None or ask < 500 or ask > 9500:      # unfillable edges, same guard as the browser lab
        return None
    fee_m = series_multiplier(st, ticker)           # demo fee_multiplier, default 1
    budget = min(st["cash_cc"], PER_TRADE_BITS)
    # whole contracts only: fractional contract sizes are supported only on markets that allow
    # them (https://docs.kalshi.com/getting_started/fixed_point_migration), and the engine does
    # not read that permission per market, so it never requests a fractional size.
    qty = (gross_for_budget(budget, ask, fee_m) // 100) * 100
    if qty < 100:
        return None
    debit, cost, fee, rounding = cash_debit(qty, ask, fee_m)
    st["cash_cc"] -= debit
    trade = {
        "id": f"{when}:{ticker}:{strategy}:{len(st['trades'])}",
        "t": when, "ticker": ticker, "event_ticker": q.get("event_ticker"),
        "title": q.get("title"), "topic": st["watch"][ticker]["topic"], "side": side,
        "qty_c": qty, "entry_bits": ask, "fee_cc": fee, "cost_cc": cost,
        "rounding_cc": rounding,
        "fee_m": float(fee_m), "series": series_of(ticker),
        "strategy": strategy, "status": "open", "mark_bits": bid, "samples": 0,
        "note": note, "source": sources[0] if sources else None,
    }
    st["trades"].append(trade)
    return trade


def close(st, t, price_bits, reason, when, source=None):
    if price_bits is None:
        return
    credit, rev, fee, rounding = cash_credit(t["qty_c"], price_bits, trade_multiplier(st, t))
    st["cash_cc"] += credit
    t["status"] = "closed"
    t["exit"] = {"t": when, "price_bits": price_bits, "reason": reason, "fee_cc": fee,
                 "rounding_cc": rounding, "proceeds_cc": rev, "credit_cc": credit, "source": source}
    t["pnl_cc"] = t["exit"]["credit_cc"] - t["cost_cc"] - t["fee_cc"] - t.get("rounding_cc", 0)
    t["closed_at"] = when


def settle(st, t, result, when, source=None):
    # $1.00 per winning contract, $0 per losing one, and no settlement fee (official schedule)
    payout_cc = position_cost(t["qty_c"], 10000) if (t["side"] == result) else 0
    st["cash_cc"] += payout_cc
    t["status"] = "settled"
    t["exit"] = {"t": when, "price_bits": 10000 if payout_cc else 0, "reason": f"settlement ({result})",
                 "fee_cc": 0, "proceeds_cc": payout_cc, "source": source}
    t["pnl_cc"] = payout_cc - t["cost_cc"] - t["fee_cc"] - t.get("rounding_cc", 0)
    t["closed_at"] = when


def equity_cc(st, quotes):
    mark = 0
    for t in open_positions(st):
        q = quotes.get(t["ticker"]) or {}
        bid, _ = bid_ask(q, t["side"]) if q else (None, None)
        price = bid if bid is not None else t.get("mark_bits")
        if price is not None:
            mark += position_cost(t["qty_c"], price)
    return st["cash_cc"] + mark


def aggregate(st, quotes, key):
    buckets = {}
    for t in st["trades"]:
        k = t.get(key) or "unclassified"
        b = buckets.setdefault(k, {"n": 0, "open": 0, "closed": 0, "settled": 0, "wins": 0,
                                   "losses": 0, "flat": 0, "pnl_cc": 0, "cost_cc": 0,
                                   "realised_count": 0})
        b["n"] += 1
        b[key] = k
        if t["status"] == "open":
            b["open"] += 1
            continue
        b["closed"] += 1
        if t["status"] == "settled":
            b["settled"] += 1
        pnl = t.get("pnl_cc", 0)
        b["pnl_cc"] += pnl
        b["cost_cc"] += t["cost_cc"] + t["fee_cc"]
        b["realised_count"] += 1
        if pnl > 0:
            b["wins"] += 1
        elif pnl < 0:
            b["losses"] += 1
        else:
            b["flat"] += 1
    rows = []
    for b in buckets.values():
        roi = round(b["pnl_cc"] / b["cost_cc"] * 100, 2) if b["cost_cc"] else None
        wr = round(b["wins"] / b["realised_count"] * 100, 1) if b["realised_count"] else None
        rows.append({
            key: b[key], "trades": b["n"], "open": b["open"], "closed": b["closed"],
            "settled": b["settled"], "wins": b["wins"], "losses": b["losses"], "flat": b["flat"],
            "win_rate_pct": wr, "pnl_usd": usd(b["pnl_cc"]),
            "cost_usd": usd(b["cost_cc"]),
            "avg_pnl_usd": usd(b["pnl_cc"] / b["realised_count"]) if b["realised_count"] else None,
            "roi_pct": roi,
        })
    rows.sort(key=lambda r: (r["pnl_usd"] or 0), reverse=True)
    return rows


# ------------------------------------------------------------------------------ engine
def run_cycle(st, quotes, sources, when, log_list):
    """One engine cycle. `quotes` maps ticker -> API market object (live or snapshot)."""
    events = []
    new_alerts = []
    views = {t: quote_view(m) for t, m in quotes.items()}
    settled_now = {}

    # 0. resolution tracking: any watched market that the exchange has now settled is recorded,
    #    whether or not the ledger holds it (the brief asks for every tracked event's YES/NO outcome)
    known = {(r.get("ticker"), r.get("result")) for r in st["resolutions"]}
    for ticker, q in views.items():
        w = st["watch"].get(ticker)
        if not w:
            continue
        res = q.get("result")
        if res in ("yes", "no") and q.get("status") in ("finalized", "settled", "closed", "determined", "amended"):
            settled_now[ticker] = res
            if (ticker, res) not in known:
                st["resolutions"].append({
                    "t": when, "ticker": ticker, "event_ticker": q.get("event_ticker"),
                    "title": q.get("title") or w.get("title"), "topic": w.get("topic"),
                    "result": res, "settlement_ts": q.get("settlement_ts"),
                    "source": sources[0] if sources else None,
                })
                events.append(f"RESOLVED {ticker} {res.upper()}")

    # 1. update samples, detect swings
    for ticker in list(views.keys()):
        w = st["watch"].get(ticker)
        if not w:
            continue
        q = views[ticker]
        w["last_quote"] = q
        prev = w.get("samples", [])[-1] if w.get("samples") else None
        prev_t = prev.get("t") if prev else None
        cur_bits = q["last"] if q["last"] is not None else q["yes_bid"]
        prev_bits = prev.get("p") if prev else None
        w.setdefault("samples", []).append({"t": when, "p": cur_bits,
                                            "bid": q["yes_bid"], "ask": q["yes_ask"]})
        if len(w["samples"]) > 96:
            del w["samples"][0]
        if cur_bits is None or prev_bits is None:
            continue
        delta = cur_bits - prev_bits
        if abs(delta) >= ALERT_THRESHOLD_BITS:
            sp = spread(q)
            score = model_score(delta, q["vol24"], q["vol"], sp if sp is not None else 9900)
            alert = {
                "t": when, "ticker": ticker, "event_ticker": q.get("event_ticker"),
                "title": q.get("title") or w.get("title"), "topic": w["topic"],
                "from_bits": prev_bits, "to_bits": cur_bits, "delta_bits": delta,
                "prev_t": prev_t,
                "gap_minutes": round((parse_ts(when) - (parse_ts(prev_t) or parse_ts(when))) / 60000, 1),
                "dir": "up" if delta > 0 else "down", "score": score,
                "spread_bits": sp, "vol24_c": q["vol24"],
                "source": sources[0] if sources else None,
            }
            st["alerts"].append(alert)
            new_alerts.append(alert)
            events.append(f"ALERT {ticker} {prev_bits/10000:.4f}->{cur_bits/10000:.4f} ({'+' if delta>0 else ''}{delta/10000:.4f})")

    # 2. exits first (positions marked at the official bid of the same response)
    for t in open_positions(st):
        q = views.get(t["ticker"])
        if not q:
            continue
        w = st["watch"].get(t["ticker"], {})
        t["samples"] = t.get("samples", 0) + 1
        bid, _ = bid_ask(q, t["side"])
        if bid is not None:
            t["mark_bits"] = bid
        # settlement is applied from the pass above - no extra request needed
        if t["ticker"] in settled_now:
            settle(st, t, settled_now[t["ticker"]], when, source=sources[0] if sources else None)
            events.append(f"SETTLE {t['ticker']} {settled_now[t['ticker']]} ({t['strategy']})")
            continue
        cfg = RULES.get(t["strategy"], {})
        if bid is None:
            continue
        pl = bid - t["entry_bits"]
        if pl >= cfg.get("take_profit_bits", 1 << 30):
            close(st, t, bid, "take-profit", when, source=sources[0] if sources else None)
            events.append(f"EXIT {t['ticker']} {t['strategy']} take-profit")
        elif pl <= -cfg.get("stop_loss_bits", 1 << 30):
            close(st, t, bid, "stop-loss", when, source=sources[0] if sources else None)
            events.append(f"EXIT {t['ticker']} {t['strategy']} stop-loss")
        elif cfg.get("max_samples") and t["samples"] >= cfg["max_samples"]:
            close(st, t, bid, "max-hold", when, source=sources[0] if sources else None)
            events.append(f"EXIT {t['ticker']} {t['strategy']} max-hold")

    # 3. entries
    for a in new_alerts:
        w = st["watch"].get(a["ticker"])
        q = views.get(a["ticker"])
        if not w or not q:
            continue
        sp = spread(q)
        if sp is None:
            continue
        if a["score"] >= MIN_MODEL_SCORE and sp <= RULES["momentum"]["max_spread_bits"]:
            side = "yes" if a["dir"] == "up" else "no"
            t = enter(st, a["ticker"], side, "momentum", q, f"momentum on {a['delta_bits']/10000:+.4f} (score {a['score']})",
                      sources, when)
            if t:
                events.append(f"ENTER {t['id']} {side.upper()} {t['qty_c']/100:.2f} @ {price_str(t['entry_bits'])}")
        elif (a["score"] < MIN_MODEL_SCORE and sp <= RULES["fade"]["max_spread_bits"]
              and q.get("vol24") is not None
              and q["vol24"] >= RULES["fade"]["min_vol24h_contracts"] * 100):
            side = "no" if a["dir"] == "up" else "yes"
            t = enter(st, a["ticker"], side, "fade", q, f"fade on {a['delta_bits']/10000:+.4f} (score {a['score']})",
                      sources, when)
            if t:
                events.append(f"ENTER {t['id']} {side.upper()} {t['qty_c']/100:.2f} @ {price_str(t['entry_bits'])}")

    for ticker in list(views.keys()):
        w = st["watch"].get(ticker)
        if not w:
            continue
        q = views[ticker]
        sp = spread(q)
        last = q["last"]
        vol24 = q["vol24"] or 0
        if last is not None:
            zone = "above" if last >= 5000 else "below"
            prev_zone = st["crossed50"].get(ticker)
            if prev_zone is None:
                st["crossed50"][ticker] = zone
            elif prev_zone != zone:
                st["crossed50"][ticker] = zone
                if (sp is not None and sp <= RULES["breakout"]["max_spread_bits"]
                        and vol24 >= RULES["breakout"]["min_vol24h_contracts"] * 100
                        and 500 <= last <= 9500):
                    side = "yes" if zone == "above" else "no"
                    t = enter(st, ticker, side, "breakout", q,
                              f"breakout {prev_zone}->{zone} at {price_str(last)}",
                              sources, when)
                    if t:
                        events.append(f"ENTER {t['id']} {side.upper()} breakout")
        if sp is not None and sp <= RULES["harvest"]["max_spread_bits"] and last is not None \
                and RULES["harvest"]["min_price_bits"] <= last <= RULES["harvest"]["max_price_bits"]:
            cool = st["harvest_cool"].get(ticker, 0)
            close_ms = parse_ts(q.get("close_time"))
            now_ms = parse_ts(when)
            if close_ms and now_ms and 0 < close_ms - now_ms < RULES["harvest"]["max_close_hours"] * 3600e3 \
                    and (not cool or now_ms - cool > RULES["harvest"]["cooldown_hours"] * 3600e3):
                t = enter(st, ticker, "yes", "harvest", q,
                          f"harvest @ {price_str(last)}, closes {q.get('close_time')}", sources, when)
                if t:
                    st["harvest_cool"][ticker] = now_ms
                    events.append(f"ENTER {t['id']} YES harvest")

    # 4. record equity
    eq = equity_cc(st, views)
    st["equity"].append({"t": when, "equity_cc": eq, "cash_cc": st["cash_cc"],
                         "open": len(open_positions(st))})
    if len(st["equity"]) > MAX_EQUITY_KEPT:
        del st["equity"][0:len(st["equity"]) - MAX_EQUITY_KEPT]
    return events


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        return None


# --------------------------------------------------------------------------- artifact
def trade_public(t):
    realised = t["status"] != "open"
    mark = t.get("mark_bits")
    open_pnl = None
    if t["status"] == "open" and mark is not None:
        open_pnl = usd(position_cost(t["qty_c"], mark) - t["cost_cc"] - t["fee_cc"] - t.get("rounding_cc", 0))
    return {
        "id": t["id"], "t": t["t"], "ticker": t["ticker"], "event_ticker": t.get("event_ticker"),
        "title": t.get("title"), "topic": t.get("topic"), "side": t["side"],
        "qty_contracts": t["qty_c"] / 100, "strategy": t["strategy"], "status": t["status"],
        "entry_usd": round(t["entry_bits"] / 10000, 4),
        "mark_usd": round(mark / 10000, 4) if mark is not None else None,
        "cost_usd": usd(t["cost_cc"] + t["fee_cc"] + t.get("rounding_cc", 0)),
        "fee_usd": usd(t["fee_cc"] + t.get("rounding_cc", 0)),
        "pnl_usd": usd(t["pnl_cc"]) if realised else open_pnl,
        "realised": realised,
        "exit": ({"t": t["exit"]["t"], "price_usd": round(t["exit"]["price_bits"] / 10000, 4),
                  "reason": t["exit"]["reason"], "fee_usd": usd(t["exit"]["fee_cc"]),
                  "credit_usd": usd(t["exit"].get("credit_cc", 0)),
                  "source": t["exit"].get("source")} if t.get("exit") else None),
        "note": t.get("note", ""), "source": t.get("source"),
    }


def alert_public(a):
    return {
        "t": a["t"], "ticker": a["ticker"], "event_ticker": a.get("event_ticker"),
        "title": a.get("title"), "topic": a.get("topic"),
        "from_usd": round(a["from_bits"] / 10000, 4), "to_usd": round(a["to_bits"] / 10000, 4),
        "delta_usd": round(a["delta_bits"] / 10000, 4), "dir": a["dir"], "score": a["score"],
        "prev_t": a.get("prev_t"), "gap_minutes": a.get("gap_minutes"),
        "wide_gap": bool(a.get("gap_minutes") is not None and a["gap_minutes"] > 90),
        "spread_usd": round(a["spread_bits"] / 10000, 4) if a.get("spread_bits") is not None else None,
        "vol24_contracts": (a["vol24_c"] / 100) if a.get("vol24_c") is not None else None,
        "model_pick": a["score"] >= float(MIN_MODEL_SCORE), "source": a.get("source"),
    }


def write_artifact(st, watch_rows, sources, log_list, status="live", note=""):
    quotes = {t: w.get("last_quote") or {} for t, w in st["watch"].items()}
    realised = [t for t in st["trades"] if t["status"] != "open"]
    wins = [t for t in realised if t.get("pnl_cc", 0) > 0]
    cost_all = sum(t["cost_cc"] + t["fee_cc"] for t in realised)
    pnl_all = sum(t.get("pnl_cc", 0) for t in realised)
    eq = equity_cc(st, quotes)
    peak = max([e["equity_cc"] for e in st["equity"]], default=BANKROLL_BITS)
    dd = 0
    run_peak = 0
    for e in st["equity"]:
        run_peak = max(run_peak, e["equity_cc"])
        dd = min(dd, e["equity_cc"] - run_peak)
    art = {
        "artifact": "kalshi-demo-ci-paper-portfolio",
        "version": 1,
        "engine": {"name": "scripts/portfolio_engine.py", "version": ENGINE_VERSION,
                   "bankroll_start_usd": usd(BANKROLL_BITS, 2),
                   "per_trade_usd": usd(PER_TRADE_BITS, 2),
                   "max_open_positions": MAX_OPEN_POSITIONS,
                   "alert_threshold_usd": ALERT_THRESHOLD_BITS / 10000,
                   "fee_rule": FEE_RULE_TEXT,
                   "series_fees_cached": len(st.get("series_fees") or {}),
                   "score_formula": MODEL_SCORE_FORMULA,
                   "min_model_score": float(MIN_MODEL_SCORE),
                   "rules": RULES},
        "generated_at": now_iso(),
        "status": status,
        "note": note,
        "watchlist_size": len(st["watch"]),
        "summary": {
            "trades_total": len(st["trades"]),
            "open": len(open_positions(st)),
            "realised": len(realised),
            "settled": len([t for t in realised if t["status"] == "settled"]),
            "wins": len(wins),
            "losses": len([t for t in realised if t.get("pnl_cc", 0) < 0]),
            "flat": len([t for t in realised if t.get("pnl_cc", 0) == 0]),
            "win_rate_pct": round(len(wins) / len(realised) * 100, 1) if realised else None,
            "realised_pnl_usd": usd(pnl_all),
            "realised_cost_usd": usd(cost_all),
            "roi_pct": round(pnl_all / cost_all * 100, 2) if cost_all else None,
            "cash_usd": usd(st["cash_cc"]),
            "equity_usd": usd(eq),
            "return_on_bankroll_pct": round((eq - BANKROLL_BITS) / BANKROLL_BITS * 100, 3),
            "peak_equity_usd": usd(peak),
            "max_drawdown_usd": usd(dd),
            "alerts_total": len(st["alerts"]),
        },
        "by_strategy": aggregate(st, quotes, "strategy"),
        "by_topic": aggregate(st, quotes, "topic"),
        "positions": [trade_public(t) for t in open_positions(st)][-40:],
        "trades": [trade_public(t) for t in st["trades"]][-250:],
        "resolutions": st["resolutions"][-120:],
        "alerts": [alert_public(a) for a in st["alerts"]][-120:],
        "equity_curve": [{"t": e["t"], "equity_usd": usd(e["equity_cc"]),
                          "cash_usd": usd(e["cash_cc"]), "open": e.get("open", 0)}
                         for e in st["equity"]][-800:],
        "watchlist": [{
            "ticker": w.get("ticker"), "topic": w.get("topic"), "title": w.get("title"),
            "event_ticker": w.get("event_ticker"),
            "last_usd": round(w["last_quote"]["last"] / 10000, 4) if w.get("last_quote", {}).get("last") is not None else None,
            "yes_bid_usd": round(w["last_quote"]["yes_bid"] / 10000, 4) if w.get("last_quote", {}).get("yes_bid") is not None else None,
            "yes_ask_usd": round(w["last_quote"]["yes_ask"] / 10000, 4) if w.get("last_quote", {}).get("yes_ask") is not None else None,
            "status": w.get("last_quote", {}).get("status"),
            "result": w.get("last_quote", {}).get("result"),
            "close_time": w.get("close_time"),
            "samples": len(w.get("samples") or []),
            "first_seen": w.get("first_seen"), "last_seen": w.get("last_seen"),
            "source": w.get("source"),
        } for t, w in sorted(st["watch"].items())][:120],
        "runs": st["runs"][-40:],
        "sources": {
            "quote_endpoints": sources[:8],
            "watchlist_snapshot": [f"data/topics/{t}.json" for t in TOPICS],
            "official_docs": {
                "demo_environment": "https://docs.kalshi.com/getting_started/demo_env",
                "get_markets": "https://docs.kalshi.com/api-reference/market/get-markets",
                "market_lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
                "fixed_point": "https://docs.kalshi.com/getting_started/fixed_point_migration",
                "fee_schedule": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
                "get_series": "https://docs.kalshi.com/api-reference/market/get-series",
                "rate_limits": "https://docs.kalshi.com/getting_started/rate_limits",
            },
        },
        "disclaimer": ("Simulation only. No orders are placed and no account is contacted. Demo prices may not "
                       "reflect real markets (official demo-environment note). Real demo-account tracking requires "
                       "the owner's own demo API key — see flagged.html."),
        "log": log_list[-40:],
    }
    with open(ART_PATH, "w", encoding="utf-8") as f:
        json.dump(art, f, indent=1, ensure_ascii=False)
    return art


# ------------------------------------------------------------------------------ CLI
def cmd_seed(args):
    log_list = []
    st = load_state()
    rows = load_topic_rows()
    if not rows:
        print("no topic snapshots found under data/topics/ — run scripts/collect.py first", file=sys.stderr)
        return 2
    picked = pick_watchlist(rows, per_topic=args.per_topic, total=args.total)
    for r in picked:
        w = st["watch"].setdefault(r["ticker"], {})
        w.update({"ticker": r["ticker"], "topic": r["topic"], "title": r["title"],
                  "event_ticker": r["event_ticker"], "close_time": r.get("close_time"),
                  "source": r.get("source_url")})
        w.setdefault("first_seen", now_iso())
        w.setdefault("samples", [])
        w["last_quote"] = quote_view(r)
        p = w["last_quote"]["last"]
        if p is not None:
            w["samples"] = [{"t": now_iso(), "p": p, "bid": w["last_quote"]["yes_bid"],
                             "ask": w["last_quote"]["yes_ask"]}]
            st["crossed50"].setdefault(r["ticker"], "above" if p >= 5000 else "below")
        log_line(log_list, f"SEED {r['ticker']} topic={r['topic']} last={price_str(p)}")
    st["runs"].append({"t": now_iso(), "mode": "seed", "watchlist": len(picked),
                       "requests": 0, "log": log_list[-10:]})
    st["log"] = (st.get("log", []) + log_list)[-60:]
    save_state(st)
    art = write_artifact(st, picked, [f"data/topics/{t}.json" for t in TOPICS], log_list,
                         status="baseline",
                         note=args.note or "watchlist baseline: quotes taken once, no swings compared yet")
    print(f"seeded {len(picked)} markets; artifact {os.path.getsize(ART_PATH):,}B")
    return 0


def cmd_run(args):
    log_list = []
    st = load_state()
    rows = load_topic_rows()
    picked = pick_watchlist(rows, per_topic=args.per_topic, total=args.total) if rows else []
    for r in picked:
        w = st["watch"].setdefault(r["ticker"], {})
        w.update({"ticker": r["ticker"], "topic": r["topic"], "title": r["title"],
                  "event_ticker": r["event_ticker"], "close_time": r.get("close_time"),
                  "source": r.get("source_url")})
        w.setdefault("first_seen", now_iso())
        w.setdefault("samples", [])
        w.setdefault("last_quote", quote_view(r))
        if not w["samples"] and w["last_quote"].get("last") is not None:
            w["samples"] = [{"t": now_iso(), "p": w["last_quote"]["last"],
                             "bid": w["last_quote"]["yes_bid"], "ask": w["last_quote"]["yes_ask"]}]
            st["crossed50"].setdefault(r["ticker"], "above" if w["last_quote"]["last"] >= 5000 else "below")
        # retire markets that settled a long time ago
        q = w.get("last_quote") or {}
        if q.get("status") == "finalized" and w.get("last_seen") and w["last_seen"] < _days_ago(2):
            st["watch"].pop(r["ticker"], None)

    if not st["watch"]:
        log_line(log_list, "no watchlist; nothing to do")
        save_state(st)
        write_artifact(st, [], [], log_list, status="degraded",
                       note="no watchlist available (data/topics/*.json missing)")
        return 0

    tickers = list(st["watch"].keys())
    sources = []
    if args.offline:
        quotes = {t: st["watch"][t].get("last_quote") or {} for t in tickers}
        # offline mode replays the snapshot: one synthetic cycle so the artifact has content
        quotes = {t: _as_market(st["watch"][t]) for t in tickers}
        log_line(log_list, f"OFFLINE cycle over {len(quotes)} watchlist markets (no network)")
        sources = [f"data/topics/{t}.json" for t in TOPICS]
    else:
        raw, sources = fetch_quotes(tickers, log_list)
        if not raw:
            log_line(log_list, "no quotes returned; state preserved, artifact marked degraded")
            st["runs"].append({"t": now_iso(), "mode": "run", "watchlist": len(tickers),
                               "requests": len(sources), "degraded": True, "log": log_list[-10:]})
            st["log"] = (st.get("log", []) + log_list)[-60:]
            save_state(st)
            write_artifact(st, picked, sources, log_list, status="degraded",
                           note="the demo API returned no quotes on this run; last known state preserved")
            return 0
        quotes = {t: m for t, m in raw.items() if t in st["watch"]}
        for t in quotes:
            st["watch"][t]["last_seen"] = now_iso()
        # Per-series taker multipliers for the trade universe (official demo
        # fee_multiplier), so entries book the exchange-published M instead of
        # assuming 1. Cached across runs; cap bounds request volume.
        universe = sorted({series_of(t) for t in tickers})
        sources += fetch_series_fees(st, universe, log_list)

    when = now_iso()
    events = run_cycle(st, quotes, sources, when, log_list)
    st["runs"].append({"t": when, "mode": "offline" if args.offline else "live",
                       "quotes": len(quotes), "events": len(events),
                       "requests": len(sources), "log": log_list[-12:]})
    st["trades"] = st["trades"][-MAX_TRADES_KEPT:]
    st["alerts"] = st["alerts"][-MAX_ALERTS_KEPT:]
    st["resolutions"] = st["resolutions"][-MAX_RESOLUTIONS_KEPT:]
    st["log"] = (st.get("log", []) + log_list)[-60:]
    save_state(st)
    art = write_artifact(st, picked, sources, log_list,
                         status="live" if not args.offline else "offline-replay",
                         note="cycle complete" if not args.offline else
                         "offline replay of the committed snapshot: no live quotes were fetched")
    size = os.path.getsize(ART_PATH)
    print(f"cycle: {len(quotes)} quotes, {len(events)} events, artifact {size:,}B")
    for e in events[:25]:
        print("  " + e)
    if size > 900_000:
        print("WARNING: artifact exceeds 900 kB; reduce bounds", file=sys.stderr)
    return 0


def _dstr(b):
    """bits (1e-4 USD) -> official 4-decimal dollar string; None passes through."""
    if b is None:
        return None
    sign = "-" if b < 0 else ""
    a = abs(int(b))
    return f"{sign}{a // 10000}.{a % 10000:04d}"


def _as_market(w):
    """Rebuild an API-shaped market object from a stored watch entry (offline replay only)."""
    q = w.get("last_quote") or {}
    return {
        "ticker": w.get("ticker"), "event_ticker": q.get("event_ticker"), "title": q.get("title"),
        "status": q.get("status"), "result": q.get("result"),
        "last_price_dollars": _dstr(q.get("last")),
        "yes_bid_dollars": _dstr(q.get("yes_bid")),
        "yes_ask_dollars": _dstr(q.get("yes_ask")),
        "no_bid_dollars": _dstr(q.get("no_bid")),
        "no_ask_dollars": _dstr(q.get("no_ask")),
        "volume_24h_fp": None, "volume_fp": None,
        "close_time": q.get("close_time"), "settlement_ts": q.get("settlement_ts"),
    }


def _days_ago(n):
    return datetime.fromtimestamp(time.time() - n * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- selftest
def selftest():
    fails, checks = [], 0

    def ok(name, cond, detail=""):
        nonlocal checks
        checks += 1
        if not cond:
            fails.append(f"{name} {detail}")
            print(f"FAIL {name} {detail}")
        else:
            print(f"pass {name}")

    # 1. price/qty parsing is exact on official 4-dp strings
    ok("bits parses '0.5000' -> 5000", bits("0.5000") == 5000)
    ok("bits parses number 0.5 -> 5000", bits(0.5) == 5000)
    ok("bits parses '0.1234' -> 1234", bits("0.1234") == 1234)
    ok("bits('0.123456') rounds half-up to 1235", bits("0.123456") == 1235, str(bits("0.123456")))
    ok("bits(None) is None", bits(None) is None)
    ok("contracts('10.00') -> 1000", contracts("10.00") == 1000)
    ok("contracts('1.5') -> 150", contracts("1.5") == 150)
    ok("contracts('7') -> 700", contracts("7") == 700)

    # 2. fee math pinned to the official schedule's worked table rows
    #    (https://kalshi.com/docs/kalshi-fee-schedule.pdf: fee for 100 contracts @ $0.50 = $1.75)
    ok("fee 100c @ $0.50 = $1.75 exactly", taker_fee(100 * 100, 5000) == 1_750_000,
       money_str(taker_fee(100 * 100, 5000)))
    ok("fee 100c @ $0.99 = $0.0693 exactly (table displays $0.07)", taker_fee(100 * 100, 9900) == 69_300,
       money_str(taker_fee(100 * 100, 9900)))
    ok("fee 100c @ $0.01 = $0.0693 exactly (table displays $0.07)", taker_fee(100 * 100, 100) == 69_300,
       money_str(taker_fee(100 * 100, 100)))
    ok("fee 1c @ $0.50 = $0.0175 (6 dp, ceil_6dp of an exact value)", taker_fee(100, 5000) == 17_500,
       money_str(taker_fee(100, 5000)))
    ok("fee 1c @ $0.01 = $0.000693 exact", taker_fee(100, 100) == 693, money_str(taker_fee(100, 100)))
    ok("cent-rounded display of the table's 1c/$0.50 row", round(taker_fee(100, 5000) / 1e6, 2) == 0.02)
    ok("cent-rounded display of the table's 100c/$0.99 row", round(taker_fee(100 * 100, 9900) / 1e6, 2) == 0.07)
    ok("fee(0 contracts) = 0", taker_fee(0, 5000) == 0)
    # Worked example, https://docs.kalshi.com/getting_started/fee_rounding (non-direct member,
    # $0.01 balance alignment): buy with revenue -$0.055000 and model fee $0.00363825
    #   trade fee      = ceil_6dp($0.00363825) = $0.003639
    #   aligned change = floor_cent(-$0.055 - $0.003639) = -$0.060000
    #   rounding fee   = $0.001361      (trade fee + rounding fee = exactly $0.005)
    ok("ceil_6dp(0.00363825) = 0.003639", math.ceil(Fraction("0.00363825") * 1_000_000) == 3639)
    ok("aligned change floors to -$0.06", align_down(-(55_000 + 3_639)) == -60_000)
    ok("rounding fee is $0.001361", (-60_000) - (-(55_000 + 3_639)) == -1361)

    # 2b. per-series fee multiplier (demo GET /series/{ticker} fee_multiplier,
    #     official Get Series schema; default M=1 when no record is cached)
    ok("default multiplier is 1 with an empty cache", series_multiplier({}, "KXTEST-1") == 1)
    ok("default multiplier is 1 when the series was never fetched",
       series_multiplier({"series_fees": {}}, "KXBTCY-26DEC31-100000") == 1)
    st_fee = {"series_fees": {"KXBTCY": {"fee_multiplier": 0},
                              "KXHALF": {"fee_multiplier": 0.5}}}
    ok("cached demo fee_multiplier=0 means no taker fee", taker_fee(100 * 100, 5000, series_multiplier(st_fee, "KXBTCY-1")) == 0)
    ok("cached demo fee_multiplier=0.5 halves the fee (100c @ $0.50 -> $0.875)",
       taker_fee(100 * 100, 5000, series_multiplier(st_fee, "KXHALF-1")) == 875_000,
       money_str(taker_fee(100 * 100, 5000, series_multiplier(st_fee, "KXHALF-1"))))
    ok("cash_debit with M=0 books no fee", cash_debit(4800, 5000, Fraction(0))[2] == 0)
    ok("trade_multiplier prefers the fee_m recorded at entry",
       trade_multiplier({"series_fees": {"KXTEST": {"fee_multiplier": 0.5}}},
                        {"ticker": "KXTEST-1", "fee_m": 0}) == 0)
    ok("trade_multiplier falls back to the cached series record when fee_m is absent",
       trade_multiplier(st_fee, {"ticker": "KXHALF-1"}) == Fraction(1, 2))
    ok("bool is not accepted as a multiplier", series_multiplier(
        {"series_fees": {"KXBAD": {"fee_multiplier": True}}}, "KXBAD-1") == 1)

    # 3. the >= $0.10 rule must be exact at the boundary (binary float would fail this)
    ok("float trap: 0.66-0.56 < 0.10 in float", (0.66 - 0.56) < 0.10)
    ok("bit math: $0.66->$0.56 is exactly 1000 bits", abs(bits("0.5600") - bits("0.6600")) == ALERT_THRESHOLD_BITS)
    ok("bit math: $0.5010->$0.4020 is 990 bits (below threshold)",
       abs(bits("0.4020") - bits("0.5010")) == 990)
    ok("threshold test fires at exactly $0.10", abs(bits("0.4500") - bits("0.5500")) >= ALERT_THRESHOLD_BITS)

    # 4. budget sizing respects cost + fee in centicents
    b = gross_for_budget(25_000_000, 5000)          # $25 budget at $0.50, entry fee included
    ok("budget sizing at $0.50 with $25 = 48.32 contracts (fee included)", b == 4832, f"{b/100}")
    ok("the ledger trades whole contracts only", (b // 100) * 100 == 4800)
    ok("aligned cost+fee fits the budget", cash_debit(b, 5000)[0] <= 25_000_000)
    ok("one more contract would exceed it", cash_debit(b + 1, 5000)[0] > 25_000_000)
    ok("cash is always on the $0.01 grid", (BANKROLL_BITS - cash_debit(b, 5000)[0]) % 10000 == 0)

    # 5. model score: mirrors the documented formula, half-up at 3 dp
    s = model_score(1000, 2000 * 100, 10000 * 100, 0)
    # 0.30 (vol24 saturated) + 0.25 (volume saturated) + 0.20 (zero spread) + 0.25*0.4 (10c move)
    ok("score = 0.85 for a saturated-liquidity 10c move", abs(s - 0.85) < 1e-9, str(s))
    ok("score >= min for a fat-volume up move", s >= float(MIN_MODEL_SCORE))
    ok("score small for illiquid penny move", model_score(1000, 0, 0, 2000) <= 0.30, str(model_score(1000, 0, 0, 2000)))

    # 6. end-to-end cycle on a synthetic fixture: swing -> momentum entry -> TP exit -> settlement
    st = {"version": ENGINE_VERSION, "created_at": now_iso(), "updated_at": None,
          "cash_cc": BANKROLL_BITS, "watch": {}, "trades": [], "alerts": [], "resolutions": [],
          "equity": [], "runs": [], "crossed50": {}, "harvest_cool": {}, "log": []}
    tk = "KXTEST-1"
    st["watch"][tk] = {"ticker": tk, "topic": "crypto", "title": "Test market", "event_ticker": "KXTEST",
                       "samples": [{"t": "2026-11-20T00:00:00Z", "p": 6600, "bid": 6500, "ask": 6700}],
                       "last_quote": None, "close_time": "2026-12-01T00:00:00Z", "source": "fixture"}
    ll = []
    m1 = {"ticker": tk, "event_ticker": "KXTEST", "title": "Test market", "status": "active",
          "last_price_dollars": "0.5600", "yes_bid_dollars": "0.5500", "yes_ask_dollars": "0.5700",
          "no_bid_dollars": "0.4300", "no_ask_dollars": "0.4500",
          "volume_24h_fp": "9000.00", "volume_fp": "30000.00", "close_time": "2026-12-01T00:00:00Z"}
    ev = run_cycle(st, {tk: m1}, ["fixture://m1"], "2026-11-20T01:00:00Z", ll)
    ok("down move >= $0.10 raised exactly one alert", len(st["alerts"]) == 1, str(ev))
    a = st["alerts"][0]
    ok("alert delta is -0.10 exactly", a["delta_bits"] == -1000)
    ok("alert dir down", a["dir"] == "down")
    ok("momentum entered NO on a down move with good score",
       any(t["strategy"] == "momentum" and t["side"] == "no" for t in st["trades"]), str(ev))
    t0 = st["trades"][0]
    ok("entry at the NO ask 0.45", t0["entry_bits"] == 4500)
    ok("entry records the series and the fee multiplier used (default M=1)",
       t0.get("series") == "KXTEST" and t0.get("fee_m") == 1.0, json.dumps({k: t0.get(k) for k in ("series", "fee_m")}))
    ok("cash decreased by the aligned debit (cost+fee floored to the cent grid)",
       st["cash_cc"] == BANKROLL_BITS - cash_debit(t0["qty_c"], t0["entry_bits"])[0],
       money_str(st["cash_cc"]))
    # next sample: YES eased 1c further down (below the alert threshold) so the NO bid is now
    # 0.6100 - a +16c gain against the 0.4500 entry, which is at or above momentum's +15c TP.
    m2 = dict(m1); m2["last_price_dollars"] = "0.5500"; m2["yes_bid_dollars"] = "0.5400"
    m2["yes_ask_dollars"] = "0.5600"; m2["no_bid_dollars"] = "0.6100"; m2["no_ask_dollars"] = "0.6200"
    run_cycle(st, {tk: m2}, ["fixture://m2"], "2026-11-20T01:30:00Z", ll)
    ok("momentum take-profit fired at +16c", t0["status"] == "closed" and t0["exit"]["reason"] == "take-profit",
       json.dumps(t0.get("exit")))
    ok("realised P&L = aligned credit - cost - fee - rounding",
       t0["pnl_cc"] == cash_credit(t0["qty_c"], 6100)[0] - t0["cost_cc"] - t0["fee_cc"] - t0.get("rounding_cc", 0),
       money_str(t0["pnl_cc"]))
    ok("ledger is self-consistent: debit - credit == -pnl",
       (t0["cost_cc"] + t0["fee_cc"] + t0.get("rounding_cc", 0)) - cash_credit(t0["qty_c"], 6100)[0] == -t0["pnl_cc"])
    # settlement of a fresh harvest position
    st2 = {"version": ENGINE_VERSION, "created_at": now_iso(), "cash_cc": BANKROLL_BITS, "watch": {},
           "trades": [], "alerts": [], "resolutions": [], "equity": [], "runs": [],
           "crossed50": {}, "harvest_cool": {}, "log": []}
    st2["watch"][tk] = {"ticker": tk, "topic": "golf", "title": "Golf test", "event_ticker": "KXTEST",
                        "samples": [{"t": "2026-11-20T00:00:00Z", "p": 9200, "bid": 9100, "ask": 9200}],
                        "last_quote": None, "close_time": _hours_ahead(2), "source": "fixture"}
    m3 = dict(m1); m3["last_price_dollars"] = "0.9200"; m3["yes_bid_dollars"] = "0.9100"
    m3["yes_ask_dollars"] = "0.9200"; m3["close_time"] = _hours_ahead(2)
    run_cycle(st2, {tk: m3}, ["fixture://m3"], "2026-11-20T01:00:00Z", ll)
    ok("harvest bought YES near 92c", any(t["strategy"] == "harvest" and t["side"] == "yes" for t in st2["trades"]),
       str([t["strategy"] for t in st2["trades"]]))
    h = st2["trades"][0]
    m4 = dict(m3); m4["status"] = "finalized"; m4["result"] = "yes"; m4["settlement_ts"] = "2026-11-20T10:00:00Z"
    run_cycle(st2, {tk: m4}, ["fixture://m4"], "2026-11-20T02:00:00Z", ll)
    ok("settled YES pays $1.00 per contract",
       h["status"] == "settled" and h["exit"]["proceeds_cc"] == h["qty_c"] * 10000, json.dumps(h["exit"]))
    ok("settlement carries no fee (official schedule)", h["exit"]["fee_cc"] == 0)
    ok("cash stays on the $0.01 alignment grid", st2["cash_cc"] % 10000 == 0)
    ok("resolution recorded with YES", st2["resolutions"] and st2["resolutions"][-1]["result"] == "yes")
    ok("equity bankroll preserved on a correct 92c harvest buy",
       st2["cash_cc"] > BANKROLL_BITS, money_str(st2["cash_cc"]))

    # 7. no-trade cycle when nothing moves (idempotence guard)
    st3 = {"version": ENGINE_VERSION, "created_at": now_iso(), "cash_cc": BANKROLL_BITS, "watch": {},
           "trades": [], "alerts": [], "resolutions": [], "equity": [], "runs": [],
           "crossed50": {}, "harvest_cool": {}, "log": []}
    st3["watch"][tk] = {"ticker": tk, "topic": "crypto", "title": "x", "event_ticker": "KXTEST",
                        "samples": [{"t": "2026-11-20T00:00:00Z", "p": 5000, "bid": 4900, "ask": 5100}],
                        "last_quote": None, "close_time": _hours_ahead(30), "source": "fixture"}
    m5 = {"ticker": tk, "event_ticker": "KXTEST", "title": "x", "status": "active",
          "last_price_dollars": "0.5010", "yes_bid_dollars": "0.4900", "yes_ask_dollars": "0.5100",
          "no_bid_dollars": "0.4900", "no_ask_dollars": "0.5100",
          "volume_24h_fp": "10.00", "volume_fp": "10.00", "close_time": _hours_ahead(30)}
    run_cycle(st3, {tk: m5}, ["fixture://m5"], "2026-11-20T01:00:00Z", ll)
    ok("99-bit move raises no alert", st3["alerts"] == [])
    ok("no entries without an alert and outside other rules", st3["trades"] == [])
    ok("equity point recorded anyway", len(st3["equity"]) == 1)

    # 8. determinism: identical inputs -> identical public tables (timestamp field excluded)
    def run_once():
        s = load_state_like()
        l2 = []
        run_cycle(s, {tk: m1}, ["fixture://d"], "2026-11-20T01:00:00Z", l2)
        return json.dumps({"alerts": s["alerts"], "trades": s["trades"]}, sort_keys=True)
    ok("deterministic given fixed clock", run_once() == run_once())

    print(f"\n{checks - len(fails)}/{checks} checks passed")
    if fails:
        print("FAILURES:\n  " + "\n  ".join(fails))
        return 1
    return 0


def load_state_like():
    return {"version": ENGINE_VERSION, "created_at": now_iso(), "cash_cc": BANKROLL_BITS, "watch": {
        "KXTEST-1": {"ticker": "KXTEST-1", "topic": "crypto", "title": "Test market",
                     "event_ticker": "KXTEST",
                     "samples": [{"t": "2026-11-20T00:00:00Z", "p": 6600, "bid": 6500, "ask": 6700}],
                     "last_quote": None, "close_time": "2026-12-01T00:00:00Z", "source": "fixture"}},
        "trades": [], "alerts": [], "resolutions": [], "equity": [], "runs": [],
        "crossed50": {}, "harvest_cool": {}, "log": []}


def _hours_ahead(h):
    return datetime.fromtimestamp(time.time() + h * 3600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv=None):
    global BASE
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", nargs="?", default="run", choices=["run", "seed", "selftest"])
    ap.add_argument("--offline", action="store_true", help="no network; replay the committed snapshot")
    ap.add_argument("--per-topic", type=int, default=16)
    ap.add_argument("--total", type=int, default=72)
    ap.add_argument("--note", default="")
    ap.add_argument("--base", default=BASE, help="API base URL (demo by default)")
    args = ap.parse_args(argv)
    BASE = args.base.rstrip("/")
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if args.cmd == "selftest":
        return selftest()
    if args.cmd == "seed":
        return cmd_seed(args)
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
