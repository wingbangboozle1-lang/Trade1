/* Kalshi DEMO dashboard — renders static pages from data/data.json (official API snapshot).
   All API strings are HTML-escaped before rendering. Missing values render as "—" (never inferred). */
(function () {
  "use strict";
  var DATA = null;
  var PAGE = document.body.getAttribute("data-page") || "index";
  var TOPIC = document.body.getAttribute("data-topic") || null;
  var TOPICS = [
    ["crypto", "Crypto", "crypto.html"],
    ["elections", "Elections", "elections.html"],
    ["culture", "Culture", "culture.html"],
    ["gas", "Gas prices", "gas.html"],
    ["golf", "Golf", "golf.html"]
  ];
  var OTHER = [
    ["resolved", "Resolved (YES/NO)", "resolved.html"],
    ["jumps", "Price jumps ≥ $0.10", "jumps.html"],
    ["strategies", "Simulated strategies", "strategies.html"],
    ["suggestions", "Live-site suggestions", "suggestions.html"],
    ["sources", "Sources & checks", "sources.html"],
    ["flagged", "Flagged for Review", "flagged.html"]
  ];

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function px(v) { return (v === null || v === undefined || isNaN(v)) ? "—" : "$" + Number(v).toFixed(2); }
  function cents(v) { return (v === null || v === undefined || isNaN(v)) ? "—" : Math.round(Number(v) * 100) + "¢"; }
  function num(v, d) { return (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d === undefined ? 0 : d }); }
  function dt(s) { return s ? esc(String(s).replace("T", " ").replace("Z", " UTC")) : "—"; }
  function ago(iso) {
    if (!iso) return "unknown";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 120) return mins + " min ago";
    return Math.round(mins / 60) + " h ago";
  }
  function link(url, label) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + "</a>" : "—"; }
  function badge(t, cls) { return '<span class="badge ' + (cls || "") + '">' + esc(t) + "</span>"; }

  function nav() {
    var h = '<header class="top"><span class="brand">Kalshi Demo Dashboard</span><nav>';
    h += '<a href="index.html"' + (PAGE === "index" ? ' class="active"' : "") + ">Home</a>";
    TOPICS.forEach(function (t) {
      h += '<a href="' + t[2] + '"' + (TOPIC === t[0] ? ' class="active"' : "") + ">" + t[1] + "</a>";
    });
    OTHER.forEach(function (t) {
      h += '<a href="' + t[2] + '"' + (PAGE === t[0] ? ' class="active"' : "") + ">" + t[1] + "</a>";
    });
    h += "</nav></header>";
    return h;
  }
  function footer() {
    return '<footer>Data: Kalshi <b>demo</b> API (' + esc(DATA ? DATA.api_base : "") + ') · snapshot ' +
      esc(DATA ? DATA.generated_at : "") + ' · Not financial advice. No real orders are placed. ' +
      '<a href="https://docs.kalshi.com/" target="_blank" rel="noopener">Kalshi API docs</a></footer>';
  }

  function marketRows(list, opts) {
    opts = opts || {};
    if (!list.length) return '<tr><td colspan="11" class="muted">No entries in this view.</td></tr>';
    return list.map(function (m) {
      var cls = opts.clickable ? ' class="clickable" data-ticker="' + esc(m.ticker) + '"' : "";
      var res = m.resolved || m.result === "yes" || m.result === "no";
      return "<tr" + cls + ">" +
        "<td>" + (m.event_title ? '<div class="small muted">' + esc(m.event_title) + "</div>" : "") + "<b>" + esc(m.title || m.ticker) + "</b>" +
        (m.yes_sub_title ? '<div class="small muted">YES: ' + esc(m.yes_sub_title) + "</div>" : "") + "</td>" +
        "<td>" + esc(m.topic ? (TOPIC_LABEL[m.topic] || m.topic) : "") + "</td>" +
        '<td class="num">' + px(m.yes_bid) + "</td>" +
        '<td class="num">' + px(m.yes_ask) + "</td>" +
        '<td class="num">' + px(m.last_price) + "</td>" +
        '<td class="num">' + num(m.volume_fp, 0) + "</td>" +
        '<td class="num">' + num(m.open_interest_fp, 0) + "</td>" +
        '<td class="num" title="Derived: volume × last price">' + (m.est_dollar_volume === null || m.est_dollar_volume === undefined ? "—" : "$" + num(m.est_dollar_volume, 0)) + "</td>" +
        "<td>" + dt(m.close_time) + "</td>" +
        "<td>" + (res ? badge((m.result || "").toUpperCase() || "RESOLVED", m.result === "yes" ? "yes" : m.result === "no" ? "no" : "") : badge(m.status || "—")) + "</td>" +
        "<td>" + link(m.source_url, "API record") + "</td>" +
        "</tr>";
    }).join("");
  }
  var TOPIC_LABEL = {};

  var MARKET_HEAD = "<tr><th>Market</th><th>Topic</th><th class='num'>YES bid</th><th class='num'>YES ask</th><th class='num'>Last</th><th class='num'>Volume (contracts)</th><th class='num'>Open interest</th><th class='num'>Est. $ volume*</th><th>Closes (UTC)</th><th>Status</th><th>Source</th></tr>";

  function loadData(cb) {
    fetch("data/data.json?t=" + Date.now()).then(function (r) { return r.json(); }).then(function (d) {
      DATA = d;
      (d.topics ? Object.keys(d.topics) : []).forEach(function (k) { TOPIC_LABEL[k] = d.topics[k]; });
      cb();
    }).catch(function (e) {
      document.getElementById("app").innerHTML = '<div class="note stale">Could not load data/data.json (' + esc(e.message) + ').</div>';
    });
  }

  function staleBanner() {
    if (!DATA) return "";
    var age = (Date.now() - new Date(DATA.generated_at).getTime()) / 3600000;
    if (age > 2) return '<div class="note stale">Data snapshot is ' + Math.round(age) + ' h old — the scheduled collector may be delayed. Check the Actions tab.</div>';
    return "";
  }

  /* ---------- Chart + liquidity ---------- */
  var PERIODS = {
    "1": { label: "Minutes (1-min candles)", lengths: [["1 h", 60], ["6 h", 360]], unit: 60 },
    "60": { label: "Hours (1-hour candles)", lengths: [["24 h", 24], ["7 d", 168]], unit: 3600 },
    "1440": { label: "Days (1-day candles)", lengths: [["30 d", 30], ["90 d", 90]], unit: 86400 }
  };
  var state = { ticker: null, period: "60", len: null, candles: null };

  function drawChart(m, candles, period, lenCount) {
    var box = document.getElementById("chart");
    if (!box) return;
    var rows = (candles && candles[period]) ? candles[period].filter(function (r) { return r && r[4] !== null; }) : [];
    var unit = PERIODS[period].unit;
    if (rows.length) {
      var last = rows[rows.length - 1][0];
      var first = last - lenCount * unit;
      rows = rows.filter(function (r) { return r[0] >= first; });
    }
    if (!rows.length) {
      box.innerHTML = '<div class="muted" style="padding:20px">No candles returned by the API for this window (no trades or market not yet captured).</div>';
      return;
    }
    var W = 900, H = 300, L = 56, R = 16, T = 14, B = 34;
    var t0 = rows[0][0], t1 = rows[rows.length - 1][0] || t0 + 1;
    var xs = function (t) { return L + (t - t0) / Math.max(1, (t1 - t0)) * (W - L - R); };
    var ys = function (p) { return T + (1 - p) * (H - T - B); };
    var path = rows.map(function (r, i) { return (i ? "L" : "M") + xs(r[0]).toFixed(1) + " " + ys(r[4]).toFixed(1); }).join(" ");
    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ys(g) + '" y2="' + ys(g) + '" stroke="#e2e8f0"/>';
      svg += '<text x="' + (L - 6) + '" y="' + (ys(g) + 4) + '" font-size="11" text-anchor="end" fill="#5b6b82">$' + g.toFixed(2) + "</text>";
    });
    for (var k = 0; k <= 4; k++) {
      var tt = t0 + (t1 - t0) * k / 4;
      var d = new Date(tt * 1000).toISOString().replace("T", " ").slice(0, period === "1440" ? 10 : 16);
      svg += '<text x="' + xs(tt) + '" y="' + (H - 10) + '" font-size="11" text-anchor="middle" fill="#5b6b82">' + d + "</text>";
    }
    svg += '<path d="' + path + '" fill="none" stroke="#0f766e" stroke-width="2"/>';
    svg += "</svg>";
    var lastP = rows[rows.length - 1][4];
    box.innerHTML = svg + '<div class="small muted">Y = last trade price per contract (YES) · X = candle end time (UTC) · ' +
      rows.length + " candles · latest $" + lastP.toFixed(2) + " · source: " +
      link(m.candles_source_url || m.source_url, "official candlesticks endpoint") + "</div>";
  }

  function renderControls(m) {
    var c = document.getElementById("controls");
    if (!c) return;
    var h = "";
    Object.keys(PERIODS).forEach(function (p) {
      h += '<button data-period="' + p + '" class="' + (state.period === p ? "on" : "") + '">' + PERIODS[p].label + "</button>";
    });
    h += "<span class='muted small' style='margin-left:8px'>Length:</span>";
    PERIODS[state.period].lengths.forEach(function (l) {
      h += '<button data-len="' + l[1] + '" class="' + (state.len === l[1] ? "on" : "") + '">' + l[0] + "</button>";
    });
    h += "<span class='small muted' style='margin-left:8px'>Seconds: not offered by the API (finest = 1 minute).</span>";
    c.innerHTML = h;
    Array.prototype.forEach.call(c.querySelectorAll("button[data-period]"), function (b) {
      b.onclick = function () { state.period = b.getAttribute("data-period"); state.len = PERIODS[state.period].lengths[0][1]; selectMarket(state.ticker); };
    });
    Array.prototype.forEach.call(c.querySelectorAll("button[data-len]"), function (b) {
      b.onclick = function () { state.len = Number(b.getAttribute("data-len")); renderControls(m); drawChart(m, state.candles, state.period, state.len); };
    });
  }

  function renderBook(m) {
    var el = document.getElementById("book");
    if (!el) return;
    var ob = m.orderbook;
    var q = '<div class="small muted">Quote (official, snapshot): YES bid ' + px(m.yes_bid) + " · YES ask " + px(m.yes_ask) +
      " · NO bid " + px(m.no_bid) + " · NO ask " + px(m.no_ask) + "</div>";
    if (!ob) {
      el.innerHTML = q + '<div class="muted" style="margin-top:8px">Orderbook not captured for this market in the last run (only top markets are pulled).</div>';
      return;
    }
    function tbl(levels, title) {
      var rows = (levels || []).slice(0, 15).map(function (l) {
        return "<tr><td class='num'>" + px(l.price) + "</td><td class='num'>" + num(l.contracts, 2) + "</td></tr>";
      }).join("") || "<tr><td colspan='2' class='muted'>No resting orders</td></tr>";
      return "<div style='flex:1;min-width:150px'><div class='small'><b>" + title + "</b></div><table><tr><th class='num'>Price</th><th class='num'>Contracts</th></tr>" + rows + "</table></div>";
    }
    el.innerHTML = q + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      tbl(ob.yes_bids, "YES bids (buy YES)") + tbl(ob.no_bids, "NO bids (buy NO)") + "</div>" +
      '<div class="small muted" style="margin-top:6px">Contracts resting at each price, from the official orderbook: ' +
      link(m.orderbook_source_url, "API orderbook") + "</div>";
  }

  function selectMarket(tk) {
    var m = DATA.markets.filter(function (x) { return x.ticker === tk; })[0];
    if (!m) return;
    state.ticker = tk;
    if (!state.len) state.len = PERIODS[state.period].lengths[0][1];
    Array.prototype.forEach.call(document.querySelectorAll("tr.clickable"), function (r) {
      r.classList.toggle("sel", r.getAttribute("data-ticker") === tk);
    });
    var head = document.getElementById("selhead");
    if (head) head.innerHTML = "<h2 style='margin-top:0'>" + esc(m.title || tk) + "</h2><div class='small muted'>" +
      esc(m.event_title || "") + " · " + esc(tk) + " · " + link(m.source_url, "API record") + " · rules: " +
      link(m.contract_terms_url, "contract terms") + "</div>";
    renderBook(m);
    renderControls(m);
    var chart = document.getElementById("chart");
    if (m.has_candles) {
      chart.innerHTML = '<div class="muted" style="padding:20px">Loading candles…</div>';
      fetch("data/candles/" + encodeURIComponent(tk) + ".json").then(function (r) { return r.json(); }).then(function (c) {
        state.candles = c; drawChart(m, c, state.period, state.len);
      }).catch(function () { chart.innerHTML = '<div class="muted">Candle file not available.</div>'; });
    } else {
      chart.innerHTML = '<div class="muted" style="padding:20px">No candles captured for this market (only the top markets per topic are charted).</div>';
    }
    var sr = document.getElementById("sources");
    if (sr) sr.innerHTML = (m.settlement_sources || []).map(function (s) { return link(s.url, s.name || "source"); }).join(" · ") || "—";
  }

  function marketsTable(list, title) {
    var rows = marketRows(list, { clickable: true });
    return "<h2>" + esc(title) + "</h2><div class='tablewrap'><table>" + MARKET_HEAD + rows + "</table></div>";
  }

  function jumpsTable(list) {
    if (!list.length) return "<div class='muted'>No moves of $0.10 or more in the captured candles.</div>";
    return "<div class='tablewrap'><table><tr><th>Time (UTC)</th><th>Market</th><th>Topic</th><th>Interval</th><th class='num'>From → To</th><th class='num'>Move</th><th>Cause</th><th>Possible source links (from Kalshi API)</th></tr>" +
      list.slice(0, 200).map(function (j) {
        return "<tr><td>" + dt(j.time) + "</td><td>" + esc(j.title || j.ticker) + "<div class='small'>" + link(j.source_url, "API record") + "</div></td>" +
          "<td>" + esc(TOPIC_LABEL[j.topic] || j.topic) + "</td><td>" + esc(j.period) + "</td>" +
          "<td class='num'>" + px(j.from) + " → " + px(j.to) + "</td>" +
          "<td class='num'>" + (j.direction === "up" ? "▲ " : "▼ ") + "$" + Math.abs(j.delta).toFixed(2) + "</td>" +
          "<td>" + badge("unverified", "unv") + "<div class='small muted'>" + esc(j.cause_status) + "</div></td>" +
          "<td>" + ((j.settlement_sources || []).map(function (s) { return link(s.url, s.name || "source"); }).join("<br>") || "—") + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function resolvedTable(list) {
    if (!list.length) return "<div class='muted'>No resolved markets yet. Markets are checked every run until the API reports a YES or NO result.</div>";
    return "<div class='tablewrap'><table><tr><th>Market</th><th>Topic</th><th>Result</th><th>Settled (UTC)</th><th class='num'>Settlement value</th><th>Source</th></tr>" +
      list.map(function (r) {
        return "<tr><td>" + esc(r.title || r.ticker) + "<div class='small muted'>" + esc(r.ticker) + "</div></td>" +
          "<td>" + esc(TOPIC_LABEL[r.topic] || r.topic) + "</td>" +
          "<td>" + badge(String(r.result).toUpperCase(), r.result) + "</td>" +
          "<td>" + dt(r.settlement_ts) + "</td><td class='num'>" + px(r.settlement_value) + "</td>" +
          "<td>" + link(r.source_url, "API record") + "</td></tr>";
      }).join("") + "</table></div>";
  }

  /* ---------- Pages ---------- */
  function topicMarkets(t) { return DATA.markets.filter(function (m) { return m.topic === t; }); }

  function renderIndex() {
    var open = DATA.markets.filter(function (m) { return !m.resolved; });
    var counts = TOPICS.map(function (t) {
      var n = topicMarkets(t[0]).length;
      return '<div class="card"><div class="k">' + esc(t[1]) + '</div><div class="v">' + n + '</div><a href="' + t[2] + '">Open topic page →</a></div>';
    }).join("");
    var top = open.slice(0, 10);
    var jumps = DATA.jumps.length;
    var sim = DATA.strategies;
    var summary = "<h2>Executive summary</h2><div class='panel'><ul>" +
      "<li>Scope: Kalshi <b>demo</b> markets in five topics — Crypto, Elections, Culture (Kalshi “Entertainment”), Gas prices, Golf. Source: " + link(DATA.api_base, "demo REST API") + ".</li>" +
      "<li>Tracked: <b>" + DATA.markets.length + "</b> markets across " + DATA.series_count + " Kalshi series in the catalogue; <b>" + open.length + "</b> open/active and <b>" + DATA.resolved.length + "</b> resolved (YES/NO) so far.</li>" +
      "<li>Price moves of $0.10 or more in the captured candles: <b>" + jumps + "</b> (each one lists the official settlement-source links; the cause is NOT verified).</li>" +
      "<li>Simulated strategies (paper only, fees not modelled): " + (sim.resolved_markets_with_hourly_candles ? sim.resolved_markets_with_hourly_candles + " resolved markets with hourly candles" : "no resolved markets with hourly candles yet — results are pending") + ".</li>" +
      "<li>Demo account trading and portfolio are <b>not connected</b>: they need Kalshi demo API keys (see Flagged for Review).</li>" +
      "<li>Data gaps and irregularities are listed on the <a href='flagged.html'>Flagged for Review</a> page with links to the official sources.</li></ul></div>";
    document.getElementById("app").innerHTML = staleBanner() + summary +
      "<h2>Topics</h2><div class='grid'>" + counts + "</div>" +
      marketsTable(top, "Top 10 open markets by volume (all topics)") +
      "<h2>Snapshot</h2><div class='small muted'>Collected " + esc(DATA.generated_at) + " (" + ago(DATA.generated_at) + "), " + DATA.api_calls + " API calls, runtime " + DATA.runtime_seconds + " s, errors: " + DATA.errors.length + ". Full detail in each topic page.</div>";
  }

  function renderTopic() {
    var list = topicMarkets(TOPIC).filter(function (m) { return !m.resolved; });
    var res = DATA.resolved.filter(function (r) { return r.topic === TOPIC; });
    var jumps = DATA.jumps.filter(function (j) { return j.topic === TOPIC; });
    var label = TOPIC_LABEL[TOPIC] || TOPIC;
    var note = "";
    if (TOPIC === "gas") note = "<div class='note'>Gas-prices rule: series in category Commodities with tag “Oil & Gas”, or any series whose title matches “gas price” or “gasoline”. Review the list on the Flagged page (natural-gas contracts may be included).</div>";
    if (TOPIC === "culture") note = "<div class='note'>“Culture” is mapped to Kalshi’s <b>Entertainment</b> category (the closest official category). Verify on the Flagged page.</div>";
    if (TOPIC === "golf") note = "<div class='note'>Golf = series in category Sports with tag “Golf”.</div>";
    document.getElementById("app").innerHTML = staleBanner() +
      "<h1>" + esc(label) + "</h1><p class='lead'>" + list.length + " open markets · " + res.length + " resolved · " + jumps.length + " price moves ≥ $0.10. Click a row to chart it and see its liquidity.</p>" + note +
      "<div class='two'><div>" + marketsTable(list, "Open markets (sorted by volume)") + "</div>" +
      "<div><div class='panel' id='selhead'><div class='muted'>Select a market to view its chart and liquidity.</div></div>" +
      "<div class='panel'><div id='controls' class='controls'></div><div id='chart'></div></div>" +
      "<div class='panel'><h2 style='margin-top:0'>Liquidity (orderbook)</h2><div id='book' class='muted'>—</div></div>" +
      "<div class='panel'><div class='small'><b>Settlement sources</b></div><div id='sources' class='small'>—</div></div></div></div>" +
      "<h2>Resolved in this topic</h2>" + resolvedTable(res) +
      "<h2>Price moves ≥ $0.10</h2>" + jumpsTable(jumps);
    document.querySelectorAll("tr.clickable").forEach(function (r) {
      r.addEventListener("click", function () { selectMarket(r.getAttribute("data-ticker")); });
    });
    if (list.length) selectMarket(list[0].ticker);
  }

  function renderResolved() {
    document.getElementById("app").innerHTML = staleBanner() + "<h1>Resolved markets</h1>" +
      "<p class='lead'>Each market shows the official result (YES or NO) from the API once it settles. Markets are re-checked every run until a result appears.</p>" +
      resolvedTable(DATA.resolved);
  }

  function renderJumps() {
    document.getElementById("app").innerHTML = staleBanner() + "<h1>Sharp price moves (≥ $0.10)</h1>" +
      "<p class='lead'>Consecutive candle closes that moved $0.10 or more, from the official candlesticks endpoint. " +
      "The site does not yet have an official news/cause feed, so cause fields are left <b>unverified</b>; the linked settlement sources are the official sources Kalshi lists for each market.</p>" +
      jumpsTable(DATA.jumps);
  }

  function renderStrategies() {
    var s = DATA.strategies;
    var strat = "<div class='tablewrap'><table><tr><th>Strategy</th><th>Rule</th><th class='num'>Trades</th><th class='num'>Win rate</th><th class='num'>Avg P&amp;L / contract</th><th class='num'>Total P&amp;L / contract</th></tr>" +
      s.strategies.map(function (x) {
        return "<tr><td><b>" + esc(x.strategy) + "</b></td><td>" + esc(x.description) + "</td><td class='num'>" + x.trades + "</td><td class='num'>" +
          (x.win_rate === null ? "—" : Math.round(x.win_rate * 100) + "%") + "</td><td class='num'>" + (x.avg_pnl_per_contract === null ? "—" : "$" + x.avg_pnl_per_contract.toFixed(2)) +
          "</td><td class='num'>$" + Number(x.total_pnl_per_contract || 0).toFixed(2) + "</td></tr>";
      }).join("") + "</table></div>";
    var cats = s.categories.length ? "<div class='tablewrap'><table><tr><th>Strategy</th><th>Topic</th><th>Entry price band</th><th class='num'>Trades</th><th class='num'>Win rate</th><th class='num'>Avg P&amp;L</th><th>Sample</th></tr>" +
      s.categories.map(function (c) {
        return "<tr><td>" + esc(c.strategy) + "</td><td>" + esc(TOPIC_LABEL[c.topic] || c.topic) + "</td><td>" + esc(c.band) + "</td><td class='num'>" + c.trades + "</td><td class='num'>" +
          Math.round(c.win_rate * 100) + "%</td><td class='num'>$" + c.avg_pnl.toFixed(2) + "</td><td>" + (c.small_sample ? badge("small (<30)", "flag") : badge("ok")) + "</td></tr>";
      }).join("") + "</table></div>" : "<div class='muted'>No categorised trades yet (no resolved markets with hourly candles).</div>";
    var p = DATA.paper;
    var pos = p.positions.length ? "<div class='tablewrap'><table><tr><th>Market</th><th>Topic</th><th>Status</th><th class='num'>Entry</th><th class='num'>Mark / exit</th><th class='num'>P&amp;L / contract</th><th>Entry time</th><th>Source</th></tr>" +
      p.positions.map(function (x) {
        var v = x.status === "closed" ? x.pnl : x.unrealized;
        return "<tr><td>" + esc(x.title || x.ticker) + "</td><td>" + esc(TOPIC_LABEL[x.topic] || x.topic) + "</td><td>" + badge(x.status) + "</td><td class='num'>" + px(x.entry) + "</td><td class='num'>" +
          px(x.status === "closed" ? x.exit : x.mark) + "</td><td class='num'>" + (v === undefined || v === null ? "—" : "$" + v.toFixed(2)) + "</td><td>" + dt(x.entry_time) + "</td><td>" + link(x.source_url, "API record") + "</td></tr>";
      }).join("") + "</table></div>" : "<div class='muted'>No paper positions yet. A paper position opens when the hourly close rises ≥ $0.10 over the prior 6 hours.</div>";
    var tr = s.trades.length ? "<div class='tablewrap'><table><tr><th>Strategy</th><th>Market</th><th>Side</th><th class='num'>Entry</th><th>Entry time</th><th>Result</th><th class='num'>P&amp;L</th><th>Source</th></tr>" +
      s.trades.slice(0, 200).map(function (t) {
        return "<tr><td>" + esc(t.strategy) + "</td><td>" + esc(t.ticker) + "</td><td>" + esc(t.side.toUpperCase()) + "</td><td class='num'>" + px(t.entry) + "</td><td>" + dt(t.entry_time) + "</td><td>" + badge(t.result.toUpperCase(), t.result) + "</td><td class='num'>$" + t.pnl.toFixed(2) + "</td><td>" + link(t.source_url, "API record") + "</td></tr>";
      }).join("") + "</table></div>" : "<div class='muted'>No simulated trades yet.</div>";
    document.getElementById("app").innerHTML = staleBanner() + "<h1>Simulated strategies & paper portfolio</h1>" +
      "<div class='note'>" + esc(s.note) + " " + esc(p.note) + "</div>" +
      "<h2>Strategy comparison (on resolved markets)</h2>" + strat +
      "<h2>Trade categories (strategy × topic × entry price)</h2>" + cats +
      "<h2>Paper portfolio (momentum, marked to market)</h2><div class='muted'>Open " + p.open_positions + " · closed " + p.closed_positions + " · unrealised $" + p.unrealized_pnl.toFixed(2) + " · realised $" + p.realized_pnl.toFixed(2) + "</div>" + pos +
      "<h2>Simulated trade log</h2>" + tr;
  }

  function renderSuggestions() {
    var items = [
      ["Stream prices over WebSocket instead of polling", "Subscribe to ticker/orderbook channels for sub-second quote updates. The docs list the WebSocket hosts and channels.", "https://docs.kalshi.com/getting_started/quick_start_websockets"],
      ["Show seconds-level charts", "Candlesticks are only available at 1-minute, 1-hour and 1-day intervals. Seconds need a live trade/ticker stream built from WebSocket messages.", "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"],
      ["Add a live orderbook depth chart", "The orderbook endpoint returns resting contracts per price; a depth chart makes liquidity visible at a glance.", "https://docs.kalshi.com/api-reference/market/get-market-orderbook"],
      ["Link price moves to news", "Attach an official or news source to each ≥$0.10 move (currently unverified). Requires a news feed with stored, dated links.", "https://docs.kalshi.com/getting_started/market_settlement"],
      ["Connect the demo account", "Create demo API keys and add them as secrets so the dashboard can show real demo positions, fills and balance (signed requests).", "https://docs.kalshi.com/getting_started/api_keys"],
      ["Run the collector more often", "The current scheduled collector runs on a fixed interval; the more often it runs, the finer the snapshot history.", "https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule"]
    ];
    document.getElementById("app").innerHTML = "<h1>Suggestions to make the site more live</h1><p class='lead'>These are recommendations, not verified facts. Each links to the official doc it depends on.</p>" +
      "<div class='tablewrap'><table><tr><th>Suggestion</th><th>Why</th><th>Official reference</th></tr>" +
      items.map(function (i) { return "<tr><td><b>" + esc(i[0]) + "</b></td><td>" + esc(i[1]) + "</td><td>" + link(i[2], i[2].replace("https://", "")) + "</td></tr>"; }).join("") + "</table></div>";
  }

  function renderSources() {
    var rows = (DATA.verification.checks || []).map(function (c) {
      return "<tr><td>" + esc(c.title) + (c.detail ? "<div class='small muted'>" + esc(c.detail) + "</div>" : "") + "</td><td class='num'>" +
        (c.pass === null || c.pass === undefined ? "—" : c.pass) + "</td><td class='num'>" + c.fail + "</td><td>" + link(c.source, c.source) + "</td></tr>";
    }).join("");
    var srcs = [
      ["Kalshi API environments (demo host used)", "https://docs.kalshi.com/getting_started/api_environments"],
      ["Get Events (nested markets, category)", "https://docs.kalshi.com/api-reference/events/get-events"],
      ["Get Series List (category, tags, settlement sources)", "https://docs.kalshi.com/api-reference/market/get-series-list"],
      ["Get Markets (status enum, result)", "https://docs.kalshi.com/api-reference/market/get-markets"],
      ["Get Market Candlesticks (1 min / 1 h / 1 d)", "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"],
      ["Get Market Orderbook (resting contracts)", "https://docs.kalshi.com/api-reference/market/get-market-orderbook"],
      ["Orderbook responses (binary identity)", "https://docs.kalshi.com/getting_started/orderbook_responses"],
      ["Market settlement (YES/NO results)", "https://docs.kalshi.com/getting_started/market_settlement"],
      ["Category/tag taxonomy (demo)", "https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories"],
      ["Full docs index", "https://docs.kalshi.com/llms.txt"]
    ].map(function (s) { return "<li>" + link(s[1], s[0]) + "</li>"; }).join("");
    document.getElementById("app").innerHTML = staleBanner() + "<h1>Sources & automated checks</h1>" +
      "<p class='lead'>Every value on this site is read from the Kalshi API at collection time. Blank = not returned by the API (never inferred).</p>" +
      "<h2>Automated verification checks</h2><div class='tablewrap'><table><tr><th>Check</th><th class='num'>Pass</th><th class='num'>Fail / flagged</th><th>Official reference</th></tr>" + rows + "</table></div>" +
      "<h2>Official sources</h2><ul>" + srcs + "</ul>" +
      "<h2>Series index (topic series)</h2><div class='tablewrap'><table><tr><th>Series</th><th>Topic</th><th>Category</th><th>Tags</th><th>Contract terms</th><th>API</th></tr>" +
      (DATA.series_sources || []).map(function (s) {
        return "<tr><td>" + esc(s.title || s.ticker) + "<div class='small muted'>" + esc(s.ticker) + "</div></td><td>" + esc(TOPIC_LABEL[s.topic] || s.topic) + "</td><td>" + esc(s.category) + "</td><td class='small'>" + esc((s.tags || []).join(", ") || "—") +
          "</td><td>" + link(s.contract_terms_url, "terms") + "</td><td>" + link(s.source_url, "API") + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function renderFlagged() {
    var flags = (DATA.verification.flags || []).map(function (f) {
      return "<tr><td>" + badge("flag", "flag") + "</td><td>" + esc(f.title || f.ticker) + "<div class='small muted'>" + esc(f.ticker || "") + "</div></td><td>" + esc(f.issue) + "</td><td>" + link(f.source_url, "source") + "</td></tr>";
    }).join("");
    var repo = [
      ["README.md is a one-line placeholder (“# Trade1”): no setup, purpose or licence text.", "https://github.com/wingbangboozle1-lang/Trade1/blob/main/README.md"],
      ["No LICENSE file in the repository.", "https://github.com/wingbangboozle1-lang/Trade1"],
      ["The repo had only the initial commit and no COORDINATION.md (created in this session).", "https://github.com/wingbangboozle1-lang/Trade1/commits/main"],
      ["GitHub Pages was enabled on the legacy build from main ‘/’ with no site content; it is now replaced by this site.", "https://wingbangboozle1-lang.github.io/Trade1/"],
      ["Branch arena/ee533bdf-trade1 exists on origin (commit b9425b3). It was not read or changed by this session.", "https://github.com/wingbangboozle1-lang/Trade1/tree/arena/ee533bdf-trade1"],
      ["Task brief asks for branches named session-<id>/<task>; the session branch rule requires arena/46259c0d-trade1. The session used the assigned branch.", "https://github.com/wingbangboozle1-lang/Trade1/tree/arena/46259c0d-trade1"],
      ["Demo account trading and portfolio tracking are NOT implemented: they need Kalshi demo API keys (signed requests), which this sandbox does not have. Add as repository secrets to enable.", "https://docs.kalshi.com/getting_started/api_keys"],
      ["Seconds-level charts are not available: the candlesticks endpoint offers 1-minute, 1-hour and 1-day only.", "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"],
      ["Cause of ≥$0.10 price moves is unverified: no official news feed is wired in.", "https://docs.kalshi.com/getting_started/market_settlement"],
      ["Market status: the API returns “active” for open markets, while the Get Markets page lists unopened/open/closed/settled. Checked automatically in the Sources page.", "https://docs.kalshi.com/api-reference/market/get-markets"],
      ["“Culture” is mapped to Kalshi’s Entertainment category; “Gas prices” uses the Oil & Gas tag plus title match. These are our mapping choices, not official Kalshi categories.", "https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories"],
      ["“Est. $ volume” is derived (volume × last price), not an API field.", "https://docs.kalshi.com/api-reference/market/get-markets"],
      ["The Kalshi docs’ example responses are placeholder values (e.g. “<string>”); only live API responses were used for data.", "https://docs.kalshi.com/api-reference/market/get-markets"],
      ["Demo environment data is not production data; some markets have placeholder-like close dates and “demo strike” entries (see flags below).", "https://docs.kalshi.com/getting_started/api_environments"]
    ].map(function (r) { return "<li>" + esc(r[0]) + " " + link(r[1], "source") + "</li>"; }).join("");
    document.getElementById("app").innerHTML = staleBanner() + "<h1>Flagged for Review</h1>" +
      "<p class='lead'>Irregularities and unverified items, published for your review. These do not block the site. Each row links to the source it came from.</p>" +
      "<h2>Repository review (line by line)</h2><ul>" + repo + "</ul>" +
      "<h2>Automated data flags (" + DATA.verification.flag_count + " total, first 600 shown)</h2>" +
      "<div class='tablewrap'><table><tr><th>Type</th><th>Market / series</th><th>Issue</th><th>Source</th></tr>" + (flags || "<tr><td colspan='4' class='muted'>No flags in this snapshot.</td></tr>") + "</table></div>";
  }

  function render() {
    document.getElementById("nav").innerHTML = nav();
    document.getElementById("footer").innerHTML = footer();
    if (PAGE === "index") renderIndex();
    else if (TOPIC) renderTopic();
    else if (PAGE === "resolved") renderResolved();
    else if (PAGE === "jumps") renderJumps();
    else if (PAGE === "strategies") renderStrategies();
    else if (PAGE === "suggestions") renderSuggestions();
    else if (PAGE === "sources") renderSources();
    else if (PAGE === "flagged") renderFlagged();
  }

  loadData(function () {
    render();
    // Refresh the snapshot every 5 minutes while the page stays open.
    setInterval(function () { loadData(render); }, 5 * 60 * 1000);
  });
})();
