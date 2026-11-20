/* Trade1 — kalshi.js — public demo REST client (no auth endpoints only).
 * Verified against official docs (see docs/API_NOTES.md). Cursor pagination follows
 * https://docs.kalshi.com/getting_started/pagination.md (empty cursor = last page).
 */
"use strict";

(function () {
  const state = {
    minGapMs: 220,          // conservative pacing between public requests
    lastCall: 0,
    backoffUntil: 0,        // set on HTTP 429 (exponential)
    backoffLevel: 0,
    statusListeners: [],
    lastStatus: { ok: null, ts: 0, msg: "" },
  };

  function notify(ok, msg) {
    state.lastStatus = { ok, ts: Date.now(), msg };
    state.statusListeners.forEach((fn) => { try { fn(state.lastStatus); } catch (e) {} });
  }

  async function pace() {
    const now = Date.now();
    if (now < state.backoffUntil) {
      await new Promise((r) => setTimeout(r, state.backoffUntil - now));
    }
    const gap = state.minGapMs - (Date.now() - state.lastCall);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    state.lastCall = Date.now();
  }

  function backoff(err) {
    state.backoffLevel = Math.min(state.backoffLevel + 1, 6);
    state.backoffUntil = Date.now() + Math.min(500 * 2 ** state.backoffLevel, 60000);
    notify(false, "Rate limited / error — backing off " + Math.round((state.backoffUntil - Date.now()) / 1000) + "s");
  }

  // GET with query params; throws Error with .status on HTTP error.
  async function get(path, params) {
    await pace();
    const qs = params
      ? "?" + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
      : "";
    const url = T1.API_BASE + path + qs;
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      backoff(e);
      const err = new Error("Network/CORS failure reaching Kalshi demo API. This browser may be blocking the request. Direct check: " + url);
      err.cause = e; err.url = url; err.kind = "network";
      notify(false, "Fetch failed — see banner");
      throw err;
    }
    if (res.status === 429) { backoff(); const e = new Error("HTTP 429 (rate limited)"); e.status = 429; e.url = url; throw e; }
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status} from ${path}`);
      e.status = res.status; e.url = url;
      notify(false, "API error " + res.status);
      throw e;
    }
    state.backoffLevel = 0; state.backoffUntil = 0;
    notify(true, "Live");
    return res.json();
  }

  async function getPaginated(path, params, maxPages, itemKey) {
    const out = [];
    let cursor = "";
    for (let i = 0; i < (maxPages || 1); i++) {
      const data = await get(path, Object.assign({}, params, cursor ? { cursor } : {}));
      (data[itemKey] || []).forEach((x) => out.push(x));
      cursor = data.cursor || "";
      if (!cursor) break;
    }
    return out;
  }

  // ---------- Public endpoint wrappers (all no-auth per official Quick Start: Market Data) ----------
  const api = {
    onStatus(fn) { state.statusListeners.push(fn); },
    status() { return state.lastStatus; },

    // GET /series?category=&tags= — official Get Series List (category matches any entry, case-sensitive)
    getSeriesList(category) {
      return get("/series", { category }).then((d) => d.series || []);
    },
    // GET /series/{ticker}
    getSeries(ticker) {
      return get(`/series/${encodeURIComponent(ticker)}`, null).then((d) => d.series);
    },
    // GET /events?status=open&limit=&cursor= — event objects incl. category + settlement_sources
    getEvents(maxPages) {
      return getPaginated("/events", { status: "open", limit: 200 }, maxPages || T1.LIMITS.eventPages, "events");
    },
    // GET /markets?series_ticker=&status=open — sorted newest first, cached briefly (docs)
    getMarketsBySeries(seriesTicker, maxPages) {
      return getPaginated("/markets", { series_ticker: seriesTicker, status: "open", limit: 200 }, maxPages || 2, "markets");
    },
    // GET /markets?event_ticker=&status=open
    getMarketsByEvent(eventTicker) {
      return get("/markets", { event_ticker: eventTicker, status: "open", limit: 200 }).then((d) => d.markets || []);
    },
    // GET /markets?tickers=a,b,c — when tickers is the only filter, all matches in ONE response (docs)
    getMarketsByTickers(tickers) {
      return get("/markets", { tickers: tickers.join(",") }).then((d) => d.markets || []);
    },
    // GET /markets/{ticker}
    getMarket(ticker) {
      return get(`/markets/${encodeURIComponent(ticker)}`, null).then((d) => d.market);
    },
    // GET /markets/{ticker}/orderbook — [price_dollars, count_fp] ascending, best bid last
    getOrderbook(ticker) {
      return get(`/markets/${encodeURIComponent(ticker)}/orderbook`, null).then((d) => d.orderbook_fp || { yes_dollars: [], no_dollars: [] });
    },
    // GET /markets/trades?ticker=&limit=&min_ts=&max_ts=
    getTrades(ticker, limit, minTs) {
      return get("/markets/trades", { ticker, limit: limit || 100, min_ts: minTs }).then((d) => d.trades || []);
    },
    // GET /series/{series}/markets/{ticker}/candlesticks — period_interval ∈ {1,60,1440}; ts in SECONDS
    getCandles(seriesTicker, ticker, startTs, endTs, periodInterval) {
      return get(`/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
        { start_ts: Math.floor(startTs), end_ts: Math.floor(endTs), period_interval: periodInterval })
        .then((d) => d.candlesticks || []);
    },

    // ---- helpers ----
    async fetchSeriesMeta(tickers, cacheTtlMs) {
      const meta = {};
      const ttl = cacheTtlMs || 6 * 3600 * 1000;
      const cached = Store.getCache("seriesMeta", ttl, {});
      for (const t of tickers) {
        if (cached[t]) { meta[t] = cached[t]; continue; }
        try {
          const s = await api.getSeries(t);
          if (s) { cached[t] = s; meta[t] = s; }
        } catch (e) { /* leave missing — flagged as unavailable, never inferred */ }
      }
      Store.setCache("seriesMeta", cached);
      return meta;
    },
  };

  window.KalshiAPI = api;
})();
