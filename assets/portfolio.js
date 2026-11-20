/* Trade1 — portfolio page renderer.
 *
 * Reads data/portfolio.json (written by scripts/portfolio_engine.py on GitHub Actions) and renders
 * the persistent paper-trading ledger: equity curve, open positions, categorised performance, the
 * trade ledger itself, the >= $0.10 alert feed, resolutions and the watchlist.
 *
 * Live behaviour: while this tab is open the watchlist quotes are re-polled from the official public
 * demo endpoint every 20 s (unauthenticated market data only — never an account endpoint, never an
 * order). If the browser cannot reach the API, the page keeps showing the last committed snapshot and
 * says so. No framework, no build step, no external dependency.
 */
(function () {
  'use strict';

  var API = 'https://external-api.demo.kalshi.co/trade-api/v2';
  var DATA_URL = 'data/portfolio.json';
  var POLL_MS = 20000;
  var ARTIFACT_MS = 300000;

  var state = { doc: null, topic: '', strategy: '', live: false, liveErr: '', quotes: {}, sort: { key: 't', dir: -1 } };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '<span class="muted">—</span>';
    var n = Number(v);
    return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : 'muted') + '">' +
      (n < 0 ? '-' : n > 0 ? '+' : '') + '$' + Math.abs(n).toFixed(dp === undefined ? 2 : dp) + '</span>';
  }
  function plain(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '<span class="muted">—</span>';
    return '$' + Number(v).toFixed(dp === undefined ? 2 : dp);
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    var n = Number(v);
    return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : 'muted') + '">' + n.toFixed(1) + '%</span>';
  }
  function tstr(t) { return t ? String(t).replace('T', ' ').replace('Z', '') : ''; }
  function hhmm(t) {
    if (!t) return '';
    var d = new Date(t);
    return isNaN(d) ? '' : d.toISOString().slice(11, 19) + 'Z';
  }
  function mdhm(t) { var d = new Date(t); return isNaN(d) ? '' : d.toISOString().slice(5, 10) + ' ' + d.toISOString().slice(11, 16) + 'Z'; }
  function marketUrl(ticker) { return 'https://kalshi.com/markets/' + encodeURIComponent(String(ticker || '').toLowerCase()); }
  function eventUrl(ev) { return 'https://kalshi.com/markets/' + encodeURIComponent(String(ev || '').toLowerCase()); }
  function newsUrl(title) { return 'https://news.google.com/search?q=' + encodeURIComponent(title || '') + '&hl=en-US'; }
  function apiUrl(ticker) { return API + '/markets?tickers=' + encodeURIComponent(ticker || ''); }
  function srcLink(url, label) {
    if (!url) return '<span class="muted">no source recorded</span>';
    var external = /^https?:/.test(url);
    return '<a class="src" href="' + esc(url) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' +
      esc(label || 'source') + '</a>';
  }
  function table(cols, rows, empty) {
    if (!rows.length) return '<p class="muted small">' + esc(empty || 'Nothing yet.') + '</p>';
    var h = '<table><thead><tr>' + cols.map(function (c) {
      return '<th data-k="' + esc(c.k || '') + '"' + (c.sortable ? ' class="sortable"' : '') + '>' + esc(c.label) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    var b = rows.map(function (r) {
      return '<tr>' + cols.map(function (c) { return '<td>' + c.render(r) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return h + b + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- data loading */
  function loadArtifact(cb) {
    fetch(DATA_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { state.doc = j || state.doc; cb(); })
      .catch(function () { cb(); });
  }

  function tickersOf(rows) {
    var out = [], seen = {};
    (rows || []).forEach(function (r) { if (r.ticker && !seen[r.ticker]) { seen[r.ticker] = 1; out.push(r.ticker); } });
    return out;
  }

  function pollLive() {
    if (!state.doc || !state.doc.watchlist) return;
    var tk = tickersOf(state.doc.watchlist).slice(0, 120);
    if (!tk.length) return;
    var chunks = [];
    for (var i = 0; i < tk.length; i += 60) chunks.push(tk.slice(i, i + 60));
    Promise.all(chunks.map(function (c) {
      return fetch(API + '/markets?tickers=' + encodeURIComponent(c.join(',')), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); });
    })).then(function (parts) {
      var all = [];
      parts.forEach(function (p) { all = all.concat((p && p.markets) || []); });
      if (!all.length) throw new Error('empty response');
      state.quotes = {};
      all.forEach(function (m) { if (m.ticker) state.quotes[m.ticker] = m; });
      state.live = true; state.liveErr = '';
      renderWatchlist(); renderStatus();
    }).catch(function (e) {
      state.live = false;
      state.liveErr = (e && e.message) || 'unreachable';
      renderWatchlist(); renderStatus();
    });
  }

  /* ---------------------------------------------------------------- sections */
  function renderStatus() {
    var d = state.doc, pill = $('#pf-status'), meta = $('#pf-meta'), note = $('#pf-note');
    if (!d) { pill.className = 'pill bad'; pill.textContent = 'ledger not available'; return; }
    var s = String(d.status || '');
    pill.className = 'pill' + (s === 'live' ? '' : s === 'degraded' ? ' bad' : ' warn');
    pill.textContent = s === 'live' ? 'ledger live' : s === 'baseline' ? 'baseline (first cycle pending)'
      : s === 'offline-replay' ? 'offline replay' : s === 'degraded' ? 'degraded (API returned nothing)' : s;
    meta.textContent = ' last run ' + tstr(d.generated_at) + ' · watchlist ' + (d.watchlist_size || 0) +
      ' markets · ' + (d.trades ? d.trades.length : 0) + ' ledger rows · ' + (d.alerts ? d.alerts.length : 0) + ' alerts';
    if (d.note) note.textContent = 'Engine note: ' + d.note;
    var live = $('#pf-live-note');
    if (live) live.textContent = state.live ? 'live quotes via GET /markets?tickers=… (this tab, every 20 s)'
      : 'snapshot quotes' + (state.liveErr ? ' — live poll failed: ' + state.liveErr : '');
  }

  function renderKpis() {
    var s = (state.doc && state.doc.summary) || {};
    var cards = [
      ['Equity', plain(s.equity_usd), 'cash + open positions at the bid'],
      ['Cash', plain(s.cash_usd), 'of the $1,000.00 paper bankroll'],
      ['Realised P&L', usd(s.realised_pnl_usd), s.realised ? s.realised + ' closed trades' : 'nothing closed yet'],
      ['Return on bankroll', pct(s.return_on_bankroll_pct), 'equity vs. start'],
      ['ROI on cost', pct(s.roi_pct), 'realised P&L ÷ cost'],
      ['Win rate', pct(s.win_rate_pct), (s.wins || 0) + 'W / ' + (s.losses || 0) + 'L / ' + (s.flat || 0) + 'E'],
      ['Open positions', String(s.open === undefined ? '—' : s.open) + ' / ' + ((state.doc.engine || {}).max_open_positions || 8), 'marked at the official bid'],
      ['Max drawdown', usd(s.max_drawdown_usd), 'peak-to-trough on the curve']
    ];
    $('#pf-kpis').innerHTML = cards.map(function (c) {
      return '<div class="card"><small>' + esc(c[0]) + '</small><strong>' + c[1] + '</strong>' +
        '<small>' + esc(c[2]) + '</small></div>';
    }).join('');
  }

  function filtered(list) {
    return (list || []).filter(function (r) {
      if (state.topic && r.topic !== state.topic) return false;
      if (state.strategy && r.strategy && r.strategy !== state.strategy) return false;
      if (state.strategy && !r.strategy && list === state.doc.trades) return false;
      return true;
    });
  }

  function renderPositions() {
    var rows = filtered((state.doc.positions || []).slice().reverse());
    var cols = [
      { label: 'Market', render: function (r) { return '<a href="' + esc(marketUrl(r.ticker)) + '" target="_blank" rel="noopener">' + esc(cleanTitle(r.title) || r.ticker) + '</a><br><span class="muted small">' + esc(r.ticker) + ' · ' + esc(r.topic || '') + '</span>'; } },
      { label: 'Strategy', render: function (r) { return '<span class="badge">' + esc(r.strategy) + '</span>'; } },
      { label: 'Side', render: function (r) { return '<b class="' + (r.side === 'yes' ? 'up' : 'down') + '">' + esc((r.side || '').toUpperCase()) + '</b>'; } },
      { label: 'Qty', render: function (r) { return esc(r.qty_contracts); } },
      { label: 'Entry', render: function (r) { return plain(r.entry_usd, 4); } },
      { label: 'Mark (bid)', render: function (r) { return plain(r.mark_usd, 4); } },
      { label: 'Unrealised', render: function (r) { return usd(r.pnl_usd); } },
      { label: 'Opened', render: function (r) { return '<span class="small">' + esc(mdhm(r.t)) + '</span>'; } },
      { label: 'Row source', render: function (r) { return srcLink(r.source, 'fill quote') + ' · ' + srcLink(r.exit && r.exit.source, 'exit quote'); } }
    ];
    $('#pf-positions').innerHTML = table(cols, rows, 'No open paper positions. Entries appear when a market the engine watches moves ≥ $0.10 between two cycles, or a scan rule (breakout / harvest) fires.');
  }

  function cleanTitle(t) { return String(t || '').replace(/\*/g, ''); }

  function renderTrades() {
    var all = (state.doc.trades || []).slice();
    all.sort(function (a, b) {
      var k = state.sort.key, av = a[k], bv = b[k];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * state.sort.dir;
      return String(av).localeCompare(String(bv)) * state.sort.dir;
    });
    var rows = filtered(all).slice(0, 120);
    var cols = [
      { label: 'Market', sortable: true, k: 'ticker', render: function (r) { return '<a href="' + esc(marketUrl(r.ticker)) + '" target="_blank" rel="noopener">' + esc(cleanTitle(r.title) || r.ticker) + '</a><br><span class="muted small">' + esc(r.ticker) + '</span>'; } },
      { label: 'Topic', k: 'topic', sortable: true, render: function (r) { return esc(r.topic || '—'); } },
      { label: 'Strategy', k: 'strategy', sortable: true, render: function (r) { return '<span class="badge">' + esc(r.strategy) + '</span>'; } },
      { label: 'Side', render: function (r) { return esc((r.side || '').toUpperCase()); } },
      { label: 'Qty', render: function (r) { return esc(r.qty_contracts); } },
      { label: 'Entry', render: function (r) { return plain(r.entry_usd, 4); } },
      { label: 'Cost incl. fee', render: function (r) { return plain(r.cost_usd); } },
      { label: 'Status', k: 'status', sortable: true, render: function (r) {
        var cls = r.status === 'open' ? 'warn' : r.status === 'settled' ? 'up' : 'muted';
        return '<span class="' + (r.status === 'settled' ? 'up' : r.status === 'closed' ? 'muted' : 'flat') + '">' + esc(r.status) + '</span>' +
          (r.exit ? '<br><span class="muted small">' + esc(r.exit.reason) + ' @ ' + plain(r.exit.price_usd, 4) + '</span>' : ''); } },
      { label: 'P&L', k: 'pnl_usd', sortable: true, render: function (r) { return usd(r.pnl_usd); } },
      { label: 'Opened', k: 't', sortable: true, render: function (r) { return '<span class="small">' + esc(mdhm(r.t)) + '</span>'; } },
      { label: 'Why', render: function (r) { return '<span class="small muted">' + esc(r.note || '') + '</span>'; } },
      { label: 'Row source', render: function (r) { return srcLink(r.source, 'fill') + ' · ' + srcLink(r.exit && r.exit.source, 'exit') + '<br>' + srcLink(apiUrl(r.ticker), 'current quote'); } }
    ];
    $('#pf-ledger-note').textContent = 'showing ' + rows.length + ' of ' + all.length + ' ledger rows · click a header to sort';
    $('#pf-trades').innerHTML = table(cols, rows, 'No trades recorded yet. The engine needs at least two priced cycles before it can detect a ≥ $0.10 move.');
    Array.prototype.forEach.call(document.querySelectorAll('#pf-trades th.sortable'), function (th) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k'); if (!k) return;
        state.sort.dir = state.sort.key === k ? -state.sort.dir : -1;
        state.sort.key = k; renderTrades();
      });
    });
  }

  function perfCols(keyLabel, key) {
    return [
      { label: keyLabel, render: function (r) { return '<span class="badge">' + esc(r[key]) + '</span>'; } },
      { label: 'Trades', render: function (r) { return r.trades + ' (' + r.open + ' open)'; } },
      { label: 'W/L', render: function (r) { return r.wins + ' / ' + r.losses + (r.flat ? ' / ' + r.flat + ' flat' : ''); } },
      { label: 'Win %', render: function (r) { return pct(r.win_rate_pct); } },
      { label: 'P&L', render: function (r) { return usd(r.pnl_usd); } },
      { label: 'ROI', render: function (r) { return pct(r.roi_pct); } }
    ];
  }

  function renderPerf() {
    $('#pf-by-strategy').innerHTML = table(perfCols('Strategy', 'strategy'), state.doc.by_strategy || [],
      'No closed trades yet — ROI and win rate stay blank until a position is closed or settled (never estimated).');
    $('#pf-by-topic').innerHTML = table(perfCols('Topic', 'topic'), state.doc.by_topic || [],
      'No topic attribution yet.');
    var byExit = {};
    (state.doc.trades || []).forEach(function (t) {
      var k = t.status === 'open' ? 'still open' : ((t.exit && t.exit.reason) || 'closed');
      var b = byExit[k] || (byExit[k] = { reason: k, n: 0, pnl: 0 });
      b.n++; b.pnl += (t.pnl_usd || 0);
    });
    $('#pf-by-exit').innerHTML = table([
      { label: 'Exit reason', render: function (r) { return esc(r.reason); } },
      { label: 'Trades', render: function (r) { return String(r.n); } },
      { label: 'P&L', render: function (r) { return usd(r.pnl, 4); } }
    ], Object.keys(byExit).map(function (k) { return byExit[k]; }).sort(function (a, b) { return b.n - a.n; }),
      'No exits yet.');
  }

  function renderAlerts() {
    var box = $('#pf-alerts'); if (!box) return;
    var rows = filtered((state.doc.alerts || []).slice().reverse()).slice(0, 60).reverse();
    if (!rows.length) {
      box.innerHTML = '<div class="muted">No ≥ $0.10 moves captured yet — the engine compares one priced cycle against the next ' +
        '(about every 30 minutes). The <a href="dashboard.html">live dashboard</a> shows second-by-second alerts while your tab is open.</div>';
      return;
    }
    var stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = rows.map(function (a) {
      var arrow = a.dir === 'up' ? '▲' : '▼';
      return '<div class="msg ' + esc(a.dir) + (a.model_pick ? ' model' : '') + '">' +
        '<span class="time">' + esc(hhmm(a.t)) + '</span>' +
        '<b class="' + esc(a.dir) + '">' + arrow + ' ' + (a.delta_usd > 0 ? '+' : '') + Number(a.delta_usd).toFixed(4) + '</b> ' +
        '<a href="' + esc(eventUrl(a.event_ticker)) + '" target="_blank" rel="noopener">' + esc(cleanTitle(a.title) || a.ticker) + '</a> ' +
        '<span class="meta">' + plain(a.from_usd, 4) + ' → ' + plain(a.to_usd, 4) +
        (a.spread_usd !== null && a.spread_usd !== undefined ? ' · spread ' + Number(a.spread_usd).toFixed(2) : '') +
        (a.vol24_contracts !== null && a.vol24_contracts !== undefined ? ' · 24h ' + Number(a.vol24_contracts).toLocaleString() + 'c' : '') +
        ' · score ' + a.score + (a.model_pick ? ' · model pick' : '') + '</span>' +
        '<div class="links">' + srcLink(a.source, 'quote response') +
        ' · <a href="' + esc(newsUrl(cleanTitle(a.title))) + '" target="_blank" rel="noopener">news search (lead, not a cause)</a>' +
        ' · <a href="' + esc(marketUrl(a.ticker)) + '" target="_blank" rel="noopener">Kalshi market</a></div></div>';
    }).join('');
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function renderResolutions() {
    var rows = filtered((state.doc.resolutions || []).slice().reverse()).slice(0, 40);
    $('#pf-resolutions').innerHTML = table([
      { label: 'Market', render: function (r) { return '<a href="' + esc(eventUrl(r.event_ticker)) + '" target="_blank" rel="noopener">' + esc(cleanTitle(r.title) || r.ticker) + '</a>'; } },
      { label: 'Topic', render: function (r) { return esc(r.topic || '—'); } },
      { label: 'Resolved', render: function (r) { return '<b class="' + (r.result === 'yes' ? 'up' : 'down') + '">' + esc(String(r.result || '').toUpperCase()) + '</b>'; } },
      { label: 'Settlement time', render: function (r) { return '<span class="small">' + esc(tstr(r.settlement_ts) || '—') + '</span>'; } },
      { label: 'Logged', render: function (r) { return '<span class="small">' + esc(tstr(r.t)) + '</span>'; } },
      { label: 'Row source', render: function (r) { return srcLink(r.source, 'status+result'); } }
    ], rows, 'Nothing has settled yet in the current watchlist. Settlements are picked up from the same quote response — no extra request.');
  }

  function renderWatchlist() {
    var rows = filtered(state.doc.watchlist || []);
    var cols = [
      { label: 'Market', render: function (r) {
        var q = state.quotes[r.ticker] || {};
        return '<a href="' + esc(marketUrl(r.ticker)) + '" target="_blank" rel="noopener">' + esc(cleanTitle(q.title || r.title) || r.ticker) + '</a>' +
          '<br><span class="muted small">' + esc(r.ticker) + (r.event_ticker ? ' · ' + esc(r.event_ticker) : '') + '</span>'; } },
      { label: 'Topic', render: function (r) { return esc(r.topic); } },
      { label: 'Last', render: function (r) {
        var q = state.quotes[r.ticker] || {}; var v = (state.live && q.ticker) ? Number(q.last_price_dollars) : r.last_usd;
        return v === null || v === undefined || isNaN(v) ? '<span class="muted">—</span>' : '$' + v.toFixed(4); } },
      { label: 'YES bid', render: function (r) {
        var q = state.quotes[r.ticker] || {}; var v = (state.live && q.ticker) ? Number(q.yes_bid_dollars) : r.yes_bid_usd;
        return v === null || v === undefined || isNaN(v) ? '<span class="muted">—</span>' : '$' + v.toFixed(4); } },
      { label: 'YES ask', render: function (r) {
        var q = state.quotes[r.ticker] || {}; var v = (state.live && q.ticker) ? Number(q.yes_ask_dollars) : r.yes_ask_usd;
        return v === null || v === undefined || isNaN(v) ? '<span class="muted">—</span>' : '$' + v.toFixed(4); } },
      { label: 'Status', render: function (r) {
        var q = state.quotes[r.ticker] || {}; var s = (state.live && q.status) || r.status;
        var res = (state.live && q.result !== undefined ? q.result : r.result) || '';
        return esc(s || '—') + (res ? ' · <b class="' + (res === 'yes' ? 'up' : 'down') + '">' + esc(res.toUpperCase()) + '</b>' : ''); } },
      { label: 'Closes (UTC)', render: function (r) { return '<span class="small">' + esc(tstr(r.close_time) || '—') + '</span>'; } },
      { label: 'Samples', render: function (r) { return String(r.samples || 0); } },
      { label: 'Row source', render: function (r) { return srcLink(r.source, 'snapshot fetch') + ' · ' + srcLink(apiUrl(r.ticker), 'live'); } }
    ];
    $('#pf-watchlist').innerHTML = table(cols, rows, 'No watchlist yet — run the engine (seed mode) once the data pipeline has written data/topics/*.json.');
  }

  function renderRules() {
    var eng = (state.doc && state.doc.engine) || {};
    var rules = eng.rules || {};
    var rows = Object.keys(rules).map(function (k) {
      return { name: k, enter: rules[k].enter, exit: rules[k].exit };
    });
    $('#pf-rules').innerHTML = table([
      { label: 'Strategy', render: function (r) { return '<span class="badge">' + esc(r.name) + '</span>'; } },
      { label: 'Entry rule', render: function (r) { return '<span class="small">' + esc(r.enter) + '</span>'; } },
      { label: 'Exit rule', render: function (r) { return '<span class="small">' + esc(r.exit) + '</span>'; } }
    ], rows, 'No rules recorded in the artifact.');
    $('#pf-rules').insertAdjacentHTML('beforeend',
      '<p class="muted small">Sampling differs from the browser Strategy Lab on purpose: the CI engine compares one cycle with the next ' +
      '(~30 minutes apart), the lab samples every ~12 seconds while your tab is open. The lab keeps its trades in your browser only; ' +
      'this ledger is in the repository, so its sample grows every day.</p>');
  }

  function renderSettings() {
    var eng = (state.doc && state.doc.engine) || {};
    var src = (state.doc && state.doc.sources) || {};
    var rows = [
      ['Engine', esc(eng.name || '—') + ' v' + esc(eng.version || '?')],
      ['Starting bankroll', plain(eng.bankroll_start_usd)],
      ['Target cost per trade', plain(eng.per_trade_usd) + ' (fees included in the size)'],
      ['Max open positions', esc(eng.max_open_positions)],
      ['Alert threshold', plain(eng.alert_threshold_usd, 2) + ' sampled move, either direction'],
      ['Model score', esc(eng.score_formula || '') + ' → model pick at ≥ ' + esc(eng.min_model_score)],
      ['Fees', esc(eng.fee_rule || '')]
    ];
    var html = '<table><tbody>' + rows.map(function (r) {
      return '<tr><td class="muted small" style="width:150px">' + r[0] + '</td><td class="small">' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
    var docs = src.official_docs || {};
    html += '<p class="small" style="margin-top:10px">Endpoints used this run: ' +
      ((src.quote_endpoints || []).slice(0, 2).map(function (u) {
        return '<br><a class="src" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(String(u).slice(0, 110)) + '…</a>';
      }).join('') || '<span class="muted">none recorded</span>') + '</p>';
    html += '<p class="small">Watchlist built from: ' + ((src.watchlist_snapshot || []).map(function (p) {
      return '<a href="' + esc(p) + '">' + esc(String(p).split('/').pop()) + '</a>';
    }).join(' · ') || '—') + '</p>';
    html += '<p class="small">Official definitions: ' + Object.keys(docs).map(function (k) {
      return '<a href="' + esc(docs[k]) + '" target="_blank" rel="noopener">' + esc(k) + '</a>';
    }).join(' · ') + '</p>';
    html += '<p class="muted small">' + esc((state.doc && state.doc.disclaimer) || '') + '</p>';
    $('#pf-settings').innerHTML = html;
  }

  function renderRuns() {
    var rows = ((state.doc && state.doc.runs) || []).slice().reverse().slice(0, 24);
    $('#pf-runs').innerHTML = table([
      { label: 'Time', render: function (r) { return esc(tstr(r.t)); } },
      { label: 'Mode', render: function (r) { return esc(r.mode); } },
      { label: 'Quotes', render: function (r) { return String(r.quotes === undefined ? (r.watchlist || '—') : r.quotes); } },
      { label: 'Events', render: function (r) { return String(r.events === undefined ? '—' : r.events); } },
      { label: 'Requests', render: function (r) { return String(r.requests === undefined ? '—' : r.requests); } },
      { label: 'Degraded', render: function (r) { return r.degraded ? '<span class="flag">yes</span>' : 'no'; } },
      { label: 'Last log lines', render: function (r) { return '<span class="small muted">' + esc((r.log || []).join('  ')).slice(0, 160) + '</span>'; } }
    ], rows, 'No runs recorded yet.');
  }

  /* ---------------------------------------------------------------- equity chart */
  function renderEquity() {
    var host = $('#pf-equity'); if (!host) return;
    var pts = ((state.doc && state.doc.equity_curve) || []).filter(function (p) { return p && p.equity_usd !== null; });
    if (pts.length < 2) {
      host.innerHTML = '<p class="muted small">The curve needs at least two engine cycles. ' +
        (pts.length ? 'One point so far — next run in about 30 minutes.' : 'No points yet.') + '</p>';
      $('#pf-eq-note').textContent = '';
      return;
    }
    var W = Math.max(320, host.clientWidth || 760), H = 230, L = 54, R = 12, T = 12, B = 26;
    var t0 = new Date(pts[0].t).getTime(), t1 = new Date(pts[pts.length - 1].t).getTime();
    if (!isFinite(t0) || !isFinite(t1) || t1 === t0) t1 = t0 + 1;
    var vs = pts.map(function (p) { return p.equity_usd; });
    var v0 = Math.min.apply(null, vs), v1 = Math.max.apply(null, vs);
    if (v1 - v0 < 1) { var mid = (v1 + v0) / 2; v0 = mid - 0.5; v1 = mid + 0.5; }
    function px(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    function py(v) { return T + (1 - (v - v0) / (v1 - v0)) * (H - T - B); }
    var start = ((state.doc.engine || {}).bankroll_start_usd);
    var path = pts.map(function (p, i) {
      var t = new Date(p.t).getTime();
      return (i ? 'L' : 'M') + px(t).toFixed(1) + ' ' + py(p.equity_usd).toFixed(1);
    }).join(' ');
    var grid = '', i;
    for (i = 0; i <= 4; i++) {
      var vv = v0 + (v1 - v0) * i / 4, yy = py(vv);
      grid += '<line x1="' + L + '" y1="' + yy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + yy.toFixed(1) + '" stroke="#2a383b" stroke-opacity=".65"/>' +
        '<text x="6" y="' + (yy + 3.5).toFixed(1) + '" fill="#91a3a4" font-size="10">$' + vv.toFixed(2) + '</text>';
    }
    if (start !== null && start !== undefined && start >= v0 && start <= v1) {
      grid += '<line x1="' + L + '" y1="' + py(start).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(start).toFixed(1) +
        '" stroke="#f5bf69" stroke-dasharray="4 3" stroke-opacity=".8"/>' +
        '<text x="' + (W - R - 96) + '" y="' + (py(start) - 4).toFixed(1) + '" fill="#f5bf69" font-size="10">start $' + start.toFixed(2) + '</text>';
    }
    var xl = '';
    for (i = 0; i <= 3; i++) {
      var tt = t0 + (t1 - t0) * i / 3;
      xl += '<text x="' + Math.min(W - 60, Math.max(L, px(tt) - 24)).toFixed(0) + '" y="' + (H - 8) + '" fill="#91a3a4" font-size="10">' +
        esc(new Date(tt).toISOString().slice(5, 16).replace('T', ' ')) + '</text>';
    }
    var last = pts[pts.length - 1];
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
      'aria-label="Equity curve, last value ' + last.equity_usd + ' dollars">' + grid +
      '<path d="' + path + '" fill="none" stroke="#61d6a2" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + px(t1).toFixed(1) + '" cy="' + py(last.equity_usd).toFixed(1) + '" r="3.5" fill="#61d6a2"/>' +
      '<text x="' + Math.min(W - 70, px(t1) - 40).toFixed(0) + '" y="' + (py(last.equity_usd) - 8).toFixed(1) +
      '" fill="#61d6a2" font-size="11">$' + last.equity_usd.toFixed(2) + '</text>' + xl + '</svg>';
    $('#pf-eq-note').textContent = pts.length + ' cycles · ' + new Date(t0).toISOString().slice(0, 16) + ' → ' + new Date(t1).toISOString().slice(0, 16);
  }

  /* ---------------------------------------------------------------- wiring */
  function renderAll() {
    renderStatus(); renderKpis(); renderEquity(); renderPositions(); renderTrades();
    renderPerf(); renderAlerts(); renderResolutions(); renderWatchlist(); renderRules();
    renderSettings(); renderRuns();
  }

  function fillFilters() {
    var topics = {}, strats = {};
    (state.doc.trades || []).concat(state.doc.watchlist || []).forEach(function (r) { if (r.topic) topics[r.topic] = 1; });
    (state.doc.trades || []).forEach(function (r) { if (r.strategy) strats[r.strategy] = 1; });
    Object.keys(state.doc.engine && state.doc.engine.rules ? state.doc.engine.rules : {}).forEach(function (k) { strats[k] = 1; });
    ['#pf-topic', '#pf-strategy'].forEach(function (sel, i) {
      var box = $(sel), src = i ? strats : topics, cur = box.value;
      box.innerHTML = '<option value="">all</option>' + Object.keys(src).sort().map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
      }).join('');
      box.value = cur || '';
    });
  }

  function init() {
    if (!document.getElementById('pf-kpis')) return;
    loadArtifact(function first() {
      if (!state.doc) {
        $('#pf-status').className = 'pill bad';
        $('#pf-status').textContent = 'ledger not available';
        $('#pf-note').textContent = 'data/portfolio.json has not been written yet — it is created by the ' +
          '"CI paper-trading ledger" workflow and committed to main.';
        return;
      }
      fillFilters(); renderAll(); pollLive();
      setInterval(pollLive, POLL_MS);
      setInterval(function () {
        loadArtifact(function () { fillFilters(); renderAll(); });
      }, ARTIFACT_MS);
    });
    $('#pf-topic').addEventListener('change', function () { state.topic = this.value; renderAll(); });
    $('#pf-strategy').addEventListener('change', function () { state.strategy = this.value; renderAll(); });
    $('#pf-refresh').addEventListener('click', function () {
      this.textContent = 'refreshing…';
      var btn = this;
      loadArtifact(function () { fillFilters(); renderAll(); pollLive(); btn.textContent = 'Refresh'; });
    });
    window.addEventListener('resize', function () { renderEquity(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
