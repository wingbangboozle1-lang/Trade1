"""
Live execution against the Kalshi DEMO account (real orders, mock money).

This is the only module that can place an order, and it refuses to run unless all of the
following are true:

  1. credentials are present in the environment
        KALSHI_DEMO_API_KEY_ID          - the API key UUID from the demo site
        KALSHI_DEMO_PRIVATE_KEY_PATH    - path to the downloaded PEM private key
  2. the base URL is a documented DEMO endpoint
        https://external-api.demo.kalshi.co/trade-api/v2  (recommended)
        https://demo-api.kalshi.co/trade-api/v2            (also supported)
     (https://docs.kalshi.com/getting_started/demo_env)
  3. --i-understand-this-trades-demo-money is passed

Safety rails beyond that:
  * per-order contract cap and a total notional cap per run
  * one order per (ticker, side) per run
  * every request/response is appended to data/live/orders.jsonl for audit
  * --dry-run builds and prints the exact request without sending it

Verified references:
  * signing:   https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
  * endpoints: https://docs.kalshi.com/getting_started/demo_env
  * balance:   https://docs.kalshi.com/api-reference/portfolio/get-balance
  * orders:    https://docs.kalshi.com/api-reference/portfolio/create-order

Status: implemented and self-tested here, NOT executed, because no demo credentials exist in this
environment. That is recorded on the Flagged for Review page.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector.kalshi_client import DEMO, KalshiClient, demo_client_from_env
from collector.util import DATA, iso, read_json, write_json

DEMO_HOSTS = ("external-api.demo.kalshi.co", "demo-api.kalshi.co")
MAX_CONTRACTS_PER_ORDER = 25
MAX_NOTIONAL_PER_RUN = 250.00


def audit(record: dict) -> None:
    path = os.path.join(DATA, "live", "orders.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def preflight(base: str) -> tuple[bool, list[str]]:
    problems = []
    if not any(h in base for h in DEMO_HOSTS):
        problems.append(f"base URL {base} is not a documented demo endpoint")
    if not os.environ.get("KALSHI_DEMO_API_KEY_ID"):
        problems.append("KALSHI_DEMO_API_KEY_ID is not set")
    key_path = os.environ.get("KALSHI_DEMO_PRIVATE_KEY_PATH")
    if not key_path:
        problems.append("KALSHI_DEMO_PRIVATE_KEY_PATH is not set")
    elif not os.path.exists(key_path):
        problems.append(f"private key not found at {key_path}")
    return (not problems), problems


def account_state(client: KalshiClient) -> dict:
    balance = client.balance()
    positions = client.positions()
    return {
        "checked_at": iso(),
        "endpoint": client.base_url,
        "balance": balance,
        "positions": positions,
    }


def place_from_signals(client: KalshiClient, signals: list[dict], dry_run: bool = False,
                       contracts: int = 1) -> list[dict]:
    """Place limit orders for a list of {ticker, side, price} dicts, within the safety rails."""
    results, seen, notional = [], set(), 0.0
    for sig in signals:
        key = (sig["ticker"], sig["side"])
        if key in seen:
            continue
        seen.add(key)
        size = min(int(contracts), MAX_CONTRACTS_PER_ORDER)
        price_cents = int(round(float(sig["price"]) * 100))
        if price_cents <= 0 or price_cents >= 100:
            results.append({**sig, "status": "rejected", "why": "price outside 1-99 cents"})
            continue
        cost = size * price_cents / 100.0
        if notional + cost > MAX_NOTIONAL_PER_RUN:
            results.append({**sig, "status": "skipped", "why": "run notional cap reached"})
            continue
        body = {
            "ticker": sig["ticker"], "action": "buy", "side": sig["side"],
            "type": "limit", "count": size,
            ("yes_price" if sig["side"] == "yes" else "no_price"): price_cents,
        }
        if dry_run:
            results.append({**sig, "status": "dry_run", "request": body, "at": iso()})
            continue
        try:
            resp = client.create_order(sig["ticker"], sig["side"], "buy", size, price_cents)
            record = {**sig, "status": "submitted", "request": body, "response": resp, "at": iso()}
            notional += cost
            audit(record)
            results.append(record)
        except Exception as e:  # noqa: BLE001
            record = {**sig, "status": "error", "request": body, "error": str(e)[:500], "at": iso()}
            audit(record)
            results.append(record)
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEMO)
    ap.add_argument("--contracts", type=int, default=1)
    ap.add_argument("--strategy", default="momentum_ignition")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--i-understand-this-trades-demo-money", action="store_true", dest="ack")
    args = ap.parse_args()

    ok, problems = preflight(args.base)
    report = {
        "generated_at": iso(),
        "base_url": args.base,
        "credentials_present": ok,
        "problems": problems,
        "executed": False,
    }

    if not ok:
        report["status"] = "blocked"
        write_json(os.path.join(DATA, "live", "status.json"), report)
        print("live trading blocked:")
        for p in problems:
            print("  -", p)
        return 0  # exit 0: this is a documented, expected state, not a build failure

    if not args.ack:
        report["status"] = "acknowledgement_required"
        write_json(os.path.join(DATA, "live", "status.json"), report)
        print("credentials found; re-run with --i-understand-this-trades-demo-money to place orders")
        return 0

    client = demo_client_from_env()
    state = account_state(client)

    # Signals come from the paper engine's most recent view so live and simulated stay comparable.
    summary = read_json(os.path.join(DATA, "paper", "summary.json")) or {}
    ledger = read_json(os.path.join(DATA, "paper", "ledger.json")) or {}
    signals = []
    for f in (ledger.get("fills") or [])[-20:]:
        if f.get("action") == "buy" and f.get("strategy") == args.strategy:
            signals.append({"ticker": f["ticker"], "side": f["side"], "price": f["price"]})

    results = place_from_signals(client, signals, dry_run=args.dry_run, contracts=args.contracts)
    report.update({
        "status": "dry_run" if args.dry_run else "submitted",
        "executed": not args.dry_run,
        "account": state,
        "orders": results,
        "paper_summary_equity": summary.get("equity"),
    })
    write_json(os.path.join(DATA, "live", "status.json"), report)
    print(f"live: status={report['status']} orders={len(results)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
