"""
Kalshi Trade API client.

Verified against official Kalshi documentation (2026-11-20):
  - Environments / endpoints: https://docs.kalshi.com/getting_started/api_environments
  - Demo environment:         https://docs.kalshi.com/getting_started/demo_env
  - Auth headers + RSA-PSS signing:
        https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
  - Get Markets (paging/filters): https://docs.kalshi.com/api-reference/market/get-markets
  - Get Market Orderbook:         https://docs.kalshi.com/api-reference/market/get-market-orderbook
  - Get Trades (/markets/trades): https://docs.kalshi.com/api-reference/market/get-trades
  - Get Market Candlesticks:      https://docs.kalshi.com/api-reference/market/get-market-candlesticks
  - Rate limits:                  https://docs.kalshi.com/getting_started/rate_limits

Only the Python standard library is required for read-only use. `cryptography` is imported lazily
and only needed for authenticated (signed) requests.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PROD = "https://api.elections.kalshi.com/trade-api/v2"
PROD_PRIMARY = "https://external-api.kalshi.com/trade-api/v2"
DEMO = "https://external-api.demo.kalshi.co/trade-api/v2"
USER_AGENT = "trade1-dashboard/1.0 (+https://github.com/wingbangboozle1-lang/Trade1)"


class KalshiError(RuntimeError):
    def __init__(self, status: int | None, url: str, body: str):
        super().__init__(f"HTTP {status} for {url}: {body[:300]}")
        self.status = status
        self.url = url
        self.body = body


class KalshiClient:
    """Minimal client. `api_key_id` + `private_key_path` enable signed requests."""

    def __init__(
        self,
        base_url: str = PROD,
        api_key_id: str | None = None,
        private_key_path: str | None = None,
        max_retries: int = 3,
        timeout: int = 25,
        min_interval: float = 0.12,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key_id = api_key_id
        self.private_key_path = private_key_path
        self.max_retries = max_retries
        self.timeout = timeout
        self.min_interval = min_interval
        self._last_call = 0.0
        self._private_key = None
        self.calls = 0

    # ---------------------------------------------------------------- signing
    @property
    def signed(self) -> bool:
        return bool(self.api_key_id and self.private_key_path)

    def _load_key(self):
        if self._private_key is None:
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives import serialization

            with open(self.private_key_path, "rb") as f:
                self._private_key = serialization.load_pem_private_key(
                    f.read(), password=None, backend=default_backend()
                )
        return self._private_key

    def _auth_headers(self, method: str, path: str) -> dict:
        """Signature message is `timestamp + METHOD + path` with query stripped."""
        import datetime

        ts = str(int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000))
        sign_path = "/" + path.lstrip("/").split("?")[0]
        sign_path = urllib.parse.urlparse(self.base_url).path + sign_path
        message = f"{ts}{method}{sign_path}".encode()

        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        key = self._load_key()
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

            is_ed = isinstance(key, Ed25519PrivateKey)
        except ImportError:  # pragma: no cover
            is_ed = False

        if is_ed:
            sig = key.sign(message)
        else:
            sig = key.sign(
                message,
                padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
                hashes.SHA256(),
            )
        return {
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(sig).decode(),
        }

    # ---------------------------------------------------------------- request
    def request(self, path: str, params: dict | None = None, method: str = "GET"):
        query = ""
        if params:
            clean = {k: v for k, v in params.items() if v is not None and v != ""}
            if clean:
                query = "?" + urllib.parse.urlencode(clean, doseq=True)
        url = f"{self.base_url}{path}{query}"

        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if self.signed:
            headers.update(self._auth_headers(method, path))

        # Gentle client-side pacing: unauthenticated limits are undocumented in absolute terms,
        # documented policy is "back off on 429" (rate_limits.md). We keep well under 10 req/s.
        gap = time.time() - self._last_call
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)

        delay = 1.0
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(url, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    self.calls += 1
                    self._last_call = time.time()
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")
                self._last_call = time.time()
                if e.code == 429 or 500 <= e.code < 600:
                    if attempt < self.max_retries:
                        time.sleep(delay)
                        delay *= 2
                        continue
                raise KalshiError(e.code, url, body) from None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                self._last_call = time.time()
                if attempt < self.max_retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise KalshiError(None, url, repr(e)) from None
        raise KalshiError(None, url, "exhausted retries")

    def get(self, path: str, **params):
        return self.request(path, params)

    # ------------------------------------------------------------- paginated
    def paged(self, path: str, key: str, max_pages: int = 40, **params):
        """Yield items across cursor pages. Stops on empty cursor (documented behaviour)."""
        cursor = ""
        for _ in range(max_pages):
            data = self.get(path, cursor=cursor or None, **params)
            items = data.get(key) or []
            for it in items:
                yield it
            cursor = data.get("cursor") or ""
            if not cursor:
                return

    # -------------------------------------------------------------- endpoints
    def exchange_status(self):
        return self.get("/exchange/status")

    def series_list(self, category: str | None = None, max_pages: int = 20):
        return list(self.paged("/series", "series", max_pages=max_pages, category=category))

    def tags_by_categories(self) -> dict:
        return self.get("/search/tags_by_categories").get("tags_by_categories") or {}

    def events(self, status: str | None = None, series_ticker: str | None = None,
               with_nested_markets: bool = False, max_pages: int = 20):
        return list(self.paged("/events", "events", max_pages=max_pages, status=status,
                               series_ticker=series_ticker,
                               with_nested_markets="true" if with_nested_markets else None))

    def markets(self, status: str | None = None, event_ticker: str | None = None,
                series_ticker: str | None = None, max_pages: int = 20, **extra):
        """mve_filter=exclude keeps multivariate combos out of topic rankings."""
        return list(self.paged("/markets", "markets", max_pages=max_pages, status=status,
                               event_ticker=event_ticker, series_ticker=series_ticker,
                               mve_filter="exclude", **extra))

    def market(self, ticker: str):
        return self.get(f"/markets/{urllib.parse.quote(ticker)}").get("market") or {}

    def orderbook(self, ticker: str, depth: int = 10):
        """Returns {'yes': [[price, qty], ...], 'no': [...]} in dollars, best bid last."""
        data = self.get(f"/markets/{urllib.parse.quote(ticker)}/orderbook", depth=depth)
        ob = data.get("orderbook_fp") or data.get("orderbook") or {}
        out = {}
        for side in ("yes", "no"):
            levels = ob.get(f"{side}_dollars") or ob.get(side) or []
            out[side] = [[float(p), float(q)] for p, q in levels]
        return out

    def candlesticks(self, series_ticker: str, ticker: str, start_ts: int, end_ts: int,
                     period_interval: int = 60):
        """period_interval must be 1, 60 or 1440 (minutes) and span <= 5000 periods."""
        data = self.get(
            f"/series/{urllib.parse.quote(series_ticker)}/markets/{urllib.parse.quote(ticker)}/candlesticks",
            start_ts=start_ts, end_ts=end_ts, period_interval=period_interval,
        )
        return data.get("candlesticks") or []

    def candlestick_path(self, series_ticker: str, ticker: str) -> str:
        """Documented path, kept public so the UI can deep-link the same request."""
        return (f"/series/{urllib.parse.quote(series_ticker)}/markets/"
                f"{urllib.parse.quote(ticker)}/candlesticks")

    def trades(self, ticker: str | None = None, min_ts: int | None = None,
               max_ts: int | None = None, limit: int = 200):
        return self.get("/markets/trades", ticker=ticker, min_ts=min_ts, max_ts=max_ts,
                        limit=limit).get("trades") or []

    # ------------------------------------------------------------- portfolio
    def balance(self):
        return self.get("/portfolio/balance")

    def positions(self):
        return self.get("/portfolio/positions").get("market_positions") or []

    def orders(self, status: str | None = None):
        return self.get("/portfolio/orders", status=status).get("orders") or []

    def create_order(self, ticker: str, side: str, action: str, count: int, price_cents: int,
                     client_order_id: str | None = None, order_type: str = "limit"):
        body = {
            "ticker": ticker,
            "action": action,          # buy | sell
            "side": side,              # yes | no
            "type": order_type,
            "count": int(count),
        }
        if order_type == "limit":
            body["yes_price" if side == "yes" else "no_price"] = int(price_cents)
        if client_order_id:
            body["client_order_id"] = client_order_id
        data = json.dumps(body).encode()
        url = f"{self.base_url}/portfolio/orders"
        headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
        if self.signed:
            headers.update(self._auth_headers("POST", "/portfolio/orders"))
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode("utf-8"))


def demo_client_from_env() -> KalshiClient | None:
    """Build a signed demo client from env. Returns None when credentials are absent."""
    key_id = os.environ.get("KALSHI_DEMO_API_KEY_ID")
    key_path = os.environ.get("KALSHI_DEMO_PRIVATE_KEY_PATH")
    if not key_id or not key_path or not os.path.exists(key_path):
        return None
    return KalshiClient(DEMO, api_key_id=key_id, private_key_path=key_path)
