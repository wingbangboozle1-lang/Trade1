"""Discovery probe: lists categories, statuses, and series/event candidates for the five topics.
Read-only; prints to the workflow log so the topic rules can be verified against official data."""
import collections, json, re, sys
sys.path.insert(0, "scripts")
import kalshi_api as k

print("BASE", k.BASE)
print("exchange status:", json.dumps(k.get("/exchange/status")))

events = list(k.paginate("/events", "events", {"status": "open", "with_nested_markets": "true"}, limit=200, max_pages=60))
print("open events fetched:", len(events))
cats = collections.Counter(e.get("category", "") for e in events)
print("CATEGORIES (open events):", dict(cats))
mstat = collections.Counter(m.get("status", "") for e in events for m in e.get("markets", []))
print("MARKET STATUSES (open events):", dict(mstat))

pat = re.compile(r"gas|gasoline|golf|pga|masters|open championship|ryder|crypto|bitcoin|btc|ethereum|eth|solana|doge|culture|oscar|grammy|emmy|box office|music|movie|album|celebrity|tiktok|election|president|senate|house|governor|mayor|primary|prime minister", re.I)
hits = []
for e in events:
    blob = " ".join([e.get("title", ""), e.get("sub_title", ""), e.get("series_ticker", ""), e.get("category", "")])
    if pat.search(blob):
        hits.append((e.get("category"), e.get("series_ticker"), e.get("event_ticker"), e.get("title")))
print("EVENT HITS:", len(hits))
allm=[m for e in events for m in e.get("markets",[])]
print("SAMPLE MARKET KEYS:", sorted(allm[0].keys()) if allm else None)
print("EVENT KEYS:", sorted(events[0].keys()) if events else None)
for h in sorted(hits, key=lambda x: (str(x[0]), str(x[1])))[:400]:
    print("  ", h)

series = list(k.paginate("/series", "series", {}, limit=1000, max_pages=20))
print("series fetched:", len(series))
scats = collections.Counter(s.get("category", "") for s in series)
print("SERIES CATEGORIES:", dict(scats))
shits = [s for s in series if pat.search(" ".join([s.get("title", ""), s.get("ticker", ""), " ".join(s.get("tags", []) or [])]))]
print("SERIES HITS:", len(shits))
for s in shits[:400]:
    print("  ", s.get("category"), "|", s.get("ticker"), "|", s.get("title"), "|", s.get("tags"), "|", s.get("contract_terms_url"))
