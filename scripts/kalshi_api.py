"""Minimal, dependency-free client for the official Kalshi Trade API (public GET endpoints only).

Base URLs are taken from https://docs.kalshi.com/getting_started/api_environments.md
No authentication is used; only unauthenticated market-data GET endpoints are called.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PROD_BASE = "https://external-api.kalshi.com/trade-api/v2"
DEMO_BASE = "https://external-api.demo.kalshi.co/trade-api/v2"
BASE = os.environ.get("KALSHI_BASE_URL", DEMO_BASE)
USER_AGENT = "Trade1-dashboard/1.0 (+https://github.com/wingbangboozle1-lang/Trade1)"


class KalshiError(RuntimeError):
    pass


def get(path, params=None, retries=6):
    """GET BASE + path with query params. Retries on 429 and 5xx with exponential backoff."""
    query = ""
    if params:
        clean = {k: v for k, v in params.items() if v is not None and v != ""}
        query = "?" + urllib.parse.urlencode(clean, doseq=True) if clean else ""
    url = BASE + path + query
    delay = 1.0
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            body = exc.read().decode("utf-8", "replace")[:300]
            raise KalshiError(f"HTTP {exc.code} for {url}: {body}") from exc
        except urllib.error.URLError as exc:
            if attempt < retries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            raise KalshiError(f"Network error for {url}: {exc}") from exc
    raise KalshiError(f"Exhausted retries for {url}")


def paginate(path, key, params=None, limit=200, max_pages=500, pause=0.25):
    """Yield every item from a cursor-paginated list endpoint."""
    cursor = ""
    for _ in range(max_pages):
        p = dict(params or {})
        p["limit"] = limit
        if cursor:
            p["cursor"] = cursor
        data = get(path, p)
        for item in data.get(key, []) or []:
            yield item
        cursor = data.get("cursor") or ""
        if not cursor:
            return
        time.sleep(pause)
