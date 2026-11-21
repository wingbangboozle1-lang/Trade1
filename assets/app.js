/* Trade1 — live dashboard engine for the Kalshi demo Trade API.
 *
 * Data sources (all public, no credentials):
 *   REST  https://external-api.demo.kalshi.co/trade-api/v2   (recommended demo host)
 *   REST  https://demo-api.kalshi.co/trade-api/v2            (also supported; fallback)
 *   Fallback snapshots: data/ (collected + verified by GitHub Actions,
 *   see scripts/collect.py and data/log.md)
 *
 * Verified behaviors this engine relies on (see data/log.md + flagged.html):
 *   - CORS: demo hosts reflect any Origin (probed 2026-11-20, data/cors.json)
 *   - GET /markets?tickers=a,b,... returns every matching market (any status)
 *     in one response with empty cursor — used for cheap watchlist polling and
 *     free settlement detection (status finalized + result yes/no).
 *   - GET /events?status=open&limit=200 works (limit=1000 is rejected with 400)
 *   - GET /markets?event_ticker=X returns all member markets in one response
 *   - GET /markets/{ticker}/orderbook -> orderbook_fp.{yes_dollars,no_dollars}
 *     = [price_dollars, count_fp] ascending; best bid LAST; bids only (asks
 *     derived via 1 - price, per official docs)
 *   - GET /series/{series}/markets/{ticker}/candlesticks (period_interval 1|60)
 *   - Prices are *_dollars fixed-point strings; quantities *_fp strings.
 *
 * The WebSocket API is NOT used: per official docs the WS handshake requires
 * signed auth headers, which browsers cannot attach to a WebSocket — so this
 * dashboard polls REST (documented cache lag: several seconds). Flagged.
 */
window.KalshiApp = (function () {
  'use strict';
  var M = window.KalshiModel;

  var CFG = {
    bases: ['https://external-api.demo.kalshi.co/trade-api/v2',
            'https://demo-api.kalshi.co/trade-api/v2'],
    baseIdx: 0,
    eventsLimit: 200, eventsMaxPages: 8,
    watchPollMs: 12000,          // watchlist price polling
    discoveryMs: 6 * 60000,      // open-events discovery sweep
    bookPollMs: 8000,            // orderbook for selected market
    bookDepth: 10,               // official ?depth= price levels per side (1-100)
    candleMs: 60000,             // candlestick refresh for visible chart
    eventQueuePerCycle: 24,      // event->markets fetches per discovery cycle
    maxWatch: 400,
    alertThreshold: 0.10,        // >= $0.10 either direction (integer-cent compare, see checkAlert)
    alertCooldownMs: 45000,      // per-market cooldown so oscillation does not spam the chats
    chunk: 200                   // tickers per batched request
  };

  /* ---------- tiny helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }
  function money(v) {
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '';
    return '$' + Number(v).toFixed(2);
  }
  function cents(v) {
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '';
    return Math.round(Number(v) * 100) + '\u00a2';
  }
  function fmtN(v) {
    var n = Number(v);
    if (v === null || v === undefined || v === '' || !isFinite(n)) return '';
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function fmtK(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return fmtN(n);
  }
  function hhmmss(t) { return new Date(t).toLocaleTimeString(); }

  /* Kalshi UI link. Verified 2026-11-20: the market-page pattern is
   * https://kalshi.com/markets/{series_ticker} (lower-case), as shown in the
   * official Quick Start guide
   * (https://docs.kalshi.com/getting_started/quick_start_market_data ->
   *  "https://kalshi.com/markets/kxhighny"). Fetching
   * https://kalshi.com/markets/{event_ticker} does NOT resolve to a market page,
   * so we never build links from a bare event ticker. The series ticker comes
   * from the event object we already hold (official /events field
   * `series_ticker`); if it is missing we fall back to the ticker prefix, which
   * is the series for every ticker shape observed on the demo API.
   */
  function seriesOf(ev) {
    var e = ev ? S.events[ev] : null;
    if (e && e.series_ticker) return String(e.series_ticker);
    return String(ev || '').split('-')[0];
  }
  function kalshiUrl(ev) {
    var s = seriesOf(ev);
    return s ? 'https://kalshi.com/markets/' + encodeURIComponent(s.toLowerCase()) : '';
  }
  /* Official API URL for the exact event (verification link, per-row source). */
  function apiEventUrl(ev) {
    return CFG.bases[0] + '/events/' + encodeURIComponent(String(ev || ''));
  }
  function apiMarketUrl(ticker) {
    return CFG.bases[0] + '/markets/' + encodeURIComponent(String(ticker || ''));
  }
  function newsUrl(title) { return 'https://news.google.com/search?q=' + encodeURIComponent(title) + '&hl=en-US'; }

  /* root prefix so data/ fetches work from subpages (topics/*.html) */
  var ROOT = (function () {
    var t = document.querySelector('script[src$="app.js"]');
    return t ? t.getAttribute('src').replace(/assets\/app\.js.*$/, '') : '';
  })();

  /* ---------- state ---------- */
  var S = {
    mode: 'boot',            // boot | live | snapshot | error
    modeNote: '',
    events: {},              // event_ticker -> event (in scope)
    watch: {},               // ticker -> market (latest official fields + _topic)
    list: [],                // watch tickers in insertion order
    history: {},             // ticker -> [{t,last,bid,ask}] session samples (memory only)
    selected: null,
    book: null,              // last orderbook for selected
    trades: [],              // official trade tape for selected (seconds windows)
    tradesTruncated: false,
    lastTradeFetch: 0,
    chartSource: '',
    candles: null,           // [{t,p}] merged candle+sample series for current window
    window: '60m',
    topic: '',               // '' = all topics
    newAlerts: [],
    lastError: '',
    eventQueue: [],          // event tickers needing market fetch
    evFetchCursor: 0,
    lastDiscovery: 0,
    degraded: false,
    lastCandleFetch: 0,
    timer: null
  };

  /* ---------- API client ---------- */
  function api(path, params, cb, retries) {
    retries = retries || 0;
    var base = CFG.bases[CFG.baseIdx];
    var qs = params ? ('?' + Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&')) : '';
    var url = base + path + qs;
    fetch(url, { cache: 'no-store' }).then(function (r) {
      if (r.status === 429 && retries < 3) {       // documented: back off on 429
        setTimeout(function () { api(path, params, cb, retries + 1); }, 1500 * (retries + 1) * 2);
        return null;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j) { if (CFG.baseIdx !== 0) { CFG.baseIdx = 0; } cb(null, j, url); }
    }).catch(function (e) {
      // try the alternate demo host once, then report
      if (retries === 0 && CFG.bases.length > 1) {
        CFG.baseIdx = 1;
        api(path, params, cb, 1);
      } else {
        CFG.baseIdx = 0;
        cb(e, null, url);
      }
    });
  }

  /* ---------- local snapshot fallback ---------- */
  function loadSnapshot(cb) {
    var ids = M.TOPICS.map(function (t) { return t.id; });
    var left = ids.length, any = false;
    S.watch = {}; S.list = []; S.events = {};
    ids.forEach(function (id) {
      fetch(ROOT + 'data/topics/' + id + '.json', { cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }).then(function (j) {
        if (j && j.events) {
          any = true;
          j.events.forEach(function (ev) {
            S.events[ev.event_ticker] = ev;
            (ev._markets || []).forEach(function (m) {
              m._topic = id;
              if (!S.watch[m.ticker]) { S.watch[m.ticker] = m; S.list.push(m.ticker); }
            });
          });
        }
        if (--left === 0) cb(any);
      });
    });
  }

  /* ---------- discovery: open events -> in-scope events -> their markets ---------- */
  /* Per-series taker multiplier cache. The demo API publishes fee_multiplier on
   * every Series record (official Get Series schema) — the app already fetches
   * full Series objects in discoverSeries(), so ingesting them here costs no
   * extra request. For series only seen through the /events path, fetch the
   * record once (deduped, capped) and cache it the same way. Unknown series
   * keep the schedule's documented default M=1 (see assets/model.js fee()). */
  var seriesFeeAsked = {};
  function ensureSeriesFee(st) {
    if (!st || S.mode === 'snapshot') return;
    var key = String(st).toUpperCase();
    if (M.state.seriesFees[key] || seriesFeeAsked[key]) return;
    if (Object.keys(seriesFeeAsked).length >= 60) return; // request-volume guard
    seriesFeeAsked[key] = 1;
    api('/series/' + encodeURIComponent(st), null, function (err, j, url) {
      if (!err && j && j.series) M.noteSeriesFee(j.series, url || undefined);
    });
  }

  function discover() {
    if (!navigator.onLine || S.mode === 'snapshot') return;
    var all = [], page = 0;
    (function nextPage(cursor) {
      var params = { status: 'open', limit: String(CFG.eventsLimit) };
      if (cursor) params.cursor = cursor;
      api('/events', params, function (err, j) {
        if (err) { S.lastError = String(err.message || err); maybeLive(); return; }
        page++;
        all = all.concat(j.events || []);
        if (j.cursor && page < CFG.eventsMaxPages) return nextPage(j.cursor);
        var scope = [];
        all.forEach(function (ev) {
          /* Mirror scripts/collect.py classify(): the collector matches
           * title_keywords against "title + ' ' + sub_title". */
          var t = M.classify(ev.category, (ev.title || '') + ' ' + (ev.sub_title || ''), ev.series_ticker);
          if (t) { ev._topic = t; S.events[ev.event_ticker] = ev; scope.push(ev.event_ticker); }
        });
        scope.forEach(function (et) {
          if (S.eventQueue.indexOf(et) === -1) S.eventQueue.push(et);
        });
        S.lastDiscovery = Date.now();
        fetchQueuedEvents(0);
        discoverSeries();
        maybeLive();
      });
    })('');
  }

  /* Series discovery: GET /series?category=X&include_volume=true is the
   * authoritative listing (verified live). Filtered per-topic by series/title
   * regexes, then each series' open markets are pulled. This covers fast
   * cycling series (hourly crypto, daily AAA gas) that /events paging misses. */
  function discoverSeries() {
    if (S.mode === 'snapshot') return;
    M.TOPICS.forEach(function (t) {
      var seen = {}, srs = [], left = t.categories.length;
      if (!t.categories.length) return;
      t.categories.forEach(function (cat) {
        api('/series', { category: cat, include_volume: 'true', limit: '200' }, function (err, j) {
          if (!err && j && j.series) {
            j.series.forEach(function (sr) {
              if (!sr.ticker || seen[sr.ticker]) return;
              /* Official Series records carry fee_multiplier/fee_type (Get
               * Series schema) — cache them for the paper broker's fee math. */
              M.noteSeriesFee(sr, CFG.bases[0] + '/series/' + encodeURIComponent(sr.ticker));
              var title = sr.title || '';
              var hay = title + ' ' + sr.ticker;
              // Mirror scripts/topics.json exclude_categories (e.g. golf-club
              // markets filed under Politics must not enter the Golf topic).
              var srCats = [sr.category].concat(sr.categories || []);
              if (t.exclCats && srCats.some(function (c) { return t.exclCats.indexOf(c) !== -1; })) return;
              if (t.exclRe && new RegExp(t.exclRe, 'i').test(hay)) return;
              if (t.titleRe && !(new RegExp(t.titleRe, 'i').test(title) ||
                                 new RegExp(t.seriesRe || '\\x00', 'i').test(sr.ticker))) return;
              seen[sr.ticker] = sr; srs.push(sr);
            });
          }
          if (--left === 0) {
            srs.sort(function (a, b) { return (Number(b.volume_fp) || 0) - (Number(a.volume_fp) || 0); });
            srs.slice(0, 12).forEach(function (sr) {
              api('/markets', { series_ticker: sr.ticker, status: 'open', limit: '1000' }, function (err2, j2) {
                if (err2 || !j2 || !j2.markets) return;
                j2.markets.forEach(function (m) {
                  if (!m.ticker) return;
                  var et = m.event_ticker;
                  if (!S.events[et]) {
                    S.events[et] = { event_ticker: et, title: m.title, series_ticker: sr.ticker,
                                     settlement_sources: sr.settlement_sources || [], _topic: t.id };
                  } else {
                    /* The /events call runs in parallel with this series sweep and
                     * usually wins, so the event usually already exists. Fill in
                     * only the fields that response did not carry — an earlier
                     * revision wrote the first one and dropped this series'
                     * settlement_sources, which are the links the alert chats and
                     * the source list show (official Get Series schema). */
                    var known = S.events[et];
                    if (!known.series_ticker) known.series_ticker = sr.ticker;
                    if (!known.title) known.title = m.title;
                    if ((!known.settlement_sources || !known.settlement_sources.length) && sr.settlement_sources) {
                      known.settlement_sources = sr.settlement_sources;
                    }
                  }
                  m._topic = t.id;
                  m._series = sr.ticker;
                  if (!S.watch[m.ticker]) { S.watch[m.ticker] = m; S.list.push(m.ticker); }
                  else S.watch[m.ticker] = Object.assign(S.watch[m.ticker], m);
                });
                trimWatch();
              });
            });
          }
        });
      });
    });
  }
  function fetchQueuedEvents(depth) {
    if (S.mode === 'snapshot') return;
    var batch = S.eventQueue.splice(0, CFG.eventQueuePerCycle - depth);
    var done = 0;
    if (!batch.length) return;
    batch.forEach(function (et) {
      api('/markets', { event_ticker: et }, function (err, j) {
        if (!err && j && j.markets) {
          j.markets.forEach(function (m) {
            if (!m.ticker) return;
            var ev = S.events[m.event_ticker];
            m._topic = ev ? ev._topic : (M.classify(ev && ev.category, m.title, ev && ev.series_ticker) || m._topic || null);
            if (ev && ev.series_ticker) {
              m._series = ev.series_ticker;
              ensureSeriesFee(ev.series_ticker); // cache fee_multiplier for the broker
            }
            if (!S.watch[m.ticker]) { S.watch[m.ticker] = m; S.list.push(m.ticker); }
            else S.watch[m.ticker] = Object.assign(S.watch[m.ticker], m);
          });
        }
        done++;
        if (done === batch.length) {
          // first paint must not wait for the next 12 s poll: render as soon as
          // the first batch of markets is in memory, and start price polling.
          trimWatch();
          renderTable(); renderKPIs();
          if (!S.pollStarted) { S.pollStarted = true; pollWatch(); }
          if (S.eventQueue.length && depth + batch.length < CFG.eventQueuePerCycle) {
            fetchQueuedEvents(depth + batch.length);
          }
        }
      });
    });
  }
  function trimWatch() {
    if (S.list.length <= CFG.maxWatch) return;
    // Prefer keeping markets that carry activity; drop the rest oldest-first.
    S.list = S.list.filter(function (t) {
      var m = S.watch[t];
      if (!m) return false;
      return (Number(m.volume_fp || 0) > 0 || Number(m.volume_24h_fp || 0) > 0) || S.list.indexOf(t) < 200;
    }).slice(0, CFG.maxWatch);
    var keep = {}; S.list.forEach(function (t) { keep[t] = S.watch[t]; });
    S.watch = keep;
  }

  /* ---------- watchlist polling (batched, also detects settlements) ---------- */
  /* Poll the WHOLE watchlist. The watchlist holds up to CFG.maxWatch (400) markets and
     a request carries at most CFG.chunk (200) tickers, so the list is sent in chunks -
     one request per chunk. Polling only the first chunk (an earlier revision) left
     every market past the 200th ticker frozen on its first-seen price: no alerts,
     no settlement detection, stale rows in the table. */
  function pollWatch() {
    if (S.mode === 'snapshot') return;
    var tickers = S.list.slice(0, CFG.maxWatch);
    if (!tickers.length) return;
    var chunks = [];
    for (var i = 0; i < tickers.length; i += CFG.chunk) chunks.push(tickers.slice(i, i + CFG.chunk));
    var pending = chunks.length, failed = 0;
    chunks.forEach(function (slice) {
      api('/markets', { tickers: slice.join(',') }, function (err, j) {
        if (err) { failed++; S.lastError = String(err.message || err); }
        else handleMarketBatch(j);
        if (--pending === 0) { if (failed) degrade(); else maybeLive(); }
      });
    });
  }
  function handleMarketBatch(j) {
    if (S.degraded) { S.degraded = false; S.modeNote = ''; maybeLive(); }
    var now = Date.now();
    var fresh = (j && j.markets) || [];
    var resolvedNow = {};
    fresh.forEach(function (m) {
      if (!m.ticker || !S.watch[m.ticker]) return;
      var prev = S.watch[m.ticker];
      var merged = Object.assign({}, prev, m);
      merged._topic = prev._topic;
      merged._series = prev._series || m.series_ticker;
      S.watch[m.ticker] = merged;

      var st = String(m.status || '');
      /* A market is only traded (sampled, alertable) while the official
       * lifecycle says it is open: status `active` AND close_time still in the
       * future — "active -> closed: when close_time passes" (implicit, no
       * WebSocket event). The close_time test matters because snapshot rows are
       * trimmed at collection time: they can still read status `active` long
       * after they closed. */
      var tradeable = M.isTradeable(merged, now);
      /* "No longer open for trading", per the official lifecycle table
       * (https://docs.kalshi.com/getting_started/market_lifecycle):
       * `inactive` = paused, `closed` = past close_time and awaiting
       * determination, and determined/disputed/amended/finalized = the
       * determination and settlement stages. Only `active` and `initialized`
       * are still on the trading side of that table.
       * A market that has left the trading side must stop producing price
       * samples. An earlier revision only filtered settled markets here, so a
       * market that simply CLOSED kept its last quote and fed the poll sampler:
       * a quote going to 0.00 after close looked like a -$0.10 swing alert,
       * `M.manage()` could "fill" an exit at that sticky bid, and the 50c
       * breakout baseline kept moving on a market nobody could trade. It is
       * still tracked (it is on the way to a resolution, which is what the
       * resolved tracker is for) — it just no longer trades or alerts. */
      if (!tradeable) {
        merged._closed = true;
        /* Settlement detection straight from the batch response. `determined`
         * (result known, settlement timer running), `amended` (re-determined
         * after a dispute) and `finalized` (settlement complete) all carry an
         * official yes/no result and are the resolutions we record. A merely
         * `closed`/`inactive` market has no result yet. */
        if ((st === 'finalized' || st === 'determined' || st === 'amended' || st === 'settled' || st === 'closed')
            && (m.result === 'yes' || m.result === 'no')) {
          if (!M.state.resolved[m.ticker]) {
            resolvedNow[m.ticker] = {
              result: m.result, settlement_ts: m.settlement_ts || null,
              event: m.event_ticker, title: m.title,
              topic: prev._topic, settlement_value_dollars: m.settlement_value_dollars || null
            };
          }
        }
        M.manage(m.ticker, merged, now);
        return;
      }

      var last = Number(m.last_price_dollars);
      var bid = Number(m.yes_bid_dollars);
      var ask = Number(m.yes_ask_dollars);
      if (isFinite(last) || isFinite(bid)) {
        var h = S.history[m.ticker] || (S.history[m.ticker] = []);
        h.push({ t: now, last: isFinite(last) ? last : null, bid: isFinite(bid) ? bid : null, ask: isFinite(ask) ? ask : null });
        if (h.length > 720) h.splice(0, h.length - 720);
        /* The alert is built from the merged watch entry, not the raw API object:
           the raw object has no _topic (the topic is attached by the classifier),
           so building the alert from it dropped the topic from every alert. */
        checkAlert(merged, h, now);
      }
      M.manage(m.ticker, merged, now);
    });
    if (Object.keys(resolvedNow).length) {
      Object.assign(M.state.resolved, resolvedNow);
      M.applyResolutions(resolvedNow);
      M.persistAll();
      renderResolved();
    }
    renderTable(); renderKPIs(); renderBook();
    if (S.selected && (now - S.lastCandleFetch > CFG.candleMs)) fetchCandles();
  }

  /* ---------- alerts (>= $0.10 move, either direction) ----------
   * The brief asks for "sudden swings ... >= $0.10 in either direction". Two
   * cases must fire, because REST polling cannot see the tick-by-tick path
   * (official docs: responses are cached and can lag by seconds —
   * https://docs.kalshi.com/api-reference/market/get-markets):
   *   1. step:      |current sample - previous sample| >= $0.10
   *   2. swing:     the market swung >= $0.10 and came back inside one poll
   *                 window. The market object exposes `previous_price_dollars`
   *                 (last trade price before the current one, per the official
   *                 Market schema), so |current - previous_price| catches a
   *                 round-trip that sampled deltas miss.
   * Prices are compared in integer ten-thousandths of a dollar (4 dp, the
   * documented price precision) so an exact $0.10 move can never fail on
   * binary-float error (0.66 - 0.56 === 0.09999999999999998). The comparison
   * itself lives in assets/model.js -> alertMove() so it can be unit-tested
   * offline; a per-market cooldown stops oscillation from spamming the chats.
   */
  var lastAlertAt = {};
  function checkAlert(m, h, now) {
    if (h.length < 2) return;
    var prev = h[h.length - 2], cur = h[h.length - 1];
    var a = cur.last !== null ? cur.last : cur.bid;
    var b = prev.last !== null ? prev.last : prev.bid;
    if (a === null || b === null) return;
    var mv = M.alertMove(b, a);
    var kind = 'sample';
    if (!mv) {
      // Fall back to the exchange-reported previous trade price to catch a
      // swing that fully reversed between two polls.
      var pp = Number(m.previous_price_dollars);
      if (!isFinite(pp)) return;
      mv = M.alertMove(pp, a);
      if (!mv) return;
      kind = 'swing (previous trade)';
    }
    if (lastAlertAt[m.ticker] && now - lastAlertAt[m.ticker] < CFG.alertCooldownMs) return;
    lastAlertAt[m.ticker] = now;
    var vol24 = Number(m.volume_24h_fp || 0), vol = Number(m.volume_fp || 0);
    var estdv = isFinite(vol) && isFinite(Number(m.last_price_dollars)) ? Math.round(vol * Number(m.last_price_dollars)) : null;
    var alert = {
      t: now, ticker: m.ticker, event: m.event_ticker,
      title: (S.events[m.event_ticker] && S.events[m.event_ticker].title) || m.title || m.ticker,
      topic: m._topic, from: mv.from, to: mv.to, delta: mv.delta, dir: mv.dir, kind: kind,
      vol24: vol24, estdv: estdv,
      score: M.score(mv.delta, m)
    };
    M.pushAlert(alert);
    S.newAlerts.push({ ticker: m.ticker, delta: mv.delta, dir: mv.dir });
    pushChat(alert);
    renderKPIs();
  }

  /* ---------- orderbook (selected market) ---------- */
  function pollBook() {
    if (!S.selected || S.mode === 'snapshot') return;
    /* depth = number of price levels per side, counted from the best bid
     * (official parameter: 1-100, 0/omitted = all levels). */
    api('/markets/' + encodeURIComponent(S.selected) + '/orderbook', { depth: String(CFG.bookDepth) }, function (err, j) {
      if (err) return;
      S.book = (j && (j.orderbook_fp || j.orderbook)) || { yes_dollars: [], no_dollars: [] };
      renderBook();
    });
  }
  /* Derived asks via the official reciprocal rule (YES ask = $1 - NO bid,
   * NO ask = $1 - YES bid). Bids are exchange-published; asks are derived. */
  function bookViews() {
    var b = S.book || { yes_dollars: [], no_dollars: [] };
    var yb = (b.yes_dollars || []).map(function (x) { return { p: Number(x[0]), q: Number(x[1]) }; });
    var nb = (b.no_dollars || []).map(function (x) { return { p: Number(x[0]), q: Number(x[1]) }; });
    var ya = nb.map(function (x) { return { p: Math.round((1 - x.p) * 10000) / 10000, q: x.q }; }).reverse();
    var na = yb.map(function (x) { return { p: Math.round((1 - x.p) * 10000) / 10000, q: x.q }; }).reverse();
    var liqY = yb.reduce(function (s, x) { return s + x.p * x.q; }, 0);
    var liqN = nb.reduce(function (s, x) { return s + x.p * x.q; }, 0);
    return { yb: yb, ya: ya, nb: nb, na: na, liqY: liqY, liqN: liqN };
  }

  /* ---------- time series for the chart window ----------
   * The official candlestick endpoint accepts ONLY period_interval 1, 60 or
   * 1440 (minutes):
   * https://docs.kalshi.com/api-reference/market/get-market-candlesticks
   * So the seconds / minutes windows cannot be built from candlesticks at all
   * (an earlier version asked for period_interval=0, which the API rejects).
   * Those windows are built from the exchange TRADE TAPE instead:
   *   GET /markets/trades?ticker=...&min_ts=...&max_ts=...&limit=1000
   * https://docs.kalshi.com/api-reference/market/get-trades
   * which is official, second-resolution data. Session polls (12 s) are merged
   * in as a live tail. Windows >= 1h use candlesticks (1 min or 60 min).
   */
  var WINDOWS = [
    { id: '60s', label: 'Last 60 seconds', s: 60, src: 'trades' },
    { id: '5m', label: 'Last 5 minutes', s: 300, src: 'trades' },
    { id: '15m', label: 'Last 15 minutes', s: 900, src: 'trades' },
    { id: '60m', label: 'Last hour', s: 3600, src: 'candles', interval: 1 },
    { id: '6h', label: 'Last 6 hours', s: 21600, src: 'candles', interval: 1 },
    { id: '24h', label: 'Last 24 hours', s: 86400, src: 'candles', interval: 60 }
  ];
  function fetchTrades() {
    if (!S.selected || S.mode === 'snapshot') { drawChart(); return; }
    var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0] || WINDOWS[1];
    var end = Math.floor(Date.now() / 1000);
    var start = end - Math.min(w.s, 3600);       // trade tape: at most 1h per request
    api('/markets/trades', { ticker: S.selected, min_ts: String(start), max_ts: String(end), limit: '1000' },
      function (err, j) {
        S.lastTradeFetch = Date.now();
        if (err || !j) { S.trades = []; drawChart(); return; }
        var pts = (j.trades || []).map(function (t) {
          var p = Number(t.yes_price_dollars);
          var ts = Date.parse(t.created_time);
          return { t: isFinite(ts) ? ts : null, p: isFinite(p) ? p : null };
        }).filter(function (x) { return x.t !== null && x.p !== null; });
        pts.sort(function (a, b) { return a.t - b.t; });
        S.trades = pts;
        S.tradesTruncated = !!(j.cursor); // more pages exist than one request returned
        drawChart();
      });
  }
  function fetchCandles() {
    if (!S.selected || S.mode === 'snapshot') return;
    var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0];
    if (!w || w.src !== 'candles') { fetchTrades(); return; }
    var ev = S.events[S.watch[S.selected] && S.watch[S.selected].event_ticker];
    var series = ev && ev.series_ticker;
    if (!series) { drawChart(); return; }
    var periodMin = w.interval || 1;
    var end = Math.floor(Date.now() / 1000);
    // one request may span at most 5,000 periods (official docs) — we ask for
    // exactly the window, which is far below that for a 6h / 24h window.
    var start = end - Math.ceil(w.s / (periodMin * 60)) * periodMin * 60;
    api('/series/' + encodeURIComponent(series) + '/markets/' + encodeURIComponent(S.selected) + '/candlesticks',
      { start_ts: start, end_ts: end, period_interval: String(periodMin) }, function (err, j) {
        S.lastCandleFetch = Date.now();
        if (err || !j || !j.candlesticks) { drawChart(); return; }
        var pts = [];
        j.candlesticks.forEach(function (c) {
          var dist = c.price || c.yes_bid || c.yes_ask;
          var p = dist && (dist.close_dollars !== undefined && dist.close_dollars !== null ? Number(dist.close_dollars)
            : dist.close !== undefined ? Number(dist.close) : null);
          if (p === null && dist) p = Number(dist.close_dollars);
          if (p !== null && isFinite(p)) pts.push({ t: Number(c.end_period_ts) * 1000, p: p });
        });
        S.candles = pts;
        drawChart();
      });
  }

  /* ---------- chart ---------- */
  /* Series for the selected window:
   *  trades windows -> official trade prints (+ the 12 s poll samples as a tail)
   *  candle windows -> official candlestick closes (+ poll samples as a tail)
   * X axis is always time in ms, Y axis is the YES price in dollars (0-1).
   */
  function chartData() {
    var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0] || WINDOWS[1];
    var cutoff = Date.now() - w.s * 1000;
    var h = (S.history[S.selected] || []).filter(function (x) { return x.t >= cutoff; })
      .map(function (x) { return { t: x.t, p: x.last !== null ? x.last : x.bid }; })
      .filter(function (x) { return x.p !== null; });
    var base = h, src = 'session polls only';
    if (w.src === 'trades' && S.trades && S.trades.length) {
      base = S.trades.filter(function (x) { return x.t >= cutoff; })
        .map(function (x) { return { t: x.t, p: x.p, src: 'trade print' }; }).concat(h);
      src = 'official trade prints (GET /markets/trades)';
    } else if (w.src === 'candles' && S.candles && S.candles.length) {
      base = S.candles.filter(function (x) { return x.t >= cutoff; })
        .map(function (x) { return { t: x.t, p: x.p, src: (w.interval || 1) + '-min candle close' }; }).concat(h);
      src = 'official candlesticks (period ' + (w.interval || 1) + ' min)';
    }
    base.sort(function (a, b) { return a.t - b.t; });
    S.chartSource = src;
    return base;
  }
  /* Hover readout: the canvas keeps the last plotted geometry so a mousemove can
   * map the pointer back to the nearest official print (or candle close) and
   * show its exact time and price. Nothing is inferred — the value shown is the
   * value the API returned. */
  var CHART = { pts: [], t0: 0, t1: 0, L: 44, W: 0 };
  function chartHover(e) {
    var box = $('#kx-chart'); if (!box || CHART.pts.length < 2) return;
    var rect = box.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    if (mx < CHART.L || mx > CHART.W - 8) { drawChart(); return; }
    var frac = (mx - CHART.L) / (CHART.W - 8 - CHART.L);
    var t = CHART.t0 + frac * (CHART.t1 - CHART.t0);
    var best = null, bestD = Infinity;
    CHART.pts.forEach(function (d) {
      var dd = Math.abs(d.t - t);
      if (dd < bestD) { bestD = dd; best = d; }
    });
    if (!best) return;
    var tip = $('#kx-chart-tip');
    if (tip) {
      tip.textContent = new Date(best.t).toLocaleString() + ' · ' + money(best.p) +
        (best.src ? ' · ' + best.src : '');
      tip.style.display = 'block';
    }
    drawChart(mx);
  }
  function drawChart(hoverX) {
    var box = $('#kx-chart'); if (!box) return;
    var rect = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (rect.width < 10) return;
    box.width = rect.width * dpr; box.height = rect.height * dpr;
    /* A browser (or a test DOM) without a 2d canvas backend returns null - draw
       nothing instead of throwing and killing the rest of the page. */
    var x = box.getContext && box.getContext('2d'); if (!x) return; x.scale(dpr, dpr);
    var W = rect.width, H = rect.height, L = 44, R = 8, T = 10, B = 24;
    x.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement);
    var line = css.getPropertyValue('--line') || '#2a383b', muted = css.getPropertyValue('--muted') || '#91a3a4',
        green = css.getPropertyValue('--green') || '#61d6a2';
    var data = chartData();
    /* Y axis: contract price in dollars. The scale is the observed range of the
     * plotted prints, padded by 2c and clamped to the legal $0.00-$1.00 grid —
     * a fixed 0-1 axis would flatten a market trading at 45-52c into a line.
     * Axis labels show the real bounds so nothing is implied. */
    var prices = data.map(function (d) { return d.p; });
    var lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    lo = Math.max(0, lo - 0.02); hi = Math.min(1, hi + 0.02);
    if (hi - lo < 0.01) { lo = Math.max(0, lo - 0.005); hi = Math.min(1, hi + 0.005); }
    x.strokeStyle = line; x.fillStyle = muted; x.font = '11px system-ui';
    for (var i = 0; i <= 4; i++) {
      var yy = T + i * (H - T - B) / 4;
      var lv = hi - i * (hi - lo) / 4;
      x.globalAlpha = 0.6;
      x.beginPath(); x.moveTo(L, yy); x.lineTo(W - R, yy); x.stroke();
      x.globalAlpha = 1;
      x.fillText(lv.toFixed(2), 6, yy + 4);
    }
    var winLabel = ($('#kx-win') && $('#kx-win').selectedOptions[0] ? $('#kx-win').selectedOptions[0].text : S.window);
    $('#kx-chart-note') && ($('#kx-chart-note').textContent =
      data.length + ' points · ' + winLabel + ' · X = time, Y = contract price (axis scaled to the printed range, clamped to $0.00–$1.00; hover the line for exact values) · source: ' + (S.chartSource || '—') +
      (S.tradesTruncated ? ' · NOTE: the 1,000-trade page cap was hit, so the oldest prints in this window are not shown' : ''));
    if (data.length < 2) {
      $('#kx-chart-name') && ($('#kx-chart-name').textContent = S.selected || 'Select a market');
      var hint = $('#kx-chart-alerts');
      if (hint) hint.innerHTML = '<span class="muted small">Chart builds from the official trade tape (seconds/minutes windows) and official candlesticks (hour+ windows), plus live poll samples. Select a market row to start.</span>';
      return;
    }
    var t0 = data[0].t, t1 = data[data.length - 1].t;
    if (t1 === t0) t1 = t0 + 1000;
    function px(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    CHART.pts = data; CHART.t0 = t0; CHART.t1 = t1; CHART.L = L; CHART.W = W;
    function py(p) { return T + (hi - p) / (hi - lo) * (H - T - B); }
    x.strokeStyle = green; x.lineWidth = 2; x.beginPath();
    data.forEach(function (d, i) { i ? x.lineTo(px(d.t), py(d.p)) : x.moveTo(px(d.t), py(d.p)); });
    x.stroke();
    var lastP = data[data.length - 1].p;
    x.fillStyle = green;
    x.beginPath(); x.arc(px(t1), py(lastP), 3.5, 0, 7); x.fill();
    x.fillStyle = muted; x.font = '12px system-ui';
    x.fillText(money(lastP), Math.min(px(t1) + 6, W - 52), py(lastP) - 6);
    for (var k = 0; k <= 3; k++) {
      var tt = t0 + (t1 - t0) * k / 3;
      x.fillText(hhmmss(tt), Math.max(L, Math.min(px(tt) - 26, W - 58)), H - 8);
    }
    /* Alert markers: >= $0.10 jumps for the selected market in this window. */
    var css2 = getComputedStyle(document.documentElement);
    var red = css2.getPropertyValue('--red') || '#ff827c';
    var marks = (M.state.alerts || []).filter(function (al) {
      return al.ticker === S.selected && al.t >= t0 && al.t <= t1;
    });
    marks.forEach(function (al) {
      x.fillStyle = al.dir === 'up' ? green : red;
      x.beginPath(); x.arc(px(al.t), py(al.to), 4, 0, 7); x.fill();
      x.fillStyle = muted; x.font = '10px system-ui';
      x.fillText((al.delta > 0 ? '+' : '') + al.delta.toFixed(2), Math.min(px(al.t) + 5, W - 40), py(al.to) - 7);
    });
    if (typeof hoverX === 'number') {
      x.strokeStyle = muted; x.globalAlpha = 0.7; x.lineWidth = 1;
      x.beginPath(); x.moveTo(hoverX, T); x.lineTo(hoverX, H - B); x.stroke();
      x.globalAlpha = 1;
    }
    var name = $('#kx-chart-name');
    if (name) name.textContent = S.selected || '';
    var hint2 = $('#kx-chart-alerts');
    if (hint2) {
      if (marks.length) {
        hint2.innerHTML = '<span class="muted small">' + marks.length + ' alert marker(s) in this window (dots on the line). Latest: ' +
          marks.slice(-1).map(function (al) {
            return '<b class="' + al.dir + '">' + (al.delta > 0 ? '+' : '') + al.delta.toFixed(2) + '</b> ' +
              '<a href="' + esc(kalshiUrl(al.event)) + '" target="_blank" rel="noopener">' + esc(al.title) + '</a> · ' +
              '<a href="' + esc(newsUrl(al.title)) + '" target="_blank" rel="noopener">news search (lead)</a>';
          }).join('') + ' — causality is never claimed.</span>';
      } else {
        hint2.innerHTML = '<span class="muted small">No ≥ $0.10 alert markers for this market in the selected window yet.</span>';
      }
    }
    renderJumps();
  }

  /* ---------- chats ---------- */
  function alertLinks(a) {
    var ev = S.events[a.event];
    var src = ev && ev.settlement_sources && ev.settlement_sources.filter(function (s) { return s.url && /^https:/.test(s.url); }).slice(0, 2) || [];
    var k = kalshiUrl(a.event);
    var html = (k ? '<a href="' + esc(k) + '" target="_blank" rel="noopener">Kalshi series page</a> · ' : '')
      + '<a href="' + esc(apiEventUrl(a.event)) + '" target="_blank" rel="noopener">official API record</a>';
    src.forEach(function (s) { html += ' · <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name.slice(0, 24)) + '</a>'; });
    html += ' · <a href="' + esc(newsUrl(a.title)) + '" target="_blank" rel="noopener">news search (lead)</a>';
    return html;
  }
  function chatMsg(a, model) {
    var arrow = a.dir === 'up' ? '\u25b2' : '\u25bc';
    var cls = model ? 'msg model' : ('msg ' + a.dir);
    var topicLabel = M.topicById(a.topic) ? M.topicById(a.topic).label : (a.topic || '');
    return '<div class="' + cls + '"><span class="time">' + hhmmss(a.t) + '</span>' +
      '<b class="' + a.dir + '">' + arrow + ' ' + (a.delta > 0 ? '+' : '') + a.delta.toFixed(2) + '</b> ' +
      (topicLabel ? '<span class="pill" style="font-size:11px;padding:1px 8px">' + esc(topicLabel) + '</span> ' : '') +
      (kalshiUrl(a.event) ? '<a href="' + esc(kalshiUrl(a.event)) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a> ' : '<b>' + esc(a.title) + '</b> ') +
      '<span class="meta">' + (a.kind && a.kind !== 'sample' ? esc(a.kind) + ' · ' : '') +
      esc(cents(a.from)) + ' \u2192 ' + esc(cents(a.to)) +
      (a.vol24 !== null && a.vol24 !== undefined ? ' · 24h ' + fmtK(a.vol24) : '') +
      (a.estdv ? ' · est $' + fmtK(a.estdv) : '') +
      (model ? ' · score ' + a.score : '') + '</span>' +
      '<div class="links">' + alertLinks(a) + '</div></div>';
  }
  var SESSION_START = Date.now();
  /* A chat with an empty first screen tells a trader nothing. This note states
   * what the chat is, when this tab started watching, and that older alerts
   * kept in localStorage are listed separately below (they were captured by a
   * previous tab, so their "from" price may be older than this page). */
  function chatSessionNote() {
    return '<div class="msg note"><span class="time">' + hhmmss(SESSION_START) + '</span>' +
      '<b>Watching</b> · new \u2265 $0.10 moves post here as they are sampled (' + (CFG.watchPollMs / 1000) +
      ' s poll). Moves captured in earlier sessions are kept in the board below until they are replaced.</div>';
  }
  function recentBoard(limit) {
    var minScore = (M.state.bot.strategies && M.state.bot.strategies.momentum.minScore) || 0.45;
    var rows = M.state.alerts.slice().reverse().slice(0, limit || 40);
    if (!rows.length) return '<span class="muted">No stored \u2265 $0.10 move yet.</span>';
    return '<table class="board"><thead><tr><th>Sampled (local)</th><th>Move</th><th>Market</th><th>Topic</th><th>Score</th><th>Source</th></tr></thead><tbody>' +
      rows.map(function (a) {
        var topicLabel = M.topicById(a.topic) ? M.topicById(a.topic).label : (a.topic || '');
        return '<tr><td class="muted">' + hhmmss(a.t) + '</td>' +
          '<td><span class="' + a.dir + '">' + (a.delta > 0 ? '+' : '') + a.delta.toFixed(2) + '</span></td>' +
          '<td>' + (kalshiUrl(a.event) ? '<a href="' + esc(kalshiUrl(a.event)) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' : esc(a.title)) + '</td>' +
          '<td class="muted">' + esc(topicLabel) + '</td>' +
          '<td class="' + (a.score >= minScore ? 'up' : 'muted') + '">' + (a.score === undefined ? '' : a.score) + '</td>' +
          '<td><a class="small" href="' + esc(apiMarketUrl(a.ticker)) + '" target="_blank" rel="noopener">API</a></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function refreshBoard() { var b = $('#kx-board'); if (b) b.innerHTML = recentBoard(); }
  function renderChats() {
    var all = $('#kx-chat-all'), model = $('#kx-chat-model');
    if (!all) return;
    var wasBottom = all.scrollHeight - all.scrollTop - all.clientHeight < 40;
    var wasBottomM = model.scrollHeight - model.scrollTop - model.clientHeight < 40;
    var minScore = (M.state.bot.strategies && M.state.bot.strategies.momentum.minScore) || 0.45;
    all.innerHTML = chatSessionNote() + (M.state.alerts.slice(-80).map(function (a) { return chatMsg(a, false); }).join('') ||
      '<div class="muted">No \u2265 $0.10 moves sampled in this tab yet. Polling runs while the tab is open.</div>');
    model.innerHTML = chatSessionNote() + (M.state.alerts.filter(function (a) { return a.score >= minScore; }).slice(-80)
      .map(function (a) { return chatMsg(a, true); }).join('') ||
      '<div class="muted">No alert above the model score threshold (' + minScore + ') yet. Formula: methods.html.</div>');
    refreshBoard();
    if (wasBottom) all.scrollTop = all.scrollHeight;
    if (wasBottomM) model.scrollTop = model.scrollHeight;
  }
  function pushChat(a) {
    var all = $('#kx-chat-all'), model = $('#kx-chat-model');
    var minScore = (M.state.bot.strategies && M.state.bot.strategies.momentum.minScore) || 0.45;
    if (all) {
      var stick = all.scrollHeight - all.scrollTop - all.clientHeight < 40;
      all.insertAdjacentHTML('beforeend', chatMsg(a, false));
      while (all.children.length > 120) all.removeChild(all.firstChild);
      if (stick) all.scrollTop = all.scrollHeight;
    }
    if (model && a.score >= minScore) {
      var stickM = model.scrollHeight - model.scrollTop - model.clientHeight < 40;
      model.insertAdjacentHTML('beforeend', chatMsg(a, true));
      while (model.children.length > 120) model.removeChild(model.firstChild);
      if (stickM) model.scrollTop = model.scrollHeight;
    }
    refreshBoard();
    if (a.ticker === S.selected) renderJumps();
  }

  /* ---------- sharp-move jump list under the chart (≥ $0.10, with event/source links) ---------- */
  function renderJumps() {
    var box = $('#kx-jumps'); if (!box) return;
    if (!S.selected) {
      box.innerHTML = '<span class="muted">Select a market row to see its ≥ $0.10 sharp-move log with event and source links.</span>';
      return;
    }
    var list = M.state.alerts.filter(function (a) { return a.ticker === S.selected; }).slice(-12).reverse();
    if (!list.length) {
      box.innerHTML = '<span class="muted">No ≥ $0.10 moves captured for ' + esc(S.selected) + ' in this session — polling runs while the tab is open.</span>';
      return;
    }
    box.innerHTML = '<div class="muted" style="margin:6px 0 4px"><b>Sharp moves ≥ $0.10 · ' + esc(S.selected) +
      '</b> — ▲/▼ markers above; event &amp; source links below (a link is a lead, never a claimed cause)</div>' +
      list.map(function (a) {
        var arrow = a.dir === 'up' ? '▲' : '▼';
        return '<div class="msg ' + a.dir + '"><span class="time">' + hhmmss(a.t) + '</span>' +
          '<b class="' + a.dir + '">' + arrow + ' ' + (a.delta > 0 ? '+' : '') + a.delta.toFixed(2) + '</b> ' +
          esc(cents(a.from)) + ' → ' + esc(cents(a.to)) +
          (a.vol24 !== null && a.vol24 !== undefined ? ' · 24h ' + fmtK(a.vol24) : '') +
          '<div class="links">' + alertLinks(a) + '</div></div>';
      }).join('');
  }

  /* ---------- main table ---------- */
  function rowsFor() {
    // Rank by highest estimated traded dollars (total contracts x last price).
    // The API publishes contract volume but no per-market traded-dollar field,
    // so this is a labeled estimate (see flagged.html #5). 24h est $ breaks ties.
    return S.list.map(function (t) { return S.watch[t]; })
      .filter(function (m) { return m && (!S.topic || m._topic === S.topic); })
      .sort(function (a, b) {
        var av = (Number(a.volume_fp) || 0) * (Number(a.last_price_dollars) || 0);
        var bv = (Number(b.volume_fp) || 0) * (Number(b.last_price_dollars) || 0);
        if (bv !== av) return bv - av;
        var a24 = (Number(a.volume_24h_fp) || 0) * (Number(a.last_price_dollars) || 0);
        var b24 = (Number(b.volume_24h_fp) || 0) * (Number(b.last_price_dollars) || 0);
        return b24 - a24;
      });
  }
  /* Live vs closed split.
   * "live" = M.isTradeable(): status `active` AND close_time still in the future
   * (official lifecycle table: initialized -> active when open_time passes,
   * active -> closed when close_time passes). Everything else is either awaiting
   * determination, settled, or a snapshot row whose close_time has already
   * passed — none of those can be traded, so ranking them by traded dollars
   * ahead of live markets hid the markets a trader can actually act on.
   * Both groups are still shown (the brief asks for events tracked until they
   * resolve), just not mixed together. */
  function isLive(m) { return M.isTradeable(m, Date.now()); }
  function liveCount() {
    return S.list.reduce(function (n, t) {
      var m = S.watch[t];
      return n + (m && (!S.topic || m._topic === S.topic) && isLive(m) ? 1 : 0);
    }, 0);
  }
  /* Best price = whichever side of the book is worth more per contract.
   * A YES contract bought at yes_ask and a NO contract bought at no_ask are the
   * two ways to take a position here, so the side with the higher ask is the
   * side the market currently favours. Values are the exchange's own quotes
   * (official /markets fields) — nothing is derived. */
  function bestSide(m) {
    var ya = Number(m.yes_ask_dollars), na = Number(m.no_ask_dollars);
    if (!isFinite(ya) && !isFinite(na)) return null;
    if (isFinite(ya) && isFinite(na)) return ya >= na ? { side: 'YES', p: ya } : { side: 'NO', p: na };
    return isFinite(ya) ? { side: 'YES', p: ya } : { side: 'NO', p: na };
  }
  function statusCell(m) {
    var st = String(m.status || '');
    var closeMs = Date.parse(m.close_time || '');
    var leftMs = isFinite(closeMs) ? closeMs - Date.now() : null;
    var soon = leftMs !== null && leftMs > 0 && leftMs < 6 * 3600e3;
    var label = st === 'active' ? (soon ? 'closing <6h' : 'live') : (st || 'no status');
    return '<span class="badge ' + (st === 'active' && !soon ? 'yes' : soon ? 'soon' : 'no') + '">' + esc(label) + '</span>';
  }
  function tableRow(m) {
    var h = S.history[m.ticker] || [];
    var prev = h.length > 1 ? (h[h.length - 2].last !== null ? h[h.length - 2].last : h[h.length - 2].bid) : null;
    var cur = h.length ? (h[h.length - 1].last !== null ? h[h.length - 1].last : h[h.length - 1].bid) : null;
    var d = (prev !== null && cur !== null) ? Math.round((cur - prev) * 1000) / 1000 : null;
    var dHtml = d === null ? '<span class="flat">—</span>' :
      '<span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') + '">' + (d > 0 ? '+' : '') + d.toFixed(2) + '</span>';
    var close = m.close_time ? new Date(m.close_time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    var apiUrl = 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=' + encodeURIComponent(m.ticker);
    var best = bestSide(m);
    var bestHtml = best ? '<b>' + best.side + '</b> ' + esc(cents(best.p)) : '';
    return '<tr data-t="' + esc(m.ticker) + '" class="' + (m.ticker === S.selected ? 'sel' : '') + (isLive(m) ? '' : ' closed') + '">' +
      '<td>' + (kalshiUrl(m.event_ticker) ? '<a href="' + esc(kalshiUrl(m.event_ticker)) + '" target="_blank" rel="noopener">' + esc(m.title || m.ticker) + '</a>'
        : esc(m.title || m.ticker)) +
      ' · <a class="small" href="' + esc(apiMarketUrl(m.ticker)) + '" target="_blank" rel="noopener">API</a>' +
      '<br><small class="muted">' + esc(m.event_ticker) + ' · ' + esc(M.topicById(m._topic) ? M.topicById(m._topic).label : 'other') + '</small></td>' +
      '<td>' + statusCell(m) + '</td>' +
      '<td>' + bestHtml + '</td>' +
      '<td>' + esc(cents(m.yes_bid_dollars)) + '</td>' +
      '<td>' + esc(cents(m.yes_ask_dollars)) + '</td>' +
      '<td>' + esc(cents(m.last_price_dollars)) + '</td>' +
      '<td>' + dHtml + '</td>' +
      '<td>' + esc(fmtK(m.yes_bid_size_fp)) + '</td>' +
      '<td>' + esc(fmtK(m.yes_ask_size_fp)) + '</td>' +
      '<td>' + esc(fmtK(m.volume_fp || m.volume)) + '</td>' +
      '<td>' + esc(fmtK(m.volume_24h_fp || m.volume_24h)) + '</td>' +
      '<td>' + (isFinite(Number(m.volume_fp)) && isFinite(Number(m.last_price_dollars)) ? '$' + fmtK(Number(m.volume_fp) * Number(m.last_price_dollars)) : '') + '</td>' +
      '<td>' + (isFinite(Number(m.volume_24h_fp)) && isFinite(Number(m.last_price_dollars)) ? '$' + fmtK(Number(m.volume_24h_fp) * Number(m.last_price_dollars)) : '') + '</td>' +
      '<td>' + esc(fmtK(m.open_interest_fp || m.open_interest)) + '</td>' +
      '<td class="muted">' + esc(close) + '</td>' +
      '<td class="src"><a href="' + esc(apiUrl) + '" target="_blank" rel="noopener">API</a></td>' +
      '</tr>';
  }
  function renderTable() {
    var tb = $('#kx-rows'); if (!tb) return;
    var all = rowsFor();
    var live = all.filter(isLive);
    var rows = (live.length ? live : all).slice(0, 120);
    var closedHidden = all.length - rows.length;
    $('#kx-count') && ($('#kx-count').textContent =
      rows.length + (live.length ? ' live' : '') + ' shown · watchlist ' + S.list.length +
      (closedHidden > 0 ? ' · ' + closedHidden + ' more (closed/further down)' : ''));
    var head = '';
    if (!live.length && all.length) {
      head = '<tr><td colspan="16" class="muted">No market in scope is open for trading right now (all are closed, awaiting determination, or settled) — showing the most recent rows ranked by traded dollars. Rows appear live again when discovery/polling sees an ' +
        '<code>active</code> market with a future <code>close_time</code>.</td></tr>';
    }
    tb.innerHTML = head + (rows.map(tableRow).join('') ||
      '<tr><td colspan="16" class="muted">No markets in scope yet — discovery is running, or live API is unreachable (snapshot mode shows data/ rows on the Data page).</td></tr>');
    tb.querySelectorAll('tr[data-t]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('a')) return;
        select(tr.getAttribute('data-t'));
      });
    });
  }
  function select(ticker) {
    S.selected = ticker;
    S.book = null; S.candles = null; S.lastCandleFetch = 0;
    S.trades = []; S.lastTradeFetch = 0;
    $('#kx-chart-name') && ($('#kx-chart-name').textContent = ticker);
    pollBook(); fetchCandles(); renderTable(); renderBook(); renderJumps();
  }

  /* ---------- orderbook panel ---------- */
  /* Official semantics (https://docs.kalshi.com/getting_started/orderbook_responses):
   * only bids are published; arrays are ascending by price, so the BEST bid is the
   * LAST element and the first element is the deepest/worst price. Asks are
   * derived by the documented reciprocal rule (YES ask = $1 - NO bid,
   * NO ask = $1 - YES bid). `?depth=N` returns the best N levels per side.
   *
   * Two things this panel used to get wrong for a trader deciding on a market:
   *   - it printed only the last 6 entries of each array, which are the levels
   *     nearest the best bid, so the ladder was not the top of the book in the
   *     direction a buyer needs (the cheapest asks sit at the LOWEST derived
   *     prices) and most of the liquidity was invisible;
   *   - it showed a single number per price, never how many contracts you could
   *     take before the price moved.
   * Now: ladder tables are ordered best-first for a buyer, each row shows the
   * contracts resting at that price, the running total a buyer could take up to
   * it, and the cash that would cost — all arithmetic on published values. */
  function bookViews() {
    var b = S.book || { yes_dollars: [], no_dollars: [] };
    function lv(arr) {
      return (arr || []).map(function (x) { return { p: Number(x[0]), q: Number(x[1]) }; })
        .filter(function (x) { return isFinite(x.p) && isFinite(x.q); });
    }
    var yb = lv(b.yes_dollars), nb = lv(b.no_dollars);
    // derived asks, re-sorted ascending because reversing the bid order is not
    // enough once prices are viewed from the other side of the 0-1 line
    var ya = nb.map(function (x) { return { p: Math.round((1 - x.p) * 10000) / 10000, q: x.q }; })
      .sort(function (a, c) { return a.p - c.p; });
    var na = yb.map(function (x) { return { p: Math.round((1 - x.p) * 10000) / 10000, q: x.q }; })
      .sort(function (a, c) { return a.p - c.p; });
    function cash(arr) { return arr.reduce(function (s, x) { return s + x.p * x.q; }, 0); }
    function contracts(arr) { return arr.reduce(function (s, x) { return s + x.q; }, 0); }
    return {
      yb: yb, nb: nb, ya: ya, na: na,
      liqY: cash(yb), liqN: cash(nb), liqYA: cash(ya), liqNA: cash(na),
      cY: contracts(yb), cN: contracts(nb),
      bestYesBid: yb.length ? yb[yb.length - 1].p : null,
      bestNoBid: nb.length ? nb[nb.length - 1].p : null,
      bestYesAsk: ya.length ? ya[0].p : null,
      bestNoAsk: na.length ? na[0].p : null
    };
  }
  function ladderTable(title, arr, cls, note) {
    var run = 0, cash = 0;
    var rows = arr.slice(0, 15).map(function (x) {
      run += x.q; cash += x.q * x.p;
      return '<tr><td>' + money(x.p) + '</td><td>' + fmtN(x.q) + '</td><td class="muted">' + fmtN(run) + '</td><td class="muted">' + money(cash) + '</td>' +
        '<td style="width:26%"><div class="bar ' + (cls || '') + '" style="width:' + Math.min(100, x.q / Math.max(1, arr[0].q) * 100) + '%"></div></td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">empty</td></tr>';
    return '<table class="ladder"><thead><tr><th>' + title + '</th><th>Contracts</th><th>Cum. contracts</th><th>Cum. cost</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (note ? '<p class="muted small">' + note + '</p>' : '');
  }
  function renderBook() {
    var box = $('#kx-book'); if (!box) return;
    if (!S.selected) { box.innerHTML = '<div class="muted">Click a market row to load its order book.</div>'; return; }
    var v = bookViews();
    var spread = (v.bestYesAsk !== null && v.bestYesBid !== null) ? Math.round((v.bestYesAsk - v.bestYesBid) * 10000) / 10000 : null;
    var m = S.watch[S.selected] || {};
    box.innerHTML =
      '<div class="row spread"><h3 class="spread" style="margin:0">' + esc(S.selected) +
      '<span class="muted small"> book polled every ' + (CFG.bookPollMs / 1000) + 's · depth ' + CFG.bookDepth + ' levels/side</span></h3>' +
      statusCell(m) + '</div>' +
      '<p class="small" style="margin:6px 0">Best YES bid <b>' + money(v.bestYesBid) + '</b> · Best YES ask <b>' + money(v.bestYesAsk) + '</b>' +
      (spread === null ? '' : ' · spread <b>' + money(spread) + '</b>') +
      ' · YES-side cash held in bids <b>' + money(v.liqY) + '</b> (' + fmtN(v.cY) + ' contracts)' +
      ' · NO-side cash held in bids <b>' + money(v.liqN) + '</b> (' + fmtN(v.cN) + ' contracts)</p>' +
      '<div class="grid2"><div>' +
      ladderTable('YES ask* (what you pay to buy YES, cheapest first)', v.ya, '', 'Cum. cost = contracts &#215; price added level by level: the cash needed to sweep those levels.') +
      ladderTable('YES bid (what selling YES gets, best first)', v.yb.slice().reverse(), '') +
      '</div><div>' +
      ladderTable('NO ask* (what you pay to buy NO, cheapest first)', v.na.slice().reverse(), 'no', 'Cum. cost = contracts &#215; price added level by level: the cash needed to sweep those levels.') +
      ladderTable('NO bid (what selling NO gets, best first)', v.nb.slice().reverse(), 'no', '') +
      '</div></div>' +
      '<p class="muted small">*Asks are derived, never published: YES ask = $1.00 − NO bid; NO ask = $1.00 − YES bid (official reciprocal rule). ' +
      'Only bids are returned by the exchange. Price ordering per the official docs: arrays ascend, the best bid is the last element. ' +
      'Empty book = no resting orders (the endpoint answers 200 with empty arrays for an empty book and for an unknown ticker alike). ' +
      'Source: <a href="' + esc(CFG.bases[0] + '/markets/' + encodeURIComponent(S.selected) + '/orderbook?depth=' + CFG.bookDepth) + '" target="_blank" rel="noopener">orderbook API</a> · ' +
      '<a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">official response docs</a>.</p>';
  }

  /* ---------- resolved strip ---------- */
  function renderResolved() {
    var box = $('#kx-resolved'); if (!box) return;
    var keys = Object.keys(M.state.resolved).slice(-10).reverse();
    box.innerHTML = keys.map(function (t) {
      var r = M.state.resolved[t];
      return '<tr><td>' + (kalshiUrl(r.event) ? '<a href="' + esc(kalshiUrl(r.event)) + '" target="_blank" rel="noopener">' + esc(r.title || t) + '</a>' : esc(r.title || t)) +
        ' · <a class="small" href="' + esc(apiMarketUrl(t)) + '" target="_blank" rel="noopener">API</a></td>' +
        '<td><span class="badge ' + (r.result === 'yes' ? 'yes' : 'no') + '">' + esc(String(r.result).toUpperCase()) + '</span></td>' +
        '<td class="muted">' + esc(r.settlement_ts ? r.settlement_ts.slice(0, 16).replace('T', ' ') + 'Z' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">Nothing watched has settled yet. Watched markets are checked on every poll; settled ones flip to YES/NO here automatically.</td></tr>';
  }

  /* ---------- KPIs ---------- */
  function renderKPIs() {
    var set = function (id, v, cls) {
      var n = $(id); if (!n) return; n.textContent = v; if (cls !== undefined) n.className = cls;
    };
    var hourAgo = Date.now() - 3600e3;
    var alerts1h = M.state.alerts.filter(function (a) { return a.t >= hourAgo; }).length;
    var sum = M.summary();
    set('#kpi-watch', String(S.list.length));
    set('#kpi-live', String(liveCount()));
    set('#kpi-alerts', String(alerts1h));
    set('#kpi-open', String(sum.open));
    set('#kpi-equity', '$' + sum.equity.toFixed(2), sum.equity >= M.state.bot.bank ? 'up' : 'down');
    set('#kpi-pnl', (sum.pnl >= 0 ? '+$' : '\u2212$') + Math.abs(sum.pnl).toFixed(2), sum.pnl >= 0 ? 'up' : 'down');
    var dv = rowsFor().reduce(function (s, m) {
      var v = Number(m.volume_24h_fp), p = Number(m.last_price_dollars);
      return s + (isFinite(v) && isFinite(p) ? v * p : 0);
    }, 0);
    set('#kpi-dv', '$' + fmtK(dv));
  }

  /* ---------- status banner ---------- */
  function renderStatus() {
    var b = $('#kx-mode'); if (!b) return;
    if (S.mode === 'live') {
      b.className = 'pill'; b.textContent = 'LIVE · REST poll ' + (CFG.watchPollMs / 1000) + 's';
    } else if (S.mode === 'snapshot') {
      b.className = 'pill warn'; b.textContent = 'SNAPSHOT MODE (live API unreachable)';
    } else if (S.mode === 'boot') {
      b.className = 'pill warn'; b.textContent = 'Connecting…';
    } else { b.className = 'pill bad'; b.textContent = 'ERROR'; }
    var note = $('#kx-mode-note');
    if (note) note.textContent = S.modeNote || (S.lastError ? ('Last API error: ' + S.lastError) : '');
  }
  function degrade() {
    if (!S.degraded) {
      S.degraded = true;
      if (!S.list.length) {
        loadSnapshot(function () { renderTable(); renderKPIs(); renderResolved(); });
      }
      S.modeNote = 'Live demo API could not be reached from this browser/network — showing the Actions-verified snapshot in data/ until a request succeeds (auto-retries).';
      renderStatus();
    }
  }
  function maybeLive() {
    if (S.mode !== 'live') {
      S.mode = 'live'; S.modeNote = '';
      renderStatus();
    }
  }

  /* ---------- loops ---------- */
  function loops() {
    setInterval(function () { if (!document.hidden) pollWatch(); }, CFG.watchPollMs);
    setInterval(function () {
      // selected market: trade tape for the seconds windows, independent of the
      // slower candlestick refresh
      if (!document.hidden && S.selected && S.mode !== 'snapshot') {
        var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0];
        if (w && w.src === 'trades') fetchTrades();
      }
    }, 20000);
    setInterval(function () {
      if (!document.hidden && Date.now() - S.lastDiscovery > CFG.discoveryMs) discover();
    }, 30000);
    setInterval(function () { if (!document.hidden) pollBook(); }, CFG.bookPollMs);
    setInterval(function () {
      if (!document.hidden) {
        M.recordEquity(Date.now());
        var acted = M.runStrategies(S.newAlerts.splice(0), S.watch, S.list, Date.now());
        if (acted.length && $('#kx-trades-hint')) {
          $('#kx-trades-hint').textContent = 'Bot actions this cycle: ' +
            acted.map(function (a) { return a.ticker + ' → ' + a.strategy + ' ' + a.side.toUpperCase(); }).join(', ');
        }
        renderKPIs();
        if (window.location.pathname.indexOf('trades') !== -1) window.KalshiApp.renderTrades && window.KalshiApp.renderTrades();
      }
    }, CFG.watchPollMs);
    window.addEventListener('resize', function () { drawChart(); });
  }

  /* ---------- mount: dashboard ---------- */
  var NAV = [
    ['index.html', 'Home'], ['executive-summary.html', 'Summary'], ['dashboard.html', 'Dashboard'],
    ['trades.html', 'Strategy lab'], ['demo-account/', 'Demo Account'], ['portfolio.html', 'Portfolio'],
    ['topics/gas-prices.html', 'Gas'], ['topics/elections.html', 'Elections'], ['topics/culture.html', 'Culture'],
    ['topics/crypto.html', 'Crypto'], ['topics/golf.html', 'Golf'],
    ['data.html', 'Data'], ['resolved.html', 'Resolved'], ['methods.html', 'Methods'],
    ['suggestions.html', 'Ideas'], ['flagged.html', 'Flagged'], ['sources.html', 'Sources']
  ];
  function navHere(root) {
    var here = location.pathname.split('/').pop() || 'index.html';
    return NAV.map(function (n) {
      var href = (root || '') + n[0];
      var active = here === n[0] ? ' class="active"' : '';
      return '<a href="' + href + '"' + active + '>' + n[1] + '</a>';
    }).join('');
  }

  function mountDashboard(node, opts) {
    opts = opts || {};
    S.topic = opts.topic || '';
    var tabs = '<div class="tabs" id="kx-tabs">' + [{ id: '', label: 'All' }].concat(M.TOPICS.map(function (t) { return { id: t.id, label: t.label }; }))
      .map(function (t) { return '<button class="tab' + (S.topic === t.id ? ' active' : '') + '" data-topic="' + t.id + '">' + t.label + '</button>'; }).join('') + '</div>';
    node.innerHTML =
      '<div class="row spread"><div class="row"><span class="pill" id="kx-mode">Connecting…</span><span class="muted small" id="kx-mode-note"></span></div>' +
      '<div class="row"><select id="kx-win">' + WINDOWS.map(function (w) {
        return '<option value="' + w.id + '"' + (w.id === S.window ? ' selected' : '') + '>' + w.label + '</option>';
      }).join('') + '</select><button id="kx-refresh">Refresh now</button></div></div>' +
      '<p class="notice blue small">Alert rule: a <b>\u2265 $0.10</b> sampled price move (either direction) posts to the left chat. The right chat shows only moves the ROI screen likes ' +
      '(score \u2265 <span id="kx-minscore">' + M.state.bot.strategies.momentum.minScore + '</span>; formula in Methods). Links: official Kalshi page, the event\u2019s settlement sources, and a news search lead — causality is never claimed. Paper trading runs automatically per the Strategy Lab settings.</p>' +
      '<div class="cards">' +
      '<div class="card"><small>Live now (open for trading)</small><strong id="kpi-live">—</strong></div>' +
      '<div class="card"><small>Watchlist markets</small><strong id="kpi-watch">—</strong></div>' +
      '<div class="card"><small>\u226510\u00a2 alerts (1h)</small><strong id="kpi-alerts">—</strong></div>' +
      '<div class="card"><small>Est. 24h traded $ (shown)</small><strong id="kpi-dv">—</strong></div>' +
      '<div class="card"><small>Open paper positions</small><strong id="kpi-open">—</strong></div>' +
      '<div class="card"><small>Paper equity</small><strong id="kpi-equity">—</strong></div>' +
      '<div class="card"><small>Realized paper P&L</small><strong id="kpi-pnl">—</strong></div></div>' +
      (opts.compact ? '' : tabs) +
      '<div class="grid2"><div>' +
      '<div class="box"><div class="row spread"><h2 id="kx-title">' + (S.topic ? esc(M.topicById(S.topic).label) + ' · live markets' : 'Live markets · all topics') +
      '</h2><span class="muted small" id="kx-count"></span></div>' +
      '<div class="tablewrap" style="max-height:430px"><table><thead><tr>' +
      '<th>Event</th><th>Status</th><th>Best price</th><th>YES bid</th><th>YES ask</th><th>Last</th><th>\u0394 sample</th>' +
      '<th>Bid size</th><th>Ask size</th><th>Vol</th><th>24h vol</th><th>Est. $</th><th>Est 24h $</th><th>Open int.</th><th>Closes</th><th>Source</th>' +
      '</tr></thead><tbody id="kx-rows"></tbody></table></div>' +
      '<p class="muted small"><b>Open for trading only</b> (status <code>active</code> and <code>close_time</code> still in the future, per the <a href="https://docs.kalshi.com/getting_started/market_lifecycle" target="_blank" rel="noopener">official lifecycle</a>), ranked by <b>estimated traded dollars</b> (total contracts \u00d7 last price), ties broken by estimated 24h dollars \u2014 computed from exchange-reported fields, not exchange-published (blank when the market reports no volume). <b>Best price</b> names the cheaper-to-buy side with the higher exchange ask. <b>Bid size / Ask size</b> are the exchange\u2019s own top-of-book contract counts (<code>yes_bid_size_fp</code>, <code>yes_ask_size_fp</code>). \u0394 sample = change vs the previous poll sample. Every row links the official <a href="https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=" target="_blank" rel="noopener">GET /markets?tickers=</a> response that produced it. Closed and settled rows stay on the <a href="'+ (opts.root||'') +'resolved.html">Resolved</a> page.</p></div>' +
      '<div class="box"><div class="row spread"><h2>Price chart</h2><span class="muted small" id="kx-chart-name">—</span></div>' +
      '<div class="chartbox" style="position:relative"><canvas id="kx-chart"></canvas>' +
      '<div id="kx-chart-tip" class="muted small" style="display:none;position:absolute;top:4px;right:6px;background:rgba(10,20,22,.86);border:1px solid var(--line);border-radius:6px;padding:2px 8px;pointer-events:none"></div></div>' +
      '<p class="muted small" id="kx-chart-note"></p>' +
      '<p id="kx-chart-alerts"></p>' +
      '<div id="kx-jumps" class="jumplist"></div>' +
      '<div id="kx-book"></div></div></div>' +
      '<div class="grid2" style="margin-top:14px">' +
      '<div class="box"><div class="row spread"><h2>\u226510\u00a2 alerts · all in-scope events</h2><span class="muted small">newest at bottom</span></div>' +
      '<div class="chatbox" id="kx-chat-all"></div></div>' +
      '<div class="box"><div class="row spread"><h2>Model picks · high-ROI screen</h2><span class="muted small">score \u2265 threshold</span></div>' +
      '<div class="chatbox" id="kx-chat-model"></div></div></div>' +
      '<div class="box" style="margin-top:14px"><div class="row spread"><h2>Recent \u2265 $0.10 moves (persisted)</h2>' +
      '<span class="muted small">newest first &middot; stored in this browser (cap ' + M.ALERT_CAP + ')</span></div>' +
      '<div class="tablewrap" id="kx-board"></div></div>' +
      '<div class="box" style="margin-top:14px"><div class="row spread"><h2>Watched events resolved (YES / NO)</h2>' +
      '<a class="small" href="' + (opts.root || '') + 'trades.html">Strategy Lab \u2192</a></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Event</th><th>Result</th><th>Settled (UTC)</th></tr></thead><tbody id="kx-resolved"></tbody></table></div></div>' +
      '<p class="footer">Public demo market data · read-only · no credentials. Paper trading is local-only. ' +
      'REST responses are cached by the exchange for a short time (official docs), so alerts lag the tape by seconds; sub-second swings are not observable via REST.</p>';

    $('#kx-tabs') && $('#kx-tabs').querySelectorAll('button[data-topic]').forEach(function (b) {
      b.addEventListener('click', function () {
        location.search = '?topic=' + b.getAttribute('data-topic');
      });
    });
    $('#kx-win').addEventListener('change', function () {
      S.window = this.value; S.candles = null; S.lastCandleFetch = 0; fetchCandles();
    });
    $('#kx-refresh').addEventListener('click', function () { pollWatch(); pollBook(); fetchCandles(); });
    $('#kx-chart').addEventListener('mousemove', chartHover);
    $('#kx-chart').addEventListener('mouseleave', function () {
      var tip = $('#kx-chart-tip'); if (tip) tip.style.display = 'none';
      drawChart();
    });

    renderChats(); renderTable(); renderKPIs(); renderResolved(); renderBook(); renderStatus();
    renderJumps();
    drawChart();
    if (!S.timer) { S.timer = true; loops(); }
    // boot sequence
    fetch(ROOT + 'data/meta.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }).then(function (meta) {
        if (meta && meta.generated_at) {
          S.modeNote = 'Snapshot bootstrap: data/ collected ' + meta.generated_at.replace('T', ' ').slice(0, 19) + 'Z by Actions; live polling takes over on first successful request.';
          renderStatus();
        }
      });
    loadSnapshot(function (any) {
      renderTable(); renderKPIs(); renderResolved();
      discover();
      pollWatch();
    });
  }

  /* ---------- mount: trades page ---------- */
  function renderTrades() {
    if (!$('#kx-positions')) return;
    var sum = M.summary();
    var money2 = function (v) { return (v < 0 ? '\u2212$' : '$') + Math.abs(v).toFixed(2); };
    function tradeRows(list) {
      return list.slice().reverse().map(function (t) {
        return '<tr><td>' + esc(t.t.slice(0, 16).replace('T', ' ')) + '</td>' +
          '<td>' + (kalshiUrl(t.event_ticker) ? '<a href="' + esc(kalshiUrl(t.event_ticker)) + '" target="_blank" rel="noopener">' + esc(t.title || t.ticker) + '</a>' : esc(t.title || t.ticker)) +
          ' · <a class="small" href="' + esc(apiMarketUrl(t.ticker)) + '" target="_blank" rel="noopener">API</a><br><small class="muted">' + esc(t.ticker) + '</small></td>' +
          '<td>' + esc(t.side.toUpperCase()) + '</td><td>' + esc(cents(t.entry)) + '</td>' +
          '<td>' + (t.status === 'open' ? esc(cents(t.mark)) : esc(cents(t.exit && t.exit.price))) + '</td>' +
          '<td>' + esc(fmtN(t.qty)) + '</td><td>' + esc(t.strategy) + '</td>' +
          '<td>' + esc(M.topicById(t.topic) ? M.topicById(t.topic).label : (t.topic || '')) + '</td>' +
          '<td>' + esc(t.status) + '</td>' +
          '<td class="' + ((t.pnl || 0) >= 0 ? 'up' : 'down') + '">' + (t.status === 'open' ? '—' : money2(t.pnl || 0)) + '</td>' +
          '<td class="muted small">' + esc(t.status === 'open' ? '' : (t.exit && t.exit.reason) || '') + '</td></tr>';
      }).join('') || '<tr><td colspan="11" class="muted">None yet.</td></tr>';
    }
    var open = M.state.trades.filter(function (t) { return t.status === 'open'; });
    var closed = M.state.trades.filter(function (t) { return t.status !== 'open'; });
    $('#kx-positions').innerHTML = tradeRows(open.slice(-40));
    $('#kx-history').innerHTML = tradeRows(closed.slice(-60));
    var st = M.state.bot.strategies;
    $('#kx-strategies').innerHTML = Object.keys(st).map(function (k) {
      var s = st[k];
      return '<tr><td><button class="' + (s.on ? 'on' : '') + '" data-strat="' + k + '">' + (s.on ? 'ON' : 'OFF') + '</button></td>' +
        '<td>' + k + '</td><td class="muted small">' + describeStrategy(k, s) + '</td></tr>';
    }).join('');
    $('#kx-strategies').querySelectorAll('button[data-strat]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-strat');
        M.state.bot.strategies[k].on = !M.state.bot.strategies[k].on;
        M.persistAll(); renderTrades();
      });
    });
    var bs = M.byStrategy(), bt = M.byTopic();
    $('#kx-anal-strat').innerHTML = '<tr><th>Strategy</th><th>Trades</th><th>Open</th><th>Wins</th><th>Losses</th><th>P&L</th><th>ROI on cost</th></tr>' +
      bs.map(function (r) {
        var cost = r.cost || 0;
        return '<tr><td>' + esc(r.strategy) + '</td><td>' + r.n + '</td><td>' + r.open + '</td><td class="up">' + r.wins + '</td><td class="down">' + r.losses + '</td>' +
          '<td class="' + (r.pnl >= 0 ? 'up' : 'down') + '">' + money2(Math.round(r.pnl * 100) / 100) + '</td>' +
          '<td>' + (cost ? (Math.round(r.pnl / cost * 10000) / 100) + '%' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="muted">No closed trades yet.</td></tr>';
    $('#kx-anal-topic').innerHTML = '<tr><th>Topic</th><th>Trades</th><th>Open</th><th>Wins</th><th>Losses</th><th>P&L</th></tr>' +
      bt.map(function (r) {
        return '<tr><td>' + esc(M.topicById(r.topic) ? M.topicById(r.topic).label : r.topic) + '</td><td>' + r.n + '</td><td>' + r.open + '</td>' +
          '<td class="up">' + r.wins + '</td><td class="down">' + r.losses + '</td><td class="' + (r.pnl >= 0 ? 'up' : 'down') + '">' + money2(Math.round(r.pnl * 100) / 100) + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">No closed trades yet.</td></tr>';
    $('#kx-sum').textContent = 'Equity ' + money2(sum.equity) + ' · cash ' + money2(sum.cash) +
      ' · trades ' + sum.n + ' (open ' + sum.open + ') · win rate ' + (sum.winRate === null ? '—' : Math.round(sum.winRate * 100) + '%') +
      ' · realized P&L ' + money2(sum.pnl) + (sum.roi === null ? '' : ' · ROI ' + sum.roi + '%');
    drawEquity();
    renderResolved();
  }
  function describeStrategy(k, s) {
    if (k === 'momentum') return 'On a \u226510\u00a2 alert with score \u2265 ' + s.minScore + ' and spread \u2264 ' + cents(s.maxSpread) + ': buy the move direction at the ask; exit ' + s.holdMin + ' min, +' + cents(s.takeProfit) + ' or \u2212' + cents(s.stopLoss) + '.';
    if (k === 'fade') return 'On an alert with score < momentum threshold, spread \u2264 ' + cents(s.maxSpread) + ', 24h vol \u2265 ' + fmtN(s.minVol24h) + ': buy the opposite side; exit ' + s.holdMin + ' min, +' + cents(s.takeProfit) + ' or \u2212' + cents(s.stopLoss) + '.';
    if (k === 'harvest') return 'Buy YES \u2265 ' + cents(s.minPrice) + ' with spread \u2264 ' + cents(s.maxSpread) + ' closing within ' + s.maxCloseHours + 'h; hold to settlement (YES pays $1).';
    if (k === 'breakout') return 'On a 50\u00a2 cross with 24h vol \u2265 ' + fmtN(s.minVol24h) + ' and spread \u2264 ' + cents(s.maxSpread) + ': follow the cross; exit ' + s.holdMin + ' min, +' + cents(s.takeProfit) + ' or \u2212' + cents(s.stopLoss) + '.';
    return '';
  }
  function drawEquity() {
    var box = $('#kx-equity-chart'); if (!box) return;
    var d = M.state.equity;
    var rect = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    box.width = rect.width * dpr; box.height = rect.height * dpr;
    var x = box.getContext && box.getContext('2d'); if (!x) return; x.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    x.clearRect(0, 0, W, H);
    x.strokeStyle = '#2a383b'; x.fillStyle = '#91a3a4'; x.font = '11px system-ui';
    if (d.length < 2) { x.fillText('Equity curve builds while the bot runs (one point per cycle).', 10, 20); return; }
    var vals = d.map(function (p) { return p.equity; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 0.01) { min -= 1; max += 1; }
    var t0 = d[0].t, t1 = d[d.length - 1].t;
    x.beginPath();
    d.forEach(function (p, i) {
      var px = 34 + (p.t - t0) / Math.max(1, t1 - t0) * (W - 44);
      var py = 8 + (1 - (p.equity - min) / (max - min)) * (H - 30);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.strokeStyle = '#61d6a2'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#91a3a4';
    x.fillText('$' + max.toFixed(2), 2, 14);
    x.fillText('$' + min.toFixed(2), 2, H - 12);
    x.fillText(new Date(t0).toLocaleTimeString(), 34, H - 2);
    x.fillText(new Date(t1).toLocaleTimeString(), W - 70, H - 2);
  }
  function mountTrades(node, opts) {
    node.innerHTML =
      '<div class="row spread"><div class="row"><span class="pill" id="kx-mode">…</span><span class="muted small" id="kx-mode-note"></span></div>' +
      '<div class="row"><button id="kx-bot-toggle">Bot: —</button><button id="kx-export">Export JSON</button>' +
      '<button id="kx-import">Import JSON</button><button id="kx-clear" class="danger">Reset</button></div></div>' +
      '<p class="notice blue small">Automated <b>paper</b> trading: when the bot is ON it evaluates the documented strategies every poll cycle against live demo quotes and records local-only fills. No orders are sent to Kalshi; nothing here can touch a real or demo account. Fees use the official taker formula <code>roundup(M &times; 0.07 &times; C &times; P &times; (1&minus;P))</code> from the <a href="https://kalshi.com/docs/kalshi-fee-schedule.pdf" target="_blank" rel="noopener">official fee schedule</a> (verified 2026-11-20, effective July 7 2026), where M is the per-series <code>fee_multiplier</code> the demo API publishes on <a href="https://docs.kalshi.com/api-reference/market/get-series" target="_blank" rel="noopener">GET /series/{ticker}</a> (default 1 until a series record is seen; the production-schedule conflict for KXBTCY/KXETHY is published on <a href="flagged.html">Flagged</a>). Maker fees are not modelled because paper fills assume an immediately-matched order — see <a href="flagged.html">Flagged</a>.</p>' +
      '<div class="cards">' +
      '<div class="card"><small>Paper equity</small><strong id="kpi-equity">—</strong></div>' +
      '<div class="card"><small>Cash</small><strong id="kpi-cash">—</strong></div>' +
      '<div class="card"><small>Open positions</small><strong id="kpi-open">—</strong></div>' +
      '<div class="card"><small>Realized P&L</small><strong id="kpi-pnl">—</strong></div>' +
      '<div class="card"><small>Win rate (closed)</small><strong id="kpi-wr">—</strong></div>' +
      '<div class="card"><small>Trades total</small><strong id="kpi-n">—</strong></div></div>' +
      '<div class="grid2"><div class="box"><h2>Equity curve (session)</h2><div class="chartbox" style="height:150px"><canvas id="kx-equity-chart"></canvas></div></div>' +
      '<div class="box"><h2>Bot settings</h2>' +
      '<div class="row"><span>Bank $ <input id="kx-bank" type="number" min="10" step="10" value="' + M.state.bot.bank + '"></span>' +
      '<span>Per trade $ <input id="kx-per" type="number" min="1" step="5" value="' + M.state.bot.perTradeDollars + '"></span>' +
      '<span>Max positions <input id="kx-max" type="number" min="1" max="40" value="' + M.state.bot.maxPositions + '"></span>' +
      '<button id="kx-apply">Apply</button></div>' +
      '<p class="muted small">Fees: <b>' + (M.state.bot.fees ? 'ON (official taker formula)' : 'OFF') + '</b> — toggle below. Fee = roundup(M &times; 0.07 &times; contracts &times; price &times; (1 &minus; price)) per the <a href="https://kalshi.com/docs/kalshi-fee-schedule.pdf" target="_blank" rel="noopener">official schedule</a>, M = the demo API&rsquo;s per-series <code>fee_multiplier</code> (default 1; ' + Object.keys(M.state.seriesFees).length + ' series cached); settlement has no fee. Maker fees are not modelled.</p>' +
      '<button id="kx-fees">Toggle fees</button>' +
      '<p class="muted small" id="kx-trades-hint"></p>' +
      '<p class="small" id="kx-sum" style="margin-top:8px"></p></div></div>' +
      '<div class="box" style="margin-top:14px"><h2>Strategy automation</h2><div class="tablewrap"><table id="kx-strategies"></table></div></div>' +
      '<div class="grid2" style="margin-top:14px">' +
      '<div class="box"><h2>Open paper positions (mark = official bid)</h2><div class="tablewrap"><table id="kx-positions"></table></div></div>' +
      '<div class="box"><h2>P&L by strategy</h2><div class="tablewrap"><table id="kx-anal-strat"></table></div>' +
      '<h2 style="margin-top:12px">P&L by topic</h2><div class="tablewrap"><table id="kx-anal-topic"></table></div></div></div>' +
      '<div class="box" style="margin-top:14px"><h2>Closed &amp; settled paper trades</h2><div class="tablewrap" style="max-height:380px"><table id="kx-history"></table></div></div>' +
      '<div class="box" style="margin-top:14px"><h2>Resolved events tracked (YES / NO)</h2><div class="tablewrap"><table><thead><tr><th>Event</th><th>Result</th><th>Settled (UTC)</th></tr></thead><tbody id="kx-resolved"></tbody></table></div></div>' +
      '<p class="footer">Paper fills assume the official quote with no slippage; settlement pays $1 per winning contract. Everything is stored in this browser\u2019s localStorage only.</p>';

    var sum = M.summary();
    function refreshKpis() {
      var s = M.summary();
      $('#kpi-equity').textContent = '$' + s.equity.toFixed(2);
      $('#kpi-cash').textContent = '$' + s.cash.toFixed(2);
      $('#kpi-open').textContent = String(s.open);
      $('#kpi-pnl').textContent = (s.pnl >= 0 ? '+$' : '\u2212$') + Math.abs(s.pnl).toFixed(2);
      $('#kpi-pnl').className = s.pnl >= 0 ? 'up' : 'down';
      $('#kpi-wr').textContent = s.winRate === null ? '—' : Math.round(s.winRate * 100) + '%';
      $('#kpi-n').textContent = String(s.n);
      $('#kx-bot-toggle').textContent = 'Bot: ' + (M.state.bot.enabled ? 'ON' : 'OFF');
      $('#kx-bot-toggle').className = M.state.bot.enabled ? 'on' : '';
    }
    $('#kx-bot-toggle').addEventListener('click', function () {
      M.state.bot.enabled = !M.state.bot.enabled; M.persistAll(); refreshKpis();
    });
    $('#kx-fees').addEventListener('click', function () {
      M.state.bot.fees = !M.state.bot.fees; M.persistAll(); renderTrades(); refreshKpis();
    });
    $('#kx-apply').addEventListener('click', function () {
      M.state.bot.bank = Math.max(10, Number($('#kx-bank').value) || M.state.bot.bank);
      M.state.bot.perTradeDollars = Math.max(1, Number($('#kx-per').value) || M.state.bot.perTradeDollars);
      M.state.bot.maxPositions = Math.max(1, Number($('#kx-max').value) || M.state.bot.maxPositions);
      M.persistAll(); refreshKpis();
    });
    $('#kx-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ trades: M.state.trades, alerts: M.state.alerts, resolved: M.state.resolved, equity: M.state.equity, bot: M.state.bot }, null, 1)], { type: 'application/json' });
      var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'kalshi-paper-state.json'; a.click();
    });
    $('#kx-import').addEventListener('click', function () {
      var inp = el('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.addEventListener('change', function () {
        var f = inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            var j = JSON.parse(r.result);
            if (j.trades) M.state.trades = j.trades;
            if (j.alerts) M.state.alerts = j.alerts;
            if (j.resolved) M.state.resolved = j.resolved;
            if (j.equity) M.state.equity = j.equity;
            if (j.bot) M.state.bot = Object.assign(M.state.bot, j.bot);
            M.persistAll(); renderTrades(); refreshKpis();
          } catch (e) { alert('Import failed: ' + e.message); }
        };
        r.readAsText(f);
      });
      inp.click();
    });
    $('#kx-clear').addEventListener('click', function () {
      if (confirm('Reset all paper trades, alerts and equity history?')) { M.reset(); renderTrades(); refreshKpis(); renderResolved(); }
    });

    refreshKpis(); renderTrades(); renderStatus();
    if (!S.timer) { S.timer = true; loops(); }
    loadSnapshot(function () { discover(); pollWatch(); });
    renderChats();
  }

  /* ---------- boot ---------- */
  function mount() {
    var node = document.getElementById('kalshi-app');
    if (!node) return;
    var page = node.getAttribute('data-page');
    /* Topic page detection. `data-topic` holds the topic id itself ("golf"),
     * while the tab strip uses ?topic=... . An earlier revision indexed the
     * attribute string like a regex match and produced "a", which made
     * M.topicById() return null and crashed every topic subpage on load. */
    var topic = '';
    var attr = node.getAttribute('data-topic');
    if (attr && M.topicById(attr)) topic = attr;
    else {
      var q = location.search.match(/[?&]topic=([a-z-]+)/);
      if (q && M.topicById(q[1])) topic = q[1];
    }
    if (page === 'trades') mountTrades(node);
    else mountDashboard(node, { topic: topic, compact: !!node.getAttribute('data-topic'), root: node.getAttribute('data-root') || '' });
  }
  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollWatch(); drawChart(); } });

  return {
    state: S, select: select, renderTrades: renderTrades, drawChart: drawChart,
    /* pollWatch is exported so the CI test suite can drive one poll cycle and
       assert that every chunk of the watchlist is requested (a regression gate
       for the defect where only the first 200 tickers were ever polled). */
    pollWatch: pollWatch,
    CFG: CFG
  };
})();
