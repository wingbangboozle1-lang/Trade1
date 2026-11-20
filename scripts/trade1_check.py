#!/usr/bin/env python3
"""Pre-deploy checks for the Trade1 site.

1. Every HTML page in trade1/ exists and every local href/src resolves to a file.
2. Every row in trade1/data/markets.json has a source_url on the Kalshi API host.
3. Every row with an empty value is listed in 'unverified' (nothing silently filled).
Exit code 1 on any failure, so the deploy workflow stops before publishing.
"""
import json
import pathlib
import re
import sys

SITE = pathlib.Path("trade1")
API = "https://external-api.kalshi.com/trade-api/v2/"
errors = []

for html in SITE.rglob("*.html"):
    text = html.read_text(encoding="utf-8")
    for ref in re.findall(r'(?:href|src)="([^"#?]+)"', text):
        if ref.startswith(("http://", "https://", "mailto:", "data:")):
            continue
        target = (html.parent / ref).resolve()
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            errors.append(f"{html}: broken link {ref}")

data = json.loads((SITE / "data" / "markets.json").read_text(encoding="utf-8"))
unverified_tickers = {(u.get("type"), u.get("ticker")) for u in data.get("unverified", [])}
for topic, t in (data.get("topics") or {}).items():
    for r in t.get("rows", []):
        if not str(r.get("source_url", "")).startswith(API):
            errors.append(f"{topic}/{r.get('ticker')}: missing Kalshi source link")
        for f in ("yes_bid", "yes_ask", "last_price", "volume_24h", "open_interest", "close_time"):
            if r.get(f) in (None, ""):
                if ("missing_fields", r.get("ticker")) not in unverified_tickers:
                    errors.append(f"{topic}/{r.get('ticker')}: blank {f} not flagged")
for j in data.get("jumps", []):
    if not j.get("source_url", "") or not str(j["source_url"]).startswith(API):
        errors.append(f"jump {j.get('ticker')}: missing source link")

for name in ("flags.json",):
    json.loads((SITE / "data" / name).read_text(encoding="utf-8"))

if errors:
    print("CHECK FAILED:")
    print("\n".join(errors[:200]))
    sys.exit(1)
print(f"check_site OK: {len(list(SITE.rglob('*.html')))} pages, "
      f"{sum(data.get('counts', {}).values())} rows, {len(data.get('jumps', []))} jumps")

# Summary as workflow annotations so reviewers can read the run result via the GitHub API.
print(f"::notice title=Trade1 run summary::generated_at={data.get('generated_at')} "
      f"counts={json.dumps(data.get('counts', {}))} jumps={len(data.get('jumps', []))} "
      f"resolved={len(data.get('resolved', []))} tracked={len(data.get('tracking', []))} "
      f"unverified={len(data.get('unverified', []))}")
for topic, t in (data.get("topics") or {}).items():
    top = sorted(t.get("rows", []), key=lambda r: -(r.get("est_dollars_24h") or 0))[:3]
    for r in top:
        print(f"::notice title=top {topic}::{r.get('ticker')} | {r.get('market_title')} | "
              f"last={r.get('last_price')} vol24h={r.get('volume_24h')} est24h={r.get('est_dollars_24h')} "
              f"rule={r.get('match_rule')}")
