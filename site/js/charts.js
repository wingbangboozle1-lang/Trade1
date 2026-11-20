/* Trade1 — charts.js — Chart.js wrappers (simplified line + depth bars).
 * Chart.js v4.6.1 vendored from npm (MIT). Category axis used (no date adapter dependency).
 */
"use strict";

(function () {
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = "#64748b";
  Chart.defaults.animation = false;

  // ---------- Price chart (seconds / minutes / hours) ----------
  // mode 'sec'  : polled points from Store.history (x = time label, y = price $)
  // mode 'min'  : official 1-minute candlesticks (close line, tooltip shows OHLC) + live tail
  // mode 'hour' : official 60-minute candlesticks
  function PriceChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    this.mode = "sec";
    this.ticker = null;
    this.series = null;
    this.jumps = [];           // [{t, price, dir}]
    this._labels = []; this._data = []; this._jumpIdx = new Set(); this._ohlc = [];
    this.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Contract price ($)",
            data: [],
            borderColor: "#2563eb", borderWidth: 2, pointRadius: 0, tension: 0.15,
            fill: false, spanGaps: false,
          },
          {
            label: "Jump ≥ $0.10",
            data: [],
            borderColor: "rgba(220,38,38,0)", pointBackgroundColor: "#dc2626",
            pointRadius: 5, pointHoverRadius: 7, showLine: false, spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxTicksLimit: 10, autoSkip: true }, grid: { display: false } },
          y: { min: 0, max: 1, ticks: { callback: (v) => "$" + Number(v).toFixed(2) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const i = c.dataIndex;
                const o = this._ohlc[i];
                if (o) return [
                  `Close: $${(+c.parsed.y).toFixed(3)}`,
                  `Open: $${(+o.o).toFixed(3)}  High: $${(+o.h).toFixed(3)}  Low: $${(+o.l).toFixed(3)}`,
                  `Volume: ${o.v}   OI: ${o.oi}`,
                ];
                return `$${(+c.parsed.y).toFixed(3)}`;
              },
            },
          },
        },
      },
    });
  }

  PriceChart.prototype.setMode = function (mode) { this.mode = mode; };

  // sec mode: push polled points
  PriceChart.prototype.setHistory = function (points, jumps) {
    if (this.mode !== "sec") return;
    this._labels = points.map((p) => fmtClock(p[0]));
    this._data = points.map((p) => p[1]);
    this._ohlc = points.map(() => null);
    this._jumpIdx = new Set();
    const jumpData = new Array(points.length).fill(null);
    (jumps || []).forEach((j) => {
      const idx = points.findIndex((p) => Math.abs(p[0] - j.t) <= 2500 && Math.abs(p[1] - j.price) < 1e-9);
      if (idx >= 0) { jumpData[idx] = j.price; this._jumpIdx.add(idx); }
    });
    this.chart.data.labels = this._labels;
    this.chart.data.datasets[0].data = this._data;
    this.chart.data.datasets[1].data = jumpData;
    this.chart.update();
  };

  // min/hour mode: candlesticks [{end_period_ts, price:{close_dollars,open_dollars,high_dollars,low_dollars}, volume_fp, open_interest_fp}]
  PriceChart.prototype.setCandles = function (candles, liveTail) {
    if (this.mode === "sec") return;
    const pts = candles.slice();
    if (liveTail) pts.push(liveTail);
    this._labels = pts.map((c) => {
      const t = c.end_period_ts * 1000;
      return this.mode === "min" ? fmtClock(t) : fmtDayTime(t);
    });
    this._data = pts.map((c) => parseFloat(c.price?.close_dollars ?? "0") || null);
    this._ohlc = pts.map((c) => c.price ? {
      o: c.price.open_dollars, h: c.price.high_dollars, l: c.price.low_dollars,
      v: c.volume_fp, oi: c.open_interest_fp,
    } : null);
    this._jumpIdx = new Set();
    const jumpData = new Array(pts.length).fill(null);
    (this.jumps || []).forEach((j) => {
      let best = -1, bestDiff = Infinity;
      pts.forEach((c, i) => {
        const d = Math.abs(c.end_period_ts * 1000 - j.t);
        if (d < bestDiff) { bestDiff = d; best = i; }
      });
      if (best >= 0 && bestDiff <= 65000) { jumpData[best] = this._data[best]; this._jumpIdx.add(best); }
    });
    this.chart.data.labels = this._labels;
    this.chart.data.datasets[0].data = this._data;
    this.chart.data.datasets[1].data = jumpData;
    this.chart.update();
  };

  function fmtClock(t) {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0").slice(0, 1);
  }
  function fmtDayTime(t) {
    const d = new Date(t);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  // ---------- Orderbook depth chart ----------
  function DepthChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    this.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          { label: "YES bids (contracts)", data: [], backgroundColor: "rgba(37,99,235,0.65)" },
          { label: "NO bids (contracts)", data: [], backgroundColor: "rgba(220,38,38,0.55)" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxTicksLimit: 14, autoSkip: true }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: "Contracts available" } },
        },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } },
      },
    });
  }
  // book = {yes:[[p, q]...], no:[[p, q]...]} ascending; best bid last
  DepthChart.prototype.setBook = function (book) {
    const levels = {};
    (book.yes || []).forEach(([p, q]) => { levels[p] = levels[p] || { yes: 0, no: 0 }; levels[p].yes += parseFloat(q) || 0; });
    (book.no || []).forEach(([p, q]) => { levels[p] = levels[p] || { yes: 0, no: 0 }; levels[p].no += parseFloat(q) || 0; });
    const keys = Object.keys(levels).sort((a, b) => parseFloat(a) - parseFloat(b));
    this.chart.data.labels = keys.map((k) => "$" + (+k).toFixed(2));
    this.chart.data.datasets[0].data = keys.map((k) => levels[k].yes);
    this.chart.data.datasets[1].data = keys.map((k) => levels[k].no);
    this.chart.update();
  };

  // ---------- Equity curve ----------
  function LineChart(canvasId, label, color) {
    const ctx = document.getElementById(canvasId);
    this.chart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [{ label, data: [], borderColor: color || "#16a34a", borderWidth: 2, pointRadius: 0, tension: 0.15 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxTicksLimit: 8, autoSkip: true }, grid: { display: false } },
          y: { ticks: { callback: (v) => "$" + Number(v).toFixed(0) } },
        },
        plugins: { legend: { display: false } },
      },
    });
  }
  LineChart.prototype.setSeries = function (points) {
    this.chart.data.labels = points.map((p) => fmtDayTime(p[0]));
    this.chart.data.datasets[0].data = points.map((p) => p[1]);
    this.chart.update();
  };

  window.T1Charts = { PriceChart, DepthChart, LineChart };
})();
