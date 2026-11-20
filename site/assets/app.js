/* Kalshi demo monitor — static site logic (vanilla JS, no build step).
 * Snapshot data: data/*.json (rebuilt by scripts/build_site.py).
 * Live data: public, unauthenticated GET endpoints of the official Kalshi demo Trade API
 * (https://docs.kalshi.com/getting_started/api_environments). No credentials are used or stored.
 */
(() => {
  'use strict';
  const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const usd = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : '$' + Number(v).toFixed(d));
  const money = (v) => (v == null || Number.isNaN(v) ? '—' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const num = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
  const utc = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; };
  const hhmmss = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJSON(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }
  async function liveGET(path, params) {
    const u = new URL(API + path);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { cache: 'no-store' });
    if (r.status === 429) { const e = new Error('rate limited'); e.code = 429; throw e; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  function pill(el, cls, text) { el.className = 'pill ' + (cls || ''); el.textContent = text; }

  /* ---------- Home ---------- */
  async function homePage() {
    const meta = await getJSON('data/meta.json');
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    const total = Object.values(meta.open_by_topic_total || {}).reduce((a, b) => a + b, 0);
    $('hOpen').textContent = num(total);
    $('hResolved').textContent = num(meta.resolved_rows);
    $('hYes').textContent = num(meta.resolved_yes);
    $('hNo').textContent = num(meta.resolved_no);
    $('hMoves').textContent = num(meta.moves_count);
    $('hFlags').textContent = num(meta.flags_count);
    $('hUpdated').textContent = utc(meta.generated_at);
    const cards = $('topicCards');
    if (cards) {
      cards.innerHTML = (meta.topics || []).map((t) => `
        <a class="card topiccard" href="${esc(t.id)}.html">
          <small>${esc(t.label)}</small>
          <strong>${num(meta.open_by_topic_total[t.id])}</strong>
          <span class="muted small">open markets · ${num(meta.rows_written[t.id])} listed</span>
          <p class="small">${esc(t.description)}</p></a>`).join('');
    }
  }

  /* ---------- Table helpers ---------- */
  function sortRows(rows, key) {
    const by = {
      est: (r) => r.est_24h_usd ?? -1,
      vol: (r) => r.volume_24h_contracts ?? -1,
      oi: (r) => r.open_interest_contracts ?? -1,
      close: (r) => (r.close_time ? -Date.parse(r.close_time) : -Infinity),
      chg: (r) => (r.last != null && r.prev_last != null ? Math.abs(r.last - r.prev_last) : -1),
    }[key] || ((r) => r.est_24h_usd ?? -1);
    return rows.slice().sort((a, b) => by(b) - by(a));
  }

  /* ---------- Topic page (live) ---------- */
  async function topicPage(topicId) {
    const [meta, data, movesDoc, bookDoc] = await Promise.all([
      getJSON('data/meta.json'), getJSON(`data/topic-${topicId}.json`),
      getJSON('data/moves.json'), getJSON('data/orderbook.json'),
    ]);
    const rowsAll = data.rows || [];
    const byTicker = Object.fromEntries(rowsAll.map((r) => [r.ticker, r]));
    const books = bookDoc.books || {};
    const moves = (movesDoc.moves || []).filter((m) => m.topic === topicId);
    const live = {};            // ticker -> latest live market object (official API)
    let shown = 100, sel = null, selSeries = null, samples = [], liveOk = null, refreshTimer = null, obTimer = null, selTimer = null;
    const candleCache = {};
    $('openTotal').textContent = num(data.open_total_in_topic);
    $('snapshot').textContent = utc(data.generated_at);
    $('moveCount').textContent = num(moves.length);
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;

    function merged(r) {
      const l = live[r.ticker];
      if (!l) return { ...r, _live: false };
      return {
        ...r, _live: true, status: l.status || r.status, result: l.result ?? r.result,
        last: toNum(l.last_price_dollars) ?? r.last, yes_bid: toNum(l.yes_bid_dollars) ?? r.yes_bid,
        yes_ask: toNum(l.yes_ask_dollars) ?? r.yes_ask, volume_24h_contracts: toNum(l.volume_24h_fp) ?? r.volume_24h_contracts,
        open_interest_contracts: toNum(l.open_interest_fp) ?? r.open_interest_contracts,
        est_24h_usd: (toNum(l.volume_24h_fp) != null && toNum(l.last_price_dollars) != null) ? toNum(l.volume_24h_fp) * toNum(l.last_price_dollars) : r.est_24h_usd,
        _liveAt: r._liveAt,
      };
    }

    function filtered() {
      const q = $('search').value.trim().toLowerCase();
      let rows = rowsAll.map(merged);
      if (q) rows = rows.filter((r) => `${r.title} ${r.ticker} ${r.outcome} ${r.event_ticker}`.toLowerCase().includes(q));
      if ($('onlyDetail').checked) rows = rows.filter((r) => books[r.ticker]);
      return sortRows(rows, $('sortBy').value);
    }

    function render() {
      const all = filtered();
      const view = all.slice(0, shown);
      $('rowCount').textContent = `${num(view.length)} of ${num(all.length)}`;
      $('rows').innerHTML = view.map((r) => {
        const d = r.last != null && r.prev_last != null ? r.last - r.prev_last : null;
        const cls = d == null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : '';
        const badge = r.status === 'finalized' || r.result ? `<span class="badge ${esc(r.result)}">${r.result ? 'Resolved: ' + esc(r.result.toUpperCase()) : 'Settled'}</span>` : (r._live ? '<span class="badge live">live</span>' : '');
        return `<tr data-ticker="${esc(r.ticker)}" class="${sel === r.ticker ? 'sel' : ''}">
          <td class="title">${esc(r.title || '(title not in API response)')}<br><span class="muted small">${esc(r.outcome)}</span> ${badge}</td>
          <td class="tick">${esc(r.ticker)}</td>
          <td class="num">${usd(r.last)}</td><td class="num">${usd(r.yes_bid)}</td><td class="num">${usd(r.yes_ask)}</td>
          <td class="num ${cls}">${d == null ? '—' : (d > 0 ? '+' : '') + usd(d)}</td>
          <td class="num">${num(r.volume_24h_contracts)}</td><td class="num">${money(r.est_24h_usd)}</td>
          <td class="num">${num(r.open_interest_contracts)}</td><td>${utc(r.close_time)}</td>
          <td class="small"><a href="${esc(r.source_api)}" target="_blank" rel="noopener">API</a>${r.source_terms ? ` · <a href="${esc(r.source_terms)}" target="_blank" rel="noopener">terms</a>` : ''}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="11" class="muted">No rows match.</td></tr>';
      $('moreBtn').style.display = all.length > shown ? '' : 'none';
      $('tableNote').textContent = `Showing ${num(view.length)} of ${num(all.length)} matching rows in this snapshot (${num(data.open_total_in_topic)} open in topic). Rows marked "live" were refreshed from the official API in this browser session.`;
    }

    /* live refresh of the displayed rows (batch of up to 25 tickers per request) */
    async function refreshVisible() {
      const tickers = filtered().slice(0, shown).map((r) => r.ticker);
      const stamp = Date.now();
      try {
        for (let i = 0; i < tickers.length; i += 25) {
          const chunk = tickers.slice(i, i + 25);
          const d = await liveGET('/markets', { tickers: chunk.join(',') });
          (d.markets || []).forEach((m) => { live[m.ticker] = m; if (byTicker[m.ticker]) byTicker[m.ticker]._liveAt = stamp; });
          await sleep(400);
        }
        liveOk = Date.now();
        pill($('liveState'), 'ok', 'Live · updated ' + hhmmss(liveOk));
        $('liveNote').textContent = 'Live refresh active (public API)';
        render(); checkSelected();
      } catch (e) {
        if (e.code === 429) { pill($('liveState'), 'warn', 'Paused · API rate limit'); $('liveNote').textContent = 'Rate-limited; retrying later'; }
        else { pill($('liveState'), 'bad', 'Live feed unavailable · snapshot shown'); $('liveNote').textContent = 'Snapshot only'; }
      }
    }

    /* selected market: live price + order book every 5 s */
    async function pollSelected() {
      if (!sel) return;
      const t = sel;
      try {
        const d = await liveGET(`/markets/${encodeURIComponent(t)}`);
        const m = d.market || d;
        if (m && m.ticker) { live[t] = m; const last = toNum(m.last_price_dollars); if (last != null) samples.push({ t: Date.now(), p: last }); if (samples.length > 2000) samples = samples.slice(-2000); }
        const ob = await liveGET(`/markets/${encodeURIComponent(t)}/orderbook`);
        renderBook(ob);
        render(); checkSelected();
      } catch (e) { /* ignore single failures; banner handled by refreshVisible */ }
    }

    function renderBook(ob) {
      const book = (ob && (ob.orderbook_fp || ob.orderbook)) || {};
      const yes = (book.yes_dollars || []).map(([p, q]) => ({ p: Number(p), q: Number(q) })).sort((a, b) => b.p - a.p);
      const no = (book.no_dollars || []).map(([p, q]) => ({ p: Number(p), q: Number(q) })).sort((a, b) => b.p - a.p);
      const bestYes = yes[0] ? yes[0].p : null;
      const bestNo = no[0] ? no[0].p : null;
      const yesAsk = bestNo != null ? 1 - bestNo : null;
      const yTot = yes.reduce((s, x) => s + x.q, 0), nTot = no.reduce((s, x) => s + x.q, 0);
      $('obSummary').innerHTML = `Best YES bid ${usd(bestYes)} · implied best YES ask ${usd(yesAsk)} · YES bid contracts ${num(yTot, 2)} · NO bid contracts ${num(nTot, 2)} <span class="muted">(${utc(new Date().toISOString())})</span>`;
      $('obYes').innerHTML = yes.slice(0, 15).map((x) => `<tr><td>${usd(x.p, 4)}</td><td class="num">${num(x.q, 2)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No resting YES bids</td></tr>';
      $('obNo').innerHTML = no.slice(0, 15).map((x) => `<tr><td>${usd(1 - x.p, 4)}</td><td class="num">${num(x.q, 2)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No resting NO bids</td></tr>';
    }

    function checkSelected() {
      if (!sel) return;
      const r = merged(byTicker[sel] || {});
      const resolved = r.status === 'finalized' || r.status === 'determined' || (r.result === 'yes' || r.result === 'no');
      $('dResolved').innerHTML = resolved
        ? `<span class="badge ${esc(r.result)}">Resolved: ${esc((r.result || 'pending').toUpperCase())}</span> status ${esc(r.status)}`
        : `<span class="badge live">Open or not yet settled</span> status ${esc(r.status || '—')}`;
    }

    /* chart */
    function drawChart(points, rangeLabel) {
      const svg = $('chart');
      const W = 640, H = 260, L = 46, R = 12, T = 12, B = 30;
      if (!points.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#5d6b75">No trades / quotes for this range</text>`; $('chartNote').textContent = rangeLabel; return; }
      const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
      const xs = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
      const ys = (p) => T + (1 - p) * (H - T - B);
      let g = '';
      [0, 0.25, 0.5, 0.75, 1].forEach((v) => { const y = ys(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e5ebee"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#5d6b75">$${v.toFixed(2)}</text>`; });
      [0, 0.33, 0.66, 1].forEach((f) => { const t = t0 + f * (t1 - t0); const x = xs(t); g += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#5d6b75">${esc(fmtTick(t, rangeLabel))}</text>`; });
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs(p.t).toFixed(1)},${ys(p.p).toFixed(1)}`).join(' ');
      svg.innerHTML = `${g}<path d="${d}" fill="none" stroke="#0b7a57" stroke-width="2"/>` + points.slice(-1).map((p) => `<circle cx="${xs(p.t)}" cy="${ys(p.p)}" r="3.5" fill="#0a5ea8"/>`).join('');
      $('chartNote').textContent = `${points.length} points · Y = last traded YES price (USD) · X = time (UTC)`;
    }
    function fmtTick(ms, label) {
      const d = new Date(ms);
      if (label.startsWith('live') || label.startsWith('1m')) return d.toISOString().slice(11, 16);
      if (label.startsWith('1h')) return d.toISOString().slice(5, 16).replace('T', ' ');
      return d.toISOString().slice(0, 10);
    }

    async function candles(range) {
      const series = byTicker[sel] ? byTicker[sel].series_ticker : null;
      if (!series) return [];
      const key = `${sel}|${range}`;
      const now = Math.floor(Date.now() / 1000);
      const spec = { '1m': [6 * 3600, 1], '1h': [7 * 86400, 60], '1d': [90 * 86400, 1440] }[range];
      if (!spec) return [];
      if (candleCache[key] && Date.now() - candleCache[key].at < 60000) return candleCache[key].pts;
      try {
        const d = await liveGET(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(sel)}/candlesticks`,
          { start_ts: now - spec[0], end_ts: now, period_interval: spec[1] });
        const pts = (d.candlesticks || []).filter((c) => c.price && c.price.close_dollars != null)
          .map((c) => ({ t: c.end_period_ts * 1000, p: Number(c.price.close_dollars) }));
        candleCache[key] = { at: Date.now(), pts };
        return pts;
      } catch (e) {
        $('chartNote').textContent = e.code === 429 ? 'Rate-limited; showing last drawn data' : 'Candlestick request failed (' + e.message + ')';
        return candleCache[key] ? candleCache[key].pts : [];
      }
    }

    async function drawSelected() {
      if (!sel) return;
      const range = $('range').value;
      const label = { live: 'live', '1m': '1m', '1h': '1h', '1d': '1d' }[range];
      if (range === 'live') {
        drawChart(samples.slice(-600), label + ' (samples polled every ~5 s while this page is open; not stored on the server)');
      } else {
        const pts = await candles(range);
        drawChart(pts, label + ' · official candlesticks (close of last traded YES price)');
      }
    }

    function selectTicker(t) {
      sel = t; samples = [];
      const r = byTicker[t];
      $('detailEmpty').hidden = true; $('detail').hidden = false;
      $('dTitle').textContent = r.title || t;
      $('dApi').href = r.source_api; $('dTerms').href = r.source_terms || '#';
      $('dTerms').style.display = r.source_terms ? '' : 'none';
      const mv = moves.filter((m) => m.ticker === t).slice(0, 10);
      $('dMoves').innerHTML = mv.length ? mv.map((m) => `<li>${utc(new Date(m.to_t * 1000).toISOString())} · ${esc(m.granularity)} · ${usd(m.from_price)} → ${usd(m.to_price)} (${m.change > 0 ? '+' : ''}${usd(m.change)}) · <span class="muted">cause not verified</span> · <a href="${esc(m.source_api)}" target="_blank" rel="noopener">API</a></li>`).join('') : '<li class="muted">No move of $0.10 or more recorded in this snapshot.</li>';
      if (books[t]) renderBook({ orderbook_fp: { yes_dollars: books[t].yes_levels.map((l) => [String(l.price), String(l.contracts)]), no_dollars: books[t].no_levels.map((l) => [String(l.price), String(l.contracts)]) } });
      else $('obSummary').textContent = 'Order book is loaded live for the top markets; this market is outside the snapshot detail set. Live refresh will fill it in.';
      checkSelected(); render(); drawSelected();
      clearInterval(selTimer); clearInterval(obTimer);
      selTimer = setInterval(pollSelected, 5000); pollSelected();
    }

    /* events */
    $('rows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-ticker]'); if (tr) selectTicker(tr.dataset.ticker); });
    ['search', 'sortBy', 'onlyDetail'].forEach((id) => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { shown = 100; render(); }));
    $('moreBtn').addEventListener('click', () => { shown += 100; render(); });
    $('range').addEventListener('change', () => drawSelected());

    render();
    refreshVisible();
    refreshTimer = setInterval(refreshVisible, 60000);
    if (rowsAll[0]) selectTicker(rowsAll[0].ticker);
  }

  /* ---------- Resolved ---------- */
  async function resolvedPage() {
    const d = await getJSON('data/resolved.json');
    const meta = await getJSON('data/meta.json');
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    const rows = d.rows || [];
    const topics = [...new Set(rows.map((r) => r.topic))].sort();
    $('rtopic').innerHTML = '<option value="">All topics</option>' + topics.map((t) => `<option>${esc(t)}</option>`).join('');
    $('rsum').textContent = `${num(rows.length)} settled in the last ${d.window_days} days · YES ${num(rows.filter((r) => r.resolved_outcome === 'yes').length)} · NO ${num(rows.filter((r) => r.resolved_outcome === 'no').length)} · other/blank ${num(rows.filter((r) => !r.resolved_outcome).length)}`;
    function draw() {
      const q = $('rsearch').value.trim().toLowerCase(), tp = $('rtopic').value;
      const v = rows.filter((r) => (!tp || r.topic === tp) && (!q || `${r.title} ${r.ticker}`.toLowerCase().includes(q)));
      $('rrows').innerHTML = v.slice(0, 1000).map((r) => `<tr>
        <td class="title">${esc(r.title)}<br><span class="muted small">${esc(r.outcome)}</span></td>
        <td class="tick">${esc(r.ticker)}</td><td>${esc(r.topic)}</td>
        <td><span class="badge ${esc(r.resolved_outcome || '')}">${r.resolved_outcome ? r.resolved_outcome.toUpperCase() : esc(r.result || 'blank')}</span></td>
        <td>${utc(r.settlement_ts)}</td><td class="num">${usd(r.last)}</td><td class="num">${num(r.volume_total_contracts)}</td>
        <td class="small"><a href="${esc(r.source_api)}" target="_blank" rel="noopener">API</a>${r.source_terms ? ` · <a href="${esc(r.source_terms)}" target="_blank" rel="noopener">terms</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No settled markets in this window for these topics.</td></tr>';
      $('rnote').textContent = v.length > 1000 ? `Showing first 1,000 of ${num(v.length)}.` : `${num(v.length)} rows.`;
    }
    ['rsearch', 'rtopic'].forEach((id) => $(id).addEventListener('input', draw));
    draw();
  }

  /* ---------- Sharp moves ---------- */
  async function movesPage() {
    const d = await getJSON('data/moves.json');
    const meta = await getJSON('data/meta.json');
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    const moves = d.moves || [];
    const topics = [...new Set(moves.map((m) => m.topic))].sort();
    $('mtopic').innerHTML = '<option value="">All topics</option>' + topics.map((t) => `<option>${esc(t)}</option>`).join('');
    $('msum').textContent = `${num(moves.length)} moves of ≥ $${Number(d.threshold_usd).toFixed(2)} in either direction, from official candlesticks in the snapshot (1-minute over 6 h and 1-hour over 7 d, detailed markets only).`;
    function draw() {
      const tp = $('mtopic').value;
      const v = moves.filter((m) => !tp || m.topic === tp);
      $('mrows').innerHTML = v.slice(0, 500).map((m) => `<tr>
        <td>${utc(new Date(m.to_t * 1000).toISOString())}</td><td>${esc(m.topic)}</td>
        <td class="title">${esc(m.title)}<br><span class="tick">${esc(m.ticker)}</span></td>
        <td class="num">${usd(m.from_price)} → ${usd(m.to_price)}</td>
        <td class="num ${m.change > 0 ? 'up' : 'down'}">${m.change > 0 ? '+' : ''}${usd(m.change)}</td>
        <td>${esc(m.granularity)}</td>
        <td class="small">${(m.settlement_sources || []).filter((s) => s.url).slice(0, 4).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name || s.url)}</a>`).join('<br>') || '<span class="muted">none listed</span>'}</td>
        <td class="small"><span class="badge">cause not verified</span><br><a href="${esc(m.source_api)}" target="_blank" rel="noopener">API</a>${m.source_terms ? ` · <a href="${esc(m.source_terms)}" target="_blank" rel="noopener">terms</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No moves at this threshold in the snapshot.</td></tr>';
      $('mnote').textContent = v.length > 500 ? `Showing first 500 of ${num(v.length)}.` : `${num(v.length)} rows.`;
    }
    $('mtopic').addEventListener('change', draw);
    draw();
  }

  /* ---------- Strategy lab (simulation) ---------- */
  async function analysisPage() {
    const bt = await getJSON('data/backtest.json');
    const meta = await getJSON('data/meta.json');
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    if (!bt || !bt.strategies) { $('bt').innerHTML = '<p class="muted">Backtest not available in this snapshot.</p>'; return; }
    $('bmeta').textContent = `${num(bt.markets_considered)} resolved markets considered · ${num(bt.markets_with_candles)} with candles · ${num(bt.markets_skipped)} skipped · ${num(bt.trade_count)} simulated trades`;
    $('bmethod').textContent = bt.method;
    $('bstrat').innerHTML = Object.entries(bt.strategies).map(([k, v]) => `<tr><td class="tick">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    const sumRows = bt.summary || [];
    $('bsum').innerHTML = sumRows.map((r) => `<tr><td class="tick">${esc(r.strategy)}</td><td>${esc(r.topic)}</td><td class="num">${num(r.trades)}</td><td class="num">${(r.win_rate * 100).toFixed(1)}%</td><td class="num ${r.avg_pnl_per_contract >= 0 ? 'up' : 'down'}">${usd(r.avg_pnl_per_contract, 3)}</td><td class="num">${usd(r.total_pnl_per_contract, 2)}</td><td class="small">${esc(r.sample_flag)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No simulated trades met the rules in this snapshot.</td></tr>';
    const band = bt.by_band || [];
    $('bband').innerHTML = band.map((r) => `<tr><td class="tick">${esc(r.strategy)}</td><td>${esc(r.band)}</td><td class="num">${num(r.trades)}</td><td class="num">${(r.win_rate * 100).toFixed(1)}%</td><td class="num ${r.avg_pnl_per_contract >= 0 ? 'up' : 'down'}">${usd(r.avg_pnl_per_contract, 3)}</td><td class="small">${esc(r.sample_flag)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">—</td></tr>';
    const tr = bt.trades || [];
    $('btrades').innerHTML = tr.slice(0, 300).map((t) => `<tr><td class="tick">${esc(t.strategy)}</td><td>${esc(t.topic)}</td><td class="title">${esc(t.title)}<br><span class="tick">${esc(t.ticker)}</span></td><td>${utc(new Date(t.entry_t * 1000).toISOString())}</td><td class="num">${usd(t.entry_price, 2)}</td><td class="num">${usd(t.exit_value, 2)}</td><td class="num">${esc(t.outcome.toUpperCase())}</td><td class="num ${t.pnl_per_contract >= 0 ? 'up' : 'down'}">${usd(t.pnl_per_contract, 2)}</td><td class="small"><a href="${esc(t.source_api)}" target="_blank" rel="noopener">API</a></td></tr>`).join('') || '<tr><td colspan="9" class="muted">—</td></tr>';
  }

  /* ---------- Flagged for review ---------- */
  async function flaggedPage() {
    const d = await getJSON('data/flags.json');
    const meta = await getJSON('data/meta.json');
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    const flags = d.flags || [];
    $('fsum').textContent = `${num(flags.length)} automated flags in this build. Flags do not block publication; they need a human look.`;
    function draw() {
      const sev = $('fsev').value;
      const v = flags.filter((f) => !sev || f.severity === sev);
      $('frows').innerHTML = v.slice(0, 1000).map((f) => `<tr><td><span class="badge">${esc(f.severity)}</span></td><td>${esc(f.scope)}</td><td class="tick">${esc(f.entity)}</td><td>${esc(f.message)}</td><td class="small">${f.source_url ? `<a href="${esc(f.source_url)}" target="_blank" rel="noopener">official link</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No flags for this filter.</td></tr>';
    }
    $('fsev').addEventListener('change', draw);
    draw();
  }

  /* ---------- Sources ---------- */
  async function sourcesPage() {
    const d = await getJSON('data/sources.json');
    const meta = await getJSON('data/meta.json');
    $('footerNote').textContent = `Snapshot generated ${utc(meta.generated_at)}.`;
    $('liveState').textContent = 'Snapshot ' + utc(meta.generated_at);
    $('srows').innerHTML = (d.sources || []).map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.title)}</td><td class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></td><td class="small">${esc(s.checked)}</td><td class="small">${esc(s.verified)}</td><td class="small">${esc(s.notes)}</td></tr>`).join('');
  }

  /* ---------- Router ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.dataset.page || '';
    const topicMeta = document.querySelector('meta[name="topic"]');
    try {
      if (topicMeta) await topicPage(topicMeta.content);
      else if (page === 'index.html') await homePage();
      else if (page === 'resolved.html') await resolvedPage();
      else if (page === 'moves.html') await movesPage();
      else if (page === 'analysis.html') await analysisPage();
      else if (page === 'flagged.html') await flaggedPage();
      else if (page === 'sources.html') await sourcesPage();
    } catch (e) {
      const el = $('liveState');
      if (el) pill(el, 'bad', 'Error loading data');
      const note = $('footerNote');
      if (note) note.textContent = 'Error: ' + e.message;
      console.error(e);
    }
  });
})();
