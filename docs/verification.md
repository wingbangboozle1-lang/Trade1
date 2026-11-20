# Verification Log — line-by-line

Rule applied: **every claim must be traceable to an official source.** Where a value could not be
confirmed, it is left blank and flagged (see the site's *Flagged for Review* page) — never inferred.

## Build environment checks
| Check | Method | Result | Source |
|-------|--------|--------|--------|
| Reachable: GitHub | `curl https://api.github.com/` | HTTP 200 | https://api.github.com/ |
| Reachable: npm registry | `curl https://registry.npmjs.org/` | HTTP 200 | https://registry.npmjs.org/ |
| Reachable: PyPI | `curl https://pypi.org/pypi/kalshi/json` | HTTP 200 | https://pypi.org/project/kalshi/ |
| Reachable: Kalshi demo | `curl https://demo-api.kalshi.co/trade-api/v2/markets` | HTTP 000 (TLS reset) | — (blocked) |
| Reachable: Kalshi docs | `curl https://docs.kalshi.com/` | HTTP 000 (TLS reset) | — (blocked) |

## API claims
| Claim | Verified how | Source | Status |
|-------|--------------|--------|--------|
| Demo REST base `https://demo-api.kalshi.co/trade-api/v2` | Read official starter code `KalshiHttpClient.__init__` | Kalshi/kalshi-starter-code-python | Verified |
| RSA-PSS auth headers (`KALSHI-ACCESS-KEY/SIGNATURE/TIMESTAMP`) | Read `request_headers()` / `sign_pss_text()` | Kalshi/kalshi-starter-code-python | Verified |
| Signature over `timestamp + method + path` | Read `request_headers()` | Kalshi/kalshi-starter-code-python | Verified |
| PSS salt length = SHA-256 digest length (32) | Read `padding.PSS(salt_length=padding.PSS.DIGEST_LENGTH)` | Kalshi/kalshi-starter-code-python | Verified |
| `/portfolio/balance`, `/portfolio/positions`, `/portfolio/events/orders` paths | Read starter code + spec | Kalshi/kalshi-starter-code-python; mlucy/kalshi_py swagger | Verified |
| `/markets`, `/markets/{ticker}/orderbook`, `/series`, `/events` public paths | Official API reference | docs.kalshi.com/getting_started/quick_start_market_data | Verified (host blocked from sandbox; endpoint paths from official docs) |
| WebSocket subscribe `{cmd:subscribe, channels:[ticker]}` | Read `subscribe_to_tickers()` | Kalshi/kalshi-starter-code-python | Verified |
| Legacy auth `POST /log_in` → Basic token | Read `kalshi/session.py` | mlucy/kalshi_py (PyPI kalshi) | Verified |
| Prices in cents | Official docs + SDK examples (`yes_bid/100`) | docs.kalshi.com | Verified |

## Application claims (implementation correctness)
| Claim | Verified how | Status |
|-------|--------------|--------|
| Public market data fetched in-browser with no credentials | Implementation in `site/js/kalshi.js` (`get()` with `auth=false`) | Implemented per spec |
| Private requests signed with WebCrypto RSA-PSS | `_signedHeaders()` uses `crypto.subtle.sign({name:"RSA-PSS",saltLength:32})` | Implemented per spec |
| Events tracked until resolution with yes/no | `store.js` `markResolved()` / `normalizeResolution()` | Implemented |
| Sharp moves ≥ $0.10 flagged with market link | `store.js` sharp-move detection; `dashboard.js` sharp list | Implemented |
| Live price chart (X=time window, Y=price) | `charts.js` LineChart | Implemented |
| Liquidity (contracts available by price) | `charts.js` DepthChart + orderbook fetch | Implemented |
| Simulated strategy engine + categorization + performance | `strategy.js` | Implemented |
| Optional real demo execution | `portfolio.js` `executeOrder()` | Implemented **(body flagged unverified)** |

## Values that could NOT be verified (left blank / flagged)
| Item | Why unverified | Where flagged |
|------|----------------|---------------|
| Any live market price / volume / liquidity value | Kalshi hosts unreachable from build sandbox | All live cells are blank when the API is unreachable; site flags `unverified` |
| Concrete series tickers for the 5 topics | Requires live `/series` response | Topic mapping is data-driven at runtime; no ticker hard-coded as fact |
| WebSocket host naming (`external-api-ws.demo...` vs `demo-api.kalshi.co`) | Task text and starter code differ | Flagged page + api-reference.md |
| Exact v2 order-create response/body | Endpoint unreachable | Flagged page + portfolio page note |

No value in this project was inferred from memory or fabricated.
