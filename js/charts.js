/*
 * Minimal, dependency-free canvas charts.
 *  - LineChart: X = time, Y = contract price (cents->dollars), configurable window.
 *  - DepthChart: X = price, Y = cumulative contracts available (liquidity).
 * Designed to be simple and clean (task requirement).
 */

(function (global) {
  "use strict";

  function setupCanvas(canvas) {
    const dpr = global.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function clear(ctx, w, h, color) {
    ctx.fillStyle = color || "#0f172a";
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------- Line chart ---------- */
  function LineChart(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign(
      {
        padding: { top: 16, right: 16, bottom: 28, left: 44 },
        gridColor: "#1e293b",
        axisColor: "#64748b",
        textColor: "#94a3b8",
        lineColor: "#38bdf8",
        fillColor: "rgba(56,189,248,0.15)",
        windowSeconds: 900,
      },
      opts
    );
    this.points = []; // [{t: msEpoch, y: dollars}]
    this.label = "";
  }

  LineChart.prototype.setData = function (points) {
    this.points = (points || []).slice();
  };

  LineChart.prototype.setWindow = function (seconds) {
    this.opts.windowSeconds = seconds;
  };

  LineChart.prototype.render = function () {
    const { ctx, w, h } = setupCanvas(this.canvas);
    const p = this.opts.padding;
    clear(ctx, w, h, this.opts.bg || "#0b1120");

    if (!this.points.length) {
      ctx.fillStyle = this.opts.textColor;
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for live price data…", w / 2, h / 2);
      return;
    }

    const now = this.points[this.points.length - 1].t;
    const winMs = this.opts.windowSeconds * 1000;
    const cutoff = now - winMs;
    const data = this.points.filter((d) => d.t >= cutoff);
    if (!data.length) return;

    const x0 = p.left, x1 = w - p.right, y0 = p.top, y1 = h - p.bottom;
    const xMin = data[0].t, xMax = data[data.length - 1].t;
    let yMin = Math.min(...data.map((d) => d.y));
    let yMax = Math.max(...data.map((d) => d.y));
    const pad = (yMax - yMin) * 0.15 || 0.05;
    yMin = Math.max(0, yMin - pad);
    yMax = Math.min(1, yMax + pad);

    const X = (t) => x0 + ((t - xMin) / (xMax - xMin || 1)) * (x1 - x0);
    const Y = (y) => y1 - ((y - yMin) / (yMax - yMin || 1)) * (y1 - y0);

    // grid + Y labels (price)
    ctx.strokeStyle = this.opts.gridColor;
    ctx.fillStyle = this.opts.textColor;
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const val = yMin + ((yMax - yMin) * i) / yTicks;
      const yy = Y(val);
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText("$" + val.toFixed(2), x0 - 6, yy + 3);
    }
    // X labels (time)
    const xTicks = 4;
    for (let i = 0; i <= xTicks; i++) {
      const tt = xMin + ((xMax - xMin) * i) / xTicks;
      const xx = X(tt);
      ctx.textAlign = "center";
      ctx.fillText(new Date(tt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), xx, y1 + 16);
    }

    // line
    ctx.beginPath();
    data.forEach((d, i) => {
      const xx = X(d.t), yy = Y(d.y);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = this.opts.lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // fill
    ctx.lineTo(X(data[data.length - 1].t), y1);
    ctx.lineTo(X(data[0].t), y1);
    ctx.closePath();
    ctx.fillStyle = this.opts.fillColor;
    ctx.fill();

    // last point marker + value
    const last = data[data.length - 1];
    ctx.fillStyle = this.opts.lineColor;
    ctx.beginPath();
    ctx.arc(X(last.t), Y(last.y), 3, 0, Math.PI * 2);
    ctx.fill();
  };

  /* ---------- Depth / liquidity chart ---------- */
  function DepthChart(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign(
      {
        padding: { top: 12, right: 12, bottom: 24, left: 44 },
        gridColor: "#1e293b",
        textColor: "#94a3b8",
        yesColor: "#22c55e",
        noColor: "#ef4444",
      },
      opts
    );
    this.yes = []; // [{price, count}]
    this.no = [];
  }

  DepthChart.prototype.setData = function (yes, no) {
    this.yes = yes || [];
    this.no = no || [];
  };

  DepthChart.prototype.render = function () {
    const { ctx, w, h } = setupCanvas(this.canvas);
    const p = this.opts.padding;
    clear(ctx, w, h, this.opts.bg || "#0b1120");

    const x0 = p.left, x1 = w - p.right, y0 = p.top, y1 = h - p.bottom;

    const all = [...this.yes, ...this.no];
    if (!all.length) {
      ctx.fillStyle = this.opts.textColor;
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No orderbook data yet", w / 2, h / 2);
      return;
    }

    let pMin = Math.min(...all.map((d) => d.price));
    let pMax = Math.max(...all.map((d) => d.price));
    const yMax = Math.max(
      1,
      ...all.map((d) => d.count),
      ...this._cumulative(this.yes).map((d) => d.count),
      ...this._cumulative(this.no).map((d) => d.count)
    );
    if (pMax - pMin < 0.01) { pMax = pMin + 0.01; }

    const X = (pr) => x0 + ((pr - pMin) / (pMax - pMin)) * (x1 - x0);
    const Y = (c) => y1 - (c / yMax) * (y1 - y0);

    // grid
    ctx.strokeStyle = this.opts.gridColor;
    ctx.fillStyle = this.opts.textColor;
    ctx.font = "11px system-ui, sans-serif";
    for (let i = 0; i <= 3; i++) {
      const yy = y0 + ((y1 - y0) * i) / 3;
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
      const val = yMax * (1 - i / 3);
      ctx.textAlign = "right"; ctx.fillText(Math.round(val) + "", x0 - 6, yy + 3);
    }

    // x labels
    for (let i = 0; i <= 4; i++) {
      const pr = pMin + ((pMax - pMin) * i) / 4;
      ctx.textAlign = "center";
      ctx.fillText("$" + pr.toFixed(2), X(pr), y1 + 15);
    }

    // YES cumulative (asks/bids)
    this._drawSide(ctx, this._cumulative(this.yes), X, Y, this.opts.yesColor, "YES contracts", x0);
    this._drawSide(ctx, this._cumulative(this.no), X, Y, this.opts.noColor, "NO contracts", x1);
  };

  DepthChart.prototype._cumulative = function (side) {
    const sorted = side.slice().sort((a, b) => a.price - b.price);
    let acc = 0;
    return sorted.map((d) => { acc += d.count; return { price: d.price, count: acc }; });
  };

  DepthChart.prototype._drawSide = function (ctx, cum, X, Y, color, label, alignX) {
    if (!cum.length) return;
    ctx.beginPath();
    cum.forEach((d, i) => {
      const xx = X(d.price), yy = Y(d.count);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    });
    ctx.lineTo(X(cum[cum.length - 1].price), Y(0));
    ctx.lineTo(X(cum[0].price), Y(0));
    ctx.closePath();
    ctx.fillStyle = color + "55";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  global.KD_charts = { LineChart, DepthChart };
})(window);
