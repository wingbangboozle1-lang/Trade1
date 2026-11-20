/* Dashboard behaviour: sorting, filtering, the price/depth charts and the equity chart.
 *
 * Everything here reads from data files the collector wrote. There is no sample data and no
 * placeholder numbers: if a value is missing it renders as an em dash.
 */
(function () {
  "use strict";
  var C = window.Trade1Charts || {};
  var $ = function (id) { return document.getElementById(id); };
  var DATA = null;

  function money(v, d) {
    if (v === null || v === undefined || v === "") return "—";
    return "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: d || 2, maximumFractionDigits: d || 2 });
  }
  function price(v) { return v === null || v === undefined ? "—" : "$" + Number(v).toFixed(3); }

  /* ------------------------------------------------------------ table sorting */
  function numFromCell(td) {
    var t = (td.textContent || "").replace(/[^0-9.\-]/g, "");
    var v = parseFloat(t);
    return isNaN(v) ? null : v;
  }

  function wireSort(root) {
    var tables = (root || document).querySelectorAll("table.sortable");
    tables.forEach(function (tbl) {
      var ths = tbl.querySelectorAll("thead th");
      ths.forEach(function (th, idx) {
        var btn = th.querySelector("button");
        if (!btn) return;
        btn.addEventListener("click", function () {
          var cur = th.getAttribute("data-dir") === "asc" ? "desc" : "asc";
          ths.forEach(function (o) { o.removeAttribute("data-dir"); });
          th.setAttribute("data-dir", cur);
          var tbody = tbl.querySelector("tbody");
          var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr")).filter(function (r) {
            return !r.querySelector(".empty");
          });
          rows.sort(function (a, b) {
            var av = numFromCell(a.children[idx]);
            var bv = numFromCell(b.children[idx]);
            if (av === null || bv === null) {
              var as = (a.children[idx].textContent || "").trim();
              var bs = (b.children[idx].textContent || "").trim();
              return cur === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
            }
            return cur === "asc" ? av - bv : bv - av;
          });
          rows.forEach(function (r) { tbody.appendChild(r); });
        });
      });
    });
  }

  /* ------------------------------------------------------------ markets page */
  function initMarkets() {
    var marketTable = $("marketTable");
    if (!marketTable) return;
    var seg = $("topicSeg");
    var filter = $("marketFilter");
    var sortSel = $("marketSort");
    var chartCanvas = $("priceChart");
    var depthCanvas = $("depthChart");
    // History starts at the first collector run, so the default window spans everything we have
    // rather than pretending an empty 5-minute window is a flat price.
    var state = { topic: "all", range: 86400, ticker: null, zoomY: true };

    fetch("data/markets.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { DATA = d; pick(); })
      .catch(function () { DATA = {}; pick(); });

    function rows() {
      return Array.prototype.slice.call(marketTable.querySelectorAll("tbody tr")).filter(function (r) {
        return r.getAttribute("data-ticker");
      });
    }

    // capture the original metric for each row so sorting uses real numbers, not rendered text
    rows().forEach(function (r) {
      var tds = r.children;
      r._num = {
        volume: numFromCell(tds[3]), volume24: numFromCell(tds[4]),
        liquidity: numFromCell(tds[5]), price: numFromCell(tds[1]),
        close: (tds[8].textContent || "").trim()
      };
    });

    function apply() {
      var q = (filter && filter.value || "").toLowerCase();
      var visible = 0;
      rows().forEach(function (r) {
        var okTopic = state.topic === "all" ||
          (r.getAttribute("data-topics") || "").split(" ").indexOf(state.topic) >= 0;
        var okText = !q || (r.textContent || "").toLowerCase().indexOf(q) >= 0;
        var show = okTopic && okText;
        r.style.display = show ? "" : "none";
        if (show) visible++;
      });
      if ($("marketCount")) $("marketCount").textContent = visible + " markets";
    }

    function sortRows() {
      var key = sortSel ? sortSel.value : "volume";
      var tbody = marketTable.querySelector("tbody");
      var list = rows();
      list.sort(function (a, b) {
        if (key === "close") return (a._num.close || "").localeCompare(b._num.close || "");
        var av = a._num[key], bv = b._num[key];
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
      list.forEach(function (r) { tbody.appendChild(r); });
    }

    if (seg) {
      seg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          seg.querySelectorAll("button").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          state.topic = b.getAttribute("data-topic");
          apply();
          pick();
        });
      });
    }
    if (filter) filter.addEventListener("input", apply);
    if (sortSel) sortSel.addEventListener("change", function () { sortRows(); apply(); pick(); });

    var rangeSeg = $("rangeSeg");
    if (rangeSeg) {
      rangeSeg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          rangeSeg.querySelectorAll("button").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          state.range = parseInt(b.getAttribute("data-range"), 10);
          draw();
        });
      });
    }
    var zy = $("zoomY");
    if (zy) zy.addEventListener("change", function () { state.zoomY = zy.checked; draw(); });

    marketTable.addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-ticker]");
      if (!tr) return;
      if (ev.target.tagName === "A") return;
      rows().forEach(function (r) { r.classList.remove("sel"); });
      tr.classList.add("sel");
      state.ticker = tr.getAttribute("data-ticker");
      draw();
    });

    function pick() {
      var first = rows().filter(function (r) { return r.style.display !== "none"; })[0];
      if (first && (!state.ticker || first.parentElement === first.parentElement)) {
        var keep = state.ticker && rows().some(function (r) {
          return r.getAttribute("data-ticker") === state.ticker && r.style.display !== "none";
        });
        if (!keep) { state.ticker = first.getAttribute("data-ticker"); }
        rows().forEach(function (r) {
          r.classList.toggle("sel", r.getAttribute("data-ticker") === state.ticker);
        });
        draw();
      }
    }

    function draw() {
      var d = (DATA || {})[state.ticker];
      if ($("chartTicker")) $("chartTicker").textContent = state.ticker || "select a market";
      if (!d) {
        if (chartCanvas) C.priceChart(chartCanvas, [], { emptyMessage: "Select a market to chart" });
        return;
      }
      if ($("chartTitle")) $("chartTitle").textContent = d.title.length > 56 ? d.title.slice(0, 56) + "…" : d.title;
      var now = Math.floor(Date.now() / 1000);
      var cutoff = state.range ? now - state.range : 0;
      var pts = (d.points || []).filter(function (p) { return !cutoff || p.t >= cutoff; });

      if (!pts.length && (d.points || []).length) {
        // requested window predates the observations: say so instead of drawing a fake flat line
        C.priceChart(chartCanvas, [], { emptyMessage: "No observations in this window — try a longer range" });
      } else {
        C.priceChart(chartCanvas, pts, { zoomY: state.zoomY, jumps: d.jumps || [], dots: true });
      }

      var lv = (d.book && d.book.yes) || [];
      var nv = (d.book && d.book.no) || [];
      if (depthCanvas) {
        C.depthChart(depthCanvas, lv.slice().reverse().map(function (row) { return { p: row[0], q: row[1] }; }),
          { colour: "#4aa8ff", label: "YES bids · contracts resting at each price" });
      }
      var liq = d.liquidity || {};
      if ($("liqYes")) $("liqYes").textContent = money(liq.buy_yes_liquidity_usd);
      if ($("liqNo")) $("liqNo").textContent = money(liq.buy_no_liquidity_usd);
      if ($("marketRules")) {
        $("marketRules").textContent = (d.rules_primary || "Rules not returned for this market.").slice(0, 900);
      }
      if ($("marketLinks") && d.sources) {
        $("marketLinks").innerHTML = [
          '<a href="' + d.sources.site + '" target="_blank" rel="noopener">Kalshi market page ↗</a>',
          '<a href="' + d.sources.market + '" target="_blank" rel="noopener">API market object ↗</a>',
          '<a href="' + d.sources.event + '" target="_blank" rel="noopener">API event ↗</a>',
          '<a href="' + d.sources.series + '" target="_blank" rel="noopener">API series ↗</a>'
        ].join(" · ");
      }
    }

    apply();
    sortRows();
    pick();
    window.addEventListener("resize", function () { draw(); });
  }

  /* ------------------------------------------------------------ equity chart */
  function initEquity() {
    var canvas = $("equityChart");
    if (!canvas) return;
    fetch("data/equity.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (pts) {
        var range = 0;
        function draw() {
          var now = Math.floor(Date.now() / 1000);
          var cut = range ? now - range : 0;
          var filtered = (pts || []).filter(function (p) { return !cut || p.t >= cut; });
          C.lineChart(canvas, filtered, {
            money: true, baseline: 10000, colour: "#3ddc97", fill: "rgba(61,220,151,.10)",
            emptyMessage: "No equity observations in this window"
          });
        }
        var seg = $("eqSeg");
        if (seg) {
          seg.querySelectorAll("button").forEach(function (b) {
            b.addEventListener("click", function () {
              seg.querySelectorAll("button").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
              b.setAttribute("aria-pressed", "true");
              range = parseInt(b.getAttribute("data-range"), 10);
              draw();
            });
          });
        }
        draw();
        window.addEventListener("resize", draw);
      })
      .catch(function () {});
  }

  function boot() {
    wireSort(document);
    initMarkets();
    initEquity();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
