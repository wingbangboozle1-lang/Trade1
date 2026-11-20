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
    candleMs: 60000,             // candlestick refresh for visible chart
    eventQueuePerCycle: 24,      // event->markets fetches per discovery cycle
    maxWatch: 400,
    alertThreshold: 0.10,        // >= $0.10 either direction
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
  function kalshiEventUrl(ev) { return 'https://kalshi.com/markets/' + encodeURIComponent(String(ev || '').toLowerCase()); }
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
          var t = M.classify(ev.category, ev.title, ev.series_ticker);
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
              var title = sr.title || '';
              var hay = title + ' ' + sr.ticker;
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
                  }
                  m._topic = t.id;
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
            if (!S.watch[m.ticker]) { S.watch[m.ticker] = m; S.list.push(m.ticker); }
            else S.watch[m.ticker] = Object.assign(S.watch[m.ticker], m);
          });
        }
        done++;
        if (done === batch.length && S.eventQueue.length && depth + batch.length < CFG.eventQueuePerCycle) {
          fetchQueuedEvents(depth + batch.length);
        }
        trimWatch();
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
  function pollWatch() {
    if (S.mode === 'snapshot') return;
    var tickers = S.list.slice(0, CFG.chunk);
    if (!tickers.length) return;
    api('/markets', { tickers: tickers.join(',') }, function (err, j) {
      if (err) { S.lastError = String(err.message || err); degrade(); return; }
      handleMarketBatch(j);
      maybeLive();
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
      S.watch[m.ticker] = merged;

      var last = Number(m.last_price_dollars);
      var bid = Number(m.yes_bid_dollars);
      var ask = Number(m.yes_ask_dollars);
      if (isFinite(last) || isFinite(bid)) {
        var h = S.history[m.ticker] || (S.history[m.ticker] = []);
        h.push({ t: now, last: isFinite(last) ? last : null, bid: isFinite(bid) ? bid : null, ask: isFinite(ask) ? ask : null });
        if (h.length > 720) h.splice(0, h.length - 720);
        checkAlert(m, h, now);
      }
      // settlement detection straight from the batch response
      var st = String(m.status || '');
      if ((st === 'finalized' || st === 'settled' || st === 'closed') && (m.result === 'yes' || m.result === 'no')) {
        if (!M.state.resolved[m.ticker]) {
          resolvedNow[m.ticker] = {
            result: m.result, settlement_ts: m.settlement_ts || null,
            event: m.event_ticker, title: m.title,
            topic: prev._topic, settlement_value_dollars: m.settlement_value_dollars || null
          };
        }
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

  /* ---------- alerts (>= $0.10 sampled move, either direction) ---------- */
  function checkAlert(m, h, now) {
    if (h.length < 2) return;
    var prev = h[h.length - 2], cur = h[h.length - 1];
    var a = cur.last !== null ? cur.last : cur.bid;
    var b = prev.last !== null ? prev.last : prev.bid;
    if (a === null || b === null) return;
    var raw = a - b;
    if (Math.abs(raw) < CFG.alertThreshold - 1e-9) return; // tolerance: 4dp official prices
    var delta = Math.round(raw * 1000) / 1000;
    var dir = delta > 0 ? 'up' : 'down';
    var vol24 = Number(m.volume_24h_fp || 0), vol = Number(m.volume_fp || 0);
    var estdv = isFinite(vol) && isFinite(Number(m.last_price_dollars)) ? Math.round(vol * Number(m.last_price_dollars)) : null;
    var alert = {
      t: now, ticker: m.ticker, event: m.event_ticker,
      title: (S.events[m.event_ticker] && S.events[m.event_ticker].title) || m.title || m.ticker,
      topic: m._topic, from: b, to: a, delta: delta, dir: dir,
      vol24: vol24, estdv: estdv,
      score: M.score(delta, m)
    };
    M.pushAlert(alert);
    S.newAlerts.push({ ticker: m.ticker, delta: delta, dir: dir });
    pushChat(alert);
    renderKPIs();
  }

  /* ---------- orderbook (selected market) ---------- */
  function pollBook() {
    if (!S.selected || S.mode === 'snapshot') return;
    api('/markets/' + encodeURIComponent(S.selected) + '/orderbook', null, function (err, j) {
      if (err) return;
      S.book = (j && (j.orderbook_fp || j.orderbook)) || { yes_dollars: [], no_dollars: [] };
      renderBook();
    });
  }
  /* Derived YES ask = 1 - NO bid (official reciprocal relationship). */
  function bookViews() {
    var b = S.book || { yes_dollars: [], no_dollars: [] };
    var yb = (b.yes_dollars || []).map(function (x) { return { p: Number(x[0]), q: Number(x[1]) }; });
    var nb = (b.no_dollars || []).map(function (x) { return { p: Number(x[0]), q: Number(x[1]) }; });
    var ya = nb.map(function (x) { return { p: Math.round((1 - x.p) * 10000) / 10000, q: x.q }; }).reverse();
    var liqY = yb.reduce(function (s, x) { return s + x.p * x.q; }, 0);
    var liqN = nb.reduce(function (s, x) { return s + x.p * x.q; }, 0);
    return { yb: yb, ya: ya, nb: nb, liqY: liqY, liqN: liqN };
  }

  /* ---------- candlesticks for the chart window ---------- */
  var WINDOWS = [
    { id: '60s', label: 'Last 60 seconds', s: 60, candles: 0 },
    { id: '5m', label: 'Last 5 minutes', s: 300, candles: 0 },
    { id: '15m', label: 'Last 15 minutes', s: 900, candles: 0 },
    { id: '60m', label: 'Last hour', s: 3600, candles: 1 },
    { id: '6h', label: 'Last 6 hours', s: 21600, candles: 60 },
    { id: '24h', label: 'Last 24 hours', s: 86400, candles: 60 }
  ];
  function fetchCandles() {
    if (!S.selected || S.mode === 'snapshot') return;
    var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0];
    if (!w || !w.candles) { drawChart(); return; }
    var ev = S.events[S.watch[S.selected] && S.watch[S.selected].event_ticker];
    var series = ev && ev.series_ticker;
    if (!series) { drawChart(); return; }
    var end = Math.floor(Date.now() / 1000), start = end - Math.ceil(w.s / w.candles) * w.candles;
    api('/series/' + encodeURIComponent(series) + '/markets/' + encodeURIComponent(S.selected) + '/candlesticks',
      { start_ts: start, end_ts: end, period_interval: String(w.candles) }, function (err, j) {
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
  function chartData() {
    var w = WINDOWS.filter(function (x) { return x.id === S.window; })[0] || WINDOWS[3];
    var cutoff = Date.now() - w.s * 1000;
    var h = (S.history[S.selected] || []).filter(function (x) { return x.t >= cutoff; })
      .map(function (x) { return { t: x.t, p: x.last !== null ? x.last : x.bid }; })
      .filter(function (x) { return x.p !== null; });
    var base = h;
    if (w.candles && S.candles && S.candles.length) {
      base = S.candles.filter(function (x) { return x.t >= cutoff; }).concat(h);
      base.sort(function (a, b) { return a.t - b.t; });
    }
    return base;
  }
  function drawChart() {
    var box = $('#kx-chart'); if (!box) return;
    var rect = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (rect.width < 10) return;
    box.width = rect.width * dpr; box.height = rect.height * dpr;
    var x = box.getContext('2d'); x.scale(dpr, dpr);
    var W = rect.width, H = rect.height, L = 44, R = 8, T = 10, B = 24;
    x.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement);
    var line = css.getPropertyValue('--line') || '#2a383b', muted = css.getPropertyValue('--muted') || '#91a3a4',
        green = css.getPropertyValue('--green') || '#61d6a2';
    x.strokeStyle = line; x.fillStyle = muted; x.font = '11px system-ui';
    for (var i = 0; i <= 5; i++) {
      var yy = T + i * (H - T - B) / 5;
      x.globalAlpha = 0.6;
      x.beginPath(); x.moveTo(L, yy); x.lineTo(W - R, yy); x.stroke();
      x.globalAlpha = 1;
      x.fillText((1 - i / 5).toFixed(2), 6, yy + 4);
    }
    var data = chartData();
    $('#kx-chart-note') && ($('#kx-chart-note').textContent =
      data.length + ' points · ' + ($('#kx-win') && $('#kx-win').selectedOptions[0] ? $('#kx-win').selectedOptions[0].text : S.window));
    if (data.length < 2) { $('#kx-chart-name') && ($('#kx-chart-name').textContent = S.selected || 'Select a market'); return; }
    var t0 = data[0].t, t1 = data[data.length - 1].t;
    if (t1 === t0) t1 = t0 + 1000;
    function px(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    function py(p) { return T + (1 - p) * (H - T - B); }
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
    var name = $('#kx-chart-name');
    if (name) name.textContent = S.selected || '';
  }

  /* ---------- chats ---------- */
  function alertLinks(a) {
    var ev = S.events[a.event];
    var src = ev && ev.settlement_sources && ev.settlement_sources.filter(function (s) { return s.url && /^https:/.test(s.url); }).slice(0, 2) || [];
    var html = '<a href="' + esc(kalshiEventUrl(a.event)) + '" target="_blank" rel="noopener">Kalshi market</a>';
    src.forEach(function (s) { html += ' · <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name.slice(0, 24)) + '</a>'; });
    html += ' · <a href="' + esc(newsUrl(a.title)) + '" target="_blank" rel="noopener">news search (lead)</a>';
    return html;
  }
  function chatMsg(a, model) {
    var arrow = a.dir === 'up' ? '\u25b2' : '\u25bc';
    var cls = model ? 'msg model' : ('msg ' + a.dir);
    return '<div class="' + cls + '"><span class="time">' + hhmmss(a.t) + '</span>' +
      '<b class="' + a.dir + '">' + arrow + ' ' + (a.delta > 0 ? '+' : '') + a.delta.toFixed(2) + '</b> ' +
      '<a href="' + esc(kalshiEventUrl(a.event)) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a> ' +
      '<span class="meta">' + esc(cents(a.from)) + ' \u2192 ' + esc(cents(a.to)) +
      (a.vol24 !== null && a.vol24 !== undefined ? ' · 24h ' + fmtK(a.vol24) : '') +
      (a.estdv ? ' · est $' + fmtK(a.estdv) : '') +
      (model ? ' · score ' + a.score : '') + '</span>' +
      '<div class="links">' + alertLinks(a) + '</div></div>';
  }
  function renderChats() {
    var all = $('#kx-chat-all'), model = $('#kx-chat-model');
    if (!all) return;
    var wasBottom = all.scrollHeight - all.scrollTop - all.clientHeight < 40;
    var wasBottomM = model.scrollHeight - model.scrollTop - model.clientHeight < 40;
    var minScore = (M.state.bot.strategies && M.state.bot.strategies.momentum.minScore) || 0.45;
    all.innerHTML = M.state.alerts.slice(-80).map(function (a) { return chatMsg(a, false); }).join('') ||
      '<div class="muted">No \u2265 $0.10 moves captured yet. Polling runs while the tab is open.</div>';
    model.innerHTML = M.state.alerts.filter(function (a) { return a.score >= minScore; }).slice(-80)
      .map(function (a) { return chatMsg(a, true); }).join('') ||
      '<div class="muted">No alerts above the model score threshold (' + minScore + ') yet. Formula: methods.html.</div>';
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
  }

  /* ---------- main table ---------- */
  function rowsFor() {
    return S.list.map(function (t) { return S.watch[t]; })
      .filter(function (m) { return m && (!S.topic || m._topic === S.topic); })
      .sort(function (a, b) {
        var av = (Number(a.volume_24h_fp) || 0) * (Number(a.last_price_dollars) || 0);
        var bv = (Number(b.volume_24h_fp) || 0) * (Number(b.last_price_dollars) || 0);
        return bv - av;
      });
  }
  function renderTable() {
    var tb = $('#kx-rows'); if (!tb) return;
    var rows = rowsFor().slice(0, 120);
    $('#kx-count') && ($('#kx-count').textContent = rows.length + ' shown · watchlist ' + S.list.length);
    tb.innerHTML = rows.map(function (m) {
      var h = S.history[m.ticker] || [];
      var prev = h.length > 1 ? (h[h.length - 2].last !== null ? h[h.length - 2].last : h[h.length - 2].bid) : null;
      var cur = h.length ? (h[h.length - 1].last !== null ? h[h.length - 1].last : h[h.length - 1].bid) : null;
      var d = (prev !== null && cur !== null) ? Math.round((cur - prev) * 1000) / 1000 : null;
      var dHtml = d === null ? '<span class="flat">—</span>' :
        '<span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') + '">' + (d > 0 ? '+' : '') + d.toFixed(2) + '</span>';
      var close = m.close_time ? new Date(m.close_time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return '<tr data-t="' + esc(m.ticker) + '" class="' + (m.ticker === S.selected ? 'sel' : '') + '">' +
        '<td><a href="' + esc(kalshiEventUrl(m.event_ticker)) + '" target="_blank" rel="noopener">' + esc(m.title || m.ticker) + '</a>' +
        '<br><small class="muted">' + esc(m.event_ticker) + ' · ' + esc(M.topicById(m._topic) ? M.topicById(m._topic).label : 'other') + '</small></td>' +
        '<td>' + esc(cents(m.yes_bid_dollars)) + '</td>' +
        '<td>' + esc(cents(m.yes_ask_dollars)) + '</td>' +
        '<td>' + esc(cents(m.last_price_dollars)) + '</td>' +
        '<td>' + dHtml + '</td>' +
        '<td>' + esc(fmtK(m.volume_fp || m.volume)) + '</td>' +
        '<td>' + esc(fmtK(m.volume_24h_fp || m.volume_24h)) + '</td>' +
        '<td>' + (isFinite(Number(m.volume_fp)) && isFinite(Number(m.last_price_dollars)) ? '$' + fmtK(Number(m.volume_fp) * Number(m.last_price_dollars)) : '') + '</td>' +
        '<td>' + esc(fmtK(m.open_interest_fp || m.open_interest)) + '</td>' +
        '<td class="muted">' + esc(close) + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="10" class="muted">No markets in scope yet — discovery is running, or live API is unreachable (snapshot mode shows data/ rows on the Data page).</td></tr>';
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
    $('#kx-chart-name') && ($('#kx-chart-name').textContent = ticker);
    pollBook(); fetchCandles(); renderTable(); renderBook();
  }

  /* ---------- orderbook panel ---------- */
  function renderBook() {
    var box = $('#kx-book'); if (!box) return;
    if (!S.selected) { box.innerHTML = '<div class="muted">Click a market row to load its order book.</div>'; return; }
    var v = bookViews();
    function levels(arr, cls) {
      return arr.slice(-6).reverse().map(function (x) {
        return '<tr><td>' + money(x.p) + '</td><td>' + fmtN(x.q) + '</td>' +
          '<td style="width:38%"><div class="bar ' + (cls || '') + '" style="width:' + Math.min(100, x.q / 10) + '%"></div></td></tr>';
      }).join('') || '<tr><td colspan="3" class="muted">empty</td></tr>';
    }
    box.innerHTML =
      '<h3 class="spread">' + esc(S.selected) + '<span class="muted small"> book polled every ' + (CFG.bookPollMs / 1000) + 's</span></h3>' +
      '<table class="ladder"><thead><tr><th>YES ask*</th><th>Contracts</th><th></th></tr></thead><tbody>' + levels(v.ya) + '</tbody></table>' +
      '<table class="ladder"><thead><tr><th>YES bid</th><th>Contracts</th><th></th></tr></thead><tbody>' + levels(v.yb) + '</tbody></table>' +
      '<p class="muted small">*Asks are derived (YES ask = $1.00 − NO bid; official reciprocal rule). ' +
      'Computed bid-side liquidity: YES <b>' + money(v.liqY) + '</b> · NO <b>' + money(v.liqN) + '</b> · total <b>' + money(v.liqY + v.liqN) + '</b>. ' +
      'Empty book = no resting orders (official behavior).</p>';
  }

  /* ---------- resolved strip ---------- */
  function renderResolved() {
    var box = $('#kx-resolved'); if (!box) return;
    var keys = Object.keys(M.state.resolved).slice(-10).reverse();
    box.innerHTML = keys.map(function (t) {
      var r = M.state.resolved[t];
      return '<tr><td><a href="' + esc(kalshiEventUrl(r.event)) + '" target="_blank" rel="noopener">' + esc(r.title || t) + '</a></td>' +
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
    ['index.html', 'Home'], ['dashboard.html', 'Dashboard'], ['trades.html', 'Strategy lab'],
    ['topics/gas-prices.html', 'Gas'], ['topics/elections.html', 'Elections'], ['topics/culture.html', 'Culture'],
    ['topics/crypto.html', 'Crypto'], ['topics/golf.html', 'Golf'],
    ['data.html', 'Data'], ['methods.html', 'Methods'], ['flagged.html', 'Flagged'], ['sources.html', 'Sources']
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
      '<th>Event</th><th>YES bid</th><th>YES ask</th><th>Last</th><th>\u0394 sample</th><th>Vol</th><th>24h vol</th><th>Est 24h $</th><th>Open int.</th><th>Closes</th>' +
      '</tr></thead><tbody id="kx-rows"></tbody></table></div>' +
      '<p class="muted small">Ranked by estimated 24h traded notional (contracts \u00d7 last price — computed, not exchange-published; blank when the market reports no volume). \u0394 sample = change vs the previous poll sample.</p></div>' +
      '<div class="box"><div class="row spread"><h2>Price chart</h2><span class="muted small" id="kx-chart-name">—</span></div>' +
      '<div class="chartbox"><canvas id="kx-chart"></canvas></div>' +
      '<p class="muted small" id="kx-chart-note"></p>' +
      '<div id="kx-book"></div></div></div>' +
      '<div class="grid2" style="margin-top:14px">' +
      '<div class="box"><div class="row spread"><h2>\u226510\u00a2 alerts · all in-scope events</h2><span class="muted small">newest at bottom</span></div>' +
      '<div class="chatbox" id="kx-chat-all"></div></div>' +
      '<div class="box"><div class="row spread"><h2>Model picks · high-ROI screen</h2><span class="muted small">score \u2265 threshold</span></div>' +
      '<div class="chatbox" id="kx-chat-model"></div></div></div>' +
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

    renderChats(); renderTable(); renderKPIs(); renderResolved(); renderBook(); renderStatus();
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
          '<td><a href="' + esc(kalshiEventUrl(t.event_ticker)) + '" target="_blank" rel="noopener">' + esc(t.title || t.ticker) + '</a><br><small class="muted">' + esc(t.ticker) + '</small></td>' +
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
    var x = box.getContext('2d'); x.scale(dpr, dpr);
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
      '<p class="notice blue small">Automated <b>paper</b> trading: when the bot is ON it evaluates the documented strategies every poll cycle against live demo quotes and records local-only fills. No orders are sent to Kalshi; nothing here can touch a real or demo account. Fees are excluded (schedule unverified — see Flagged).</p>' +
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
      '<p class="muted small">Fees: <b>' + (M.state.bot.fees ? 'ON (UNVERIFIED 7% quadratic)' : 'OFF') + '</b> — toggle below. Strategy parameters are fixed defaults documented in Methods.</p>' +
      '<button id="kx-fees">Toggle fees (unverified)</button>' +
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
    var topic = (node.getAttribute('data-topic') || location.search.match(/topic=([a-z-]+)/) || [null, ''])[1] || '';
    if (page === 'trades') mountTrades(node);
    else mountDashboard(node, { topic: topic, compact: !!node.getAttribute('data-topic'), root: node.getAttribute('data-root') || '' });
  }
  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pollWatch(); drawChart(); } });

  return {
    state: S, select: select, renderTrades: renderTrades, drawChart: drawChart,
    CFG: CFG
  };
})();
