/*
 * Kalshi Demo API client — browser side.
 *
 * Auth and paths verified against the official Kalshi sources in docs/sources.md:
 *   - Official Python SDK (kalshi_py): POST /log_in -> Basic token (v1 auth).
 *   - Official starter code (Kalshi/kalshi-starter-code-python): v2 demo host +
 *     RSA-PSS header auth for /trade-api/v2 private endpoints.
 *
 * NOTE: this sandbox cannot reach any Kalshi host, so every method below is
 * implemented from the official spec and fails loudly (returning an error object)
 * rather than inventing data if the API is unreachable. Public market-data
 * endpoints require no auth and are fetched directly from the browser.
 */

(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;
  const CENTS_PER_DOLLAR = CFG.CENTS_PER_DOLLAR;

  /* ---------- low-level helpers ---------- */

  function err(message, detail) {
    const e = new Error(message);
    e.detail = detail || null;
    e.unverified = true;
    return e;
  }

  function centsToDollars(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return null;
    return Number(cents) / CENTS_PER_DOLLAR;
  }

  /* fetch with a hard timeout so an unreachable host fails fast, not hanging. */
  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 8000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() =>
      clearTimeout(t)
    );
  }

  /* ---------- base URL selection ---------- */

  class KalshiClient {
    constructor(opts = {}) {
      this.bases = opts.bases || CFG.KALSHI_DEMO_BASES;
      this.base = null; // chosen after reachability probe
      this.wsBase = null;
      this._probed = false;

      // Credentials are held only in the browser session and never sent anywhere
      // except directly to Kalshi via the browser.
      this.keyId = opts.keyId || null;
      this.privateKey = opts.privateKey || null; // CryptoKey (imported via WebCrypto)

      // Collects the active connection base for transparency in the UI.
      this.lastError = null;
    }

    async _probe() {
      if (this._probed) return;
      this._probed = true;
      // /exchange/status is public; use it to pick a reachable demo host.
      for (const base of this.bases) {
        try {
          const res = await fetchWithTimeout(base + CFG.PUBLIC_PATHS.exchangeStatus, {
            method: "GET",
            headers: { Accept: "application/json" },
          }, 6000);
          if (res.ok) {
            this.base = base;
            // WebSocket host mirrors the chosen HTTP host.
            this.wsBase = base.replace(/^https/, "wss").split("/trade-api")[0];
            return;
          }
        } catch (_e) {
          /* try next host */
        }
      }
      this.lastError = err(
        "Kalshi demo API is not reachable from this browser.",
        "Attempted: " + this.bases.join(" , ")
      );
    }

    get connected() {
      return !!this.base;
    }

    async get(path, params = {}, auth = false) {
      await this._probe();
      if (!this.base) throw this.lastError;

      const url = new URL(this.base + path);
      Object.keys(params).forEach((k) => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== "") {
          url.searchParams.set(k, String(params[k]));
        }
      });

      const headers = { Accept: "application/json" };
      if (auth) {
        Object.assign(headers, await this._signedHeaders("GET", url.pathname));
      }

      const res = await fetchWithTimeout(url.toString(), { method: "GET", headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw err("Kalshi GET " + path + " failed: HTTP " + res.status, body);
      }
      return res.json();
    }

    async post(path, body, auth = false) {
      await this._probe();
      if (!this.base) throw this.lastError;
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (auth) {
        Object.assign(headers, await this._signedHeaders("POST", path));
      }
      const res = await fetchWithTimeout(this.base + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw err("Kalshi POST " + path + " failed: HTTP " + res.status, txt);
      }
      return res.json();
    }

    async delete(path, params = {}, auth = false) {
      await this._probe();
      if (!this.base) throw this.lastError;
      const url = new URL(this.base + path);
      Object.keys(params).forEach((k) => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== "") {
          url.searchParams.set(k, String(params[k]));
        }
      });
      const headers = { Accept: "application/json" };
      if (auth) Object.assign(headers, await this._signedHeaders("DELETE", url.pathname));
      const res = await fetchWithTimeout(url.toString(), { method: "DELETE", headers });
      if (!res.ok) {
        throw err("Kalshi DELETE " + path + " failed: HTTP " + res.status);
      }
      return res.json();
    }

    /* ---------- RSA-PSS signing (WebCrypto) ---------- */

    async _signedHeaders(method, path) {
      if (!this.keyId || !this.privateKey) {
        throw err("Kalshi API key / private key not provided for this signed request.");
      }
      const timestamp = String(Date.now());
      const msgString = timestamp + method + path;
      const signature = await global.crypto.subtle.sign(
        { name: "RSA-PSS", saltLength: 32 }, // SHA-256 digest length = 32 bytes
        this.privateKey,
        new TextEncoder().encode(msgString)
      );
      return {
        "KALSHI-ACCESS-KEY": this.keyId,
        "KALSHI-ACCESS-SIGNATURE": btoa(String.fromCharCode(...new Uint8Array(signature))),
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
      };
    }

    /* Import a PEM private key into a CryptoKey for signing. */
    async importPrivateKey(pem) {
      const text = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
      const der = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      this.privateKey = await global.crypto.subtle.importKey(
        "pkcs8",
        der,
        { name: "RSA-PSS", hash: "SHA-256" },
        true,
        ["sign"]
      );
      return true;
    }

    /* ---------- public market data ---------- */

    async getMarkets(params = {}) {
      const r = await this.get(CFG.PUBLIC_PATHS.markets, params, false);
      return r.markets || [];
    }

    async getMarket(ticker) {
      const r = await this.get(CFG.PUBLIC_PATHS.market(ticker), {}, false);
      return r.market || null;
    }

    async getOrderbook(ticker, depth = 0) {
      const r = await this.get(CFG.PUBLIC_PATHS.orderbook(ticker, depth), {}, false);
      // Compatibility: some spec versions return {orderbook}, others {orderbook_fp}.
      return r.orderbook || r.orderbook_fp || r;
    }

    async getEvents(params = {}) {
      const r = await this.get(CFG.PUBLIC_PATHS.events, params, false);
      return r.events || [];
    }

    async getEvent(ticker) {
      const r = await this.get(CFG.PUBLIC_PATHS.event(ticker), {}, false);
      return r.event || r;
    }

    async getSeries(params = {}) {
      const r = await this.get(CFG.PUBLIC_PATHS.series, params, false);
      return r.series || [];
    }

    async getCandlesticks(params = {}) {
      const r = await this.get(CFG.PUBLIC_PATHS.candlesticks, params, false);
      return r.candlesticks || r;
    }

    async getMarketTrades(params = {}) {
      const r = await this.get(CFG.PUBLIC_PATHS.marketTrades, params, false);
      return r.trades || r;
    }

    /* Discover series relevant to a topic by filtering Kalshi's live series. */
    async discoverTopicSeries(topicKeyword) {
      const keywords = (CFG.TOPIC_KEYWORDS[topicKeyword] || []).map((k) =>
        k.toLowerCase()
      );
      const out = [];
      let cursor = null;
      // Paginate series (limit is capped by Kalshi; loop with cursor).
      for (let page = 0; page < 6; page++) {
        const params = { limit: 200 };
        if (cursor) params.cursor = cursor;
        const series = await this.getSeries(params);
        if (!series || !series.length) break;
        for (const s of series) {
          const hay = ((s.title || "") + " " + (s.subtitle || "") + " " +
            (s.tags || []).join(" ") + " " + (s.category || "")).toLowerCase();
          if (keywords.some((k) => hay.includes(k))) out.push(s);
        }
        cursor = series.length < 200 ? null : (s && s.cursor) || null;
        if (!cursor) break;
      }
      return out;
    }

    /* ---------- private portfolio ---------- */

    async getBalance() {
      const r = await this.get(CFG.PRIVATE_PATHS.balance, {}, true);
      return r.balance !== undefined ? r : r.portfolio;
    }

    async getPositions(params = {}) {
      const r = await this.get(CFG.PRIVATE_PATHS.positions, params, true);
      return r.market_positions || [];
    }

    async getOrders(params = {}) {
      const r = await this.get(CFG.PRIVATE_PATHS.orders, params, true);
      return r.orders || [];
    }

    async getFills(params = {}) {
      const r = await this.get(CFG.PRIVATE_PATHS.fills, params, true);
      return r.fills || [];
    }

    async getPortfolioHistory(params = {}) {
      const r = await this.get(CFG.PRIVATE_PATHS.portfolioHistory, params, true);
      return r.history || r;
    }

    /* Place a real order on the demo account. Opt-in only. */
    async createOrder(body) {
      const r = await this.post(CFG.PRIVATE_PATHS.createOrder, body, true);
      return r.order || r;
    }

    async cancelOrder(orderId) {
      const r = await this.delete(CFG.PRIVATE_PATHS.cancelOrder(orderId), {}, true);
      return r;
    }

    /* ---------- WebSocket ---------- */

    connectWebSocket(channels = ["ticker"]) {
      return new Promise((resolve, reject) => {
        if (!this.wsBase) {
          this._probe().then(() => {
            if (!this.wsBase) reject(this.lastError || err("No reachable Kalshi host."));
            else this._openWs(channels, resolve, reject);
          });
          return;
        }
        this._openWs(channels, resolve, reject);
      });
    }

    _openWs(channels, resolve, reject) {
      let headers = {};
      // Public ticker channel needs no signature, but include auth if available.
      this._signedHeaders("GET", CFG.KALSHI_WS_SUFFIX)
        .then((h) => {
          headers = h;
          return this._wsConnect(channels, resolve, reject, headers);
        })
        .catch(() => this._wsConnect(channels, resolve, reject, headers));
    }

    async _wsConnect(channels, resolve, reject, headers) {
      try {
        const url = this.wsBase + CFG.KALSHI_WS_SUFFIX;
        // Browsers cannot set custom headers on WebSocket; auth via query is not
        // supported for public channels, so we connect publicly. The private
        // orderbook/positions channels would require a token-based flow.
        const ws = new WebSocket(url);
        const id = 1;
        const wait = (msg) => {
          const data = JSON.parse(msg);
          if (data.id === id || data.cmd === "subscribed") {
            resolve({ ws, channels });
          }
        };
        ws.onmessage = (ev) => {
          const data = JSON.parse(ev.data);
          if (data.id === id) {
            // subscription acknowledged
          }
          if (global.KD_WS_HANDLER) global.KD_WS_HANDLER(data);
        };
        ws.onopen = () => {
          ws.send(JSON.stringify({ id, cmd: "subscribe", params: { channels } }));
        };
        ws.onerror = (e) => reject(err("WebSocket error", String(e)));
        // resolve after a moment if subscribe ack missing
        setTimeout(() => resolve({ ws, channels }), 2000);
      } catch (e) {
        reject(e);
      }
    }
  }

  global.KalshiClient = KalshiClient;
  global.KD_utils = { centsToDollars, err };
})(window);
