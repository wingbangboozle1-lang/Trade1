#!/usr/bin/env python3
"""
Probe the Kalshi Trade API (demo + production read endpoints) and dump raw responses.

Purpose: the agent workspace cannot reach Kalshi TLS endpoints, so this script runs on a
GitHub Actions runner (open egress) and writes the raw JSON to research/probe/ so the data
contract used by the collector is verified against real responses instead of assumptions.

Usage: python scripts/probe_api.py --base https://external-api.demo.kalshi.co/trade-api/v2 --out research/probe/demo
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "trade1-research-probe/1.0 (+https://github.com/wingbangboozle1-lang/Trade1)"


def get(base: str, path: str, params: dict | None = None, timeout: int = 25):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            return {"url": url, "status": r.status, "ms": round((time.time() - started) * 1000), "body": body}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "ms": round((time.time() - started) * 1000),
                "body": e.read().decode("utf-8", "replace")[:4000]}
    except Exception as e:  # noqa: BLE001 - probe must never crash the run
        return {"url": url, "status": None, "ms": round((time.time() - started) * 1000), "error": repr(e)[:600]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://external-api.demo.kalshi.co/trade-api/v2")
    ap.add_argument("--out", default="research/probe/demo")
    ap.add_argument("--full-markets", action="store_true", help="also save the full first markets page")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    calls = {
        "exchange_status": ("/exchange/status", None),
        "exchange_schedule": ("/exchange/schedule", None),
        "tags_by_categories": ("/search/tags_by_categories", None),
        "series_crypto": ("/series", {"category": "Crypto"}),
        "series_financials": ("/series", {"category": "Financials"}),
        "series_culture": ("/series", {"category": "Culture"}),
        "series_economics": ("/series", {"category": "Economics"}),
        "series_sports": ("/series", {"category": "Sports"}),
        "events_open": ("/events", {"status": "open", "limit": 200}),
        "markets_open": ("/markets", {"status": "open", "limit": 200}),
        "markets_settled": ("/markets", {"status": "settled", "limit": 50}),
        # Correct path per docs: Get Trades is /markets/trades (the bare /trades path 404s).
        "trades": ("/markets/trades", {"limit": 50}),
    }

    summary = {}
    for name, (path, params) in calls.items():
        res = get(args.base, path, params)
        body = res.get("body") or ""
        parsed = None
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            pass

        info = {"url": res["url"], "status": res["status"], "ms": res["ms"]}
        if isinstance(parsed, dict):
            for k, v in parsed.items():
                if isinstance(v, list):
                    info[f"count_{k}"] = len(v)
            # Save a small sample instead of the whole payload (keeps the repo light).
            sample = {}
            for k, v in parsed.items():
                if isinstance(v, list):
                    sample[k] = v[:3]
                elif k == "cursor":
                    sample[k] = (v or "")[:20]
                else:
                    sample[k] = v
            with open(os.path.join(args.out, f"{name}.sample.json"), "w") as f:
                json.dump(sample, f, indent=2, sort_keys=True)
            if args.full_markets and name in {"markets_open", "events_open"}:
                with open(os.path.join(args.out, f"{name}.full.json"), "w") as f:
                    json.dump(parsed, f, indent=2, sort_keys=True)
        elif parsed is not None:
            info["parsed_type"] = type(parsed).__name__
        else:
            info["error"] = res.get("error") or body[:300]
        summary[name] = info
        print(f"{name:20s} status={res['status']} {res['ms']:>5}ms {info.get('error', '')}")

    # Derive the official category -> tags map and the topic-relevant series index.
    tags_path = os.path.join(args.out, "tags_by_categories.sample.json")
    if os.path.exists(tags_path):
        raw = json.load(open(tags_path)).get("tags_by_categories") or {}
        info = {cat: tags for cat, tags in raw.items()}
        with open(os.path.join(args.out, "category_tags.json"), "w") as f:
            json.dump(info, f, indent=2, sort_keys=True)
        print(f"categories: {sorted(info)}")

    with open(os.path.join(args.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2, sort_keys=True)
    print(f"\nWrote probe to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
