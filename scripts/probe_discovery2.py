"""Probe 2: status semantics, candlesticks, orderbook, historical cutoff, CORS header, topic series."""
import collections, json, re, sys, time
sys.path.insert(0, "scripts")
import kalshi_api as k
import urllib.request

def show(title, obj, n=900):
    s = json.dumps(obj)[:n]
    print(f"## {title}\n{s}\n")

for st in ["open", "closed", "settled", "finalized", "active"]:
    try:
        d = k.get("/markets", {"status": st, "limit": 3})
        ms = d.get("markets", [])
        print(f"## /markets?status={st}: count={len(ms)} statuses={[m.get('status') for m in ms]} results={[m.get('result') for m in ms]} cursor_len={len(d.get('cursor',''))}")
    except Exception as e:
        print(f"## /markets?status={st}: ERROR {str(e)[:200]}")

try:
    show("historical/cutoff", k.get("/historical/cutoff"))
except Exception as e:
    print("## historical/cutoff ERROR", str(e)[:200])

# topic series
series = list(k.paginate("/series", "series", {}, limit=1000, max_pages=20))
def topic_of(s):
    t = set(s.get("tags") or [])
    tk = s.get("ticker", "")
    cat = s.get("category", "")
    if re.match(r"^(KX)?AAAGAS", tk):
        return "Gas prices"
    if "Golf" in t:
        return "Golf"
    if cat == "Crypto":
        return "Crypto"
    if cat in ("Entertainment", "Culture"):
        return "Culture"
    if cat == "Elections":
        return "Elections"
    return None
cnt = collections.Counter(topic_of(s) for s in series)
print("TOPIC SERIES COUNTS:", dict(cnt))
for tp in ["Gas prices", "Golf", "Crypto"]:
    rows = [s for s in series if topic_of(s) == tp]
    print(f"## series for {tp}: {len(rows)}")
    for s in rows[:60]:
        print("   ", s.get("ticker"), "|", s.get("category"), "|", s.get("title"), "|", s.get("tags"), "|", s.get("fee_type"), "|", s.get("contract_terms_url"))

# markets for a gas series
try:
    d = k.get("/markets", {"series_ticker": "KXAAAGASM", "limit": 3})
    ms = d.get("markets", [])
    print("## KXAAAGASM markets:", [(m["ticker"], m.get("status"), m.get("result"), m.get("last_price_dollars"), m.get("volume_fp")) for m in ms])
    if ms:
        show("KXAAAGASM first market (full)", ms[0], 3000)
        t = ms[0]["ticker"]
        now = int(time.time())
        c = k.get(f"/series/KXAAAGASM/markets/{t}/candlesticks", {"start_ts": now - 3*86400, "end_ts": now, "period_interval": 60})
        cs = c.get("candlesticks", [])
        print("## candlesticks 1h last 3d count:", len(cs))
        show("candlestick[0]", cs[0] if cs else None, 800)
        ob = k.get(f"/markets/{t}/orderbook")
        show("orderbook", ob, 800)
except Exception as e:
    print("## gas probe ERROR", str(e)[:400])

# CORS check (server-side header read, mimics browser Origin on GitHub Pages)
try:
    req = urllib.request.Request(k.BASE + "/exchange/status", headers={"Origin": "https://wingbangboozle1-lang.github.io", "User-Agent": k.USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as r:
        print("## CORS ACAO header:", r.headers.get("Access-Control-Allow-Origin"), "| status", r.status)
except Exception as e:
    print("## CORS check ERROR", str(e)[:200])

# Finalized market detail for a known resolved market
try:
    d = k.get("/markets", {"status": "finalized", "limit": 2})
    for m in d.get("markets", [])[:2]:
        print("## finalized sample:", {x: m.get(x) for x in ["ticker","event_ticker","series_ticker","status","result","settlement_value_dollars","settlement_ts","close_time","expiration_value","volume_fp","last_price_dollars"]})
except Exception as e:
    print("## finalized ERROR", str(e)[:200])
