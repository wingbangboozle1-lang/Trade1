/* Charting for the dashboard: dependency-free canvas charts.
 *
 *  priceChart  - time on X, contract price on Y, with zoom windows (seconds/minutes/hours/days)
 *  lineChart   - generic small series (equity curve, liquidity)
 *  depthChart  - horizontal liquidity bars: contracts resting at each price
 *
 * Interaction: hover crosshair with read-out, mouse-wheel zoom is deliberately not added (it
 * hijacks page scroll on a dashboard). Zoom is one click, so a trader can compare a 60-second move
 * against an 8-hour one without leaving the page.
 */
(function () {
  "use strict";

  var COL = {
    up: "#3ddc97", down: "#ff6b6b", accent: "#4aa8ff", grid: "#22313b",
    text: "#8fa3ad", faint: "#5d7280", warn: "#f7c260", bid: "#4aa8ff", ask: "#f7c260"
  };

  function setup(canvas, height) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(320, rect.width || canvas.parentElement.clientWidth || 640);
    var h = height || rect.height || 300;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    return { ctx: ctx, w: w, h: h };
  }

  function fmtTime(ts, span) {
    var d = new Date(ts * 1000);
    if (span <= 3600) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (span <= 86400) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function emptyBox(ctx, w, h, msg) {
    ctx.fillStyle = COL.text;
    ctx.textAlign = "center";
    ctx.fillText(msg, w / 2, h / 2);
    ctx.textAlign = "left";
  }

  /* ------------------------------------------------------------------ price chart */
  function priceChart(canvas, series, opts) {
    opts = opts || {};
    var dims = setup(canvas, opts.height || 300);
    var ctx = dims.ctx, w = dims.w, h = dims.h;
    var padL = 46, padR = 12, padT = 12, padB = 26;
    var pts = (series || []).filter(function (p) { return p && p.t; });

    if (!pts.length) { emptyBox(ctx, w, h, opts.emptyMessage || "No observations yet"); return; }

    var tMin = pts[0].t, tMax = pts[pts.length - 1].t;
    if (tMax === tMin) { tMax = tMin + 1; }
    var span = tMax - tMin;

    // Y domain: fixed 0..1 so a "cheap" and an "expensive" market look different at a glance.
    var yMin = 0, yMax = 1;
    if (opts.zoomY) {
      var vals = [];
      pts.forEach(function (p) {
        ["bid", "ask", "mid"].forEach(function (k) { if (p[k] != null) vals.push(p[k]); });
      });
      if (vals.length) {
        yMin = Math.max(0, Math.min.apply(null, vals) - 0.03);
        yMax = Math.min(1, Math.max.apply(null, vals) + 0.03);
        if (yMax - yMin < 0.05) { var c = (yMax + yMin) / 2; yMin = Math.max(0, c - 0.025); yMax = Math.min(1, c + 0.025); }
      }
    }
    function x(t) { return padL + (t - tMin) / (tMax - tMin) * (w - padL - padR); }
    function y(v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB); }

    // grid + Y labels
    ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.faint; ctx.lineWidth = 1;
    var steps = 5;
    for (var i = 0; i <= steps; i++) {
      var v = yMin + (yMax - yMin) * i / steps;
      var yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText("$" + v.toFixed(2), 4, yy + 3);
    }

    // X ticks
    var ticks = 4;
    ctx.textAlign = "center";
    for (var j = 0; j <= ticks; j++) {
      var tt = tMin + span * j / ticks;
      ctx.fillText(fmtTime(tt, span), x(tt), h - 8);
    }
    ctx.textAlign = "left";

    // jump markers (>= $0.10 moves), drawn first so lines sit on top
    (opts.jumps || []).forEach(function (jm) {
      if (jm.to_ts < tMin || jm.to_ts > tMax) return;
      var jx = x(jm.to_ts);
      ctx.save();
      ctx.strokeStyle = jm.direction === "up" ? "rgba(61,220,151,.35)" : "rgba(255,107,107,.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(jx, padT); ctx.lineTo(jx, h - padB); ctx.stroke();
      ctx.restore();
    });

    function drawLine(key, colour, width, dashed) {
      var valid = pts.filter(function (p) { return p[key] != null; });
      if (valid.length < 1) return;
      ctx.save();
      ctx.strokeStyle = colour; ctx.lineWidth = width || 1.6;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      valid.forEach(function (p, idx) {
        var px = x(p.t), py = y(p[key]);
        if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
      if (opts.dots && valid.length <= 2) {
        valid.forEach(function (p) {
          ctx.fillStyle = colour;
          ctx.beginPath(); ctx.arc(x(p.t), y(p[key]), 2.5, 0, Math.PI * 2); ctx.fill();
        });
      }
    }

    if (opts.bands !== false) {
      // bid/ask band between the two lines
      var both = pts.filter(function (p) { return p.bid != null && p.ask != null; });
      if (both.length > 1) {
        ctx.save();
        ctx.fillStyle = "rgba(74,168,255,.10)";
        ctx.beginPath();
        both.forEach(function (p, idx) { var px = x(p.t), py = y(p.bid); idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        for (var k = both.length - 1; k >= 0; k--) { ctx.lineTo(x(both[k].t), y(both[k].ask)); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    if (!opts.midOnly) {
      drawLine("bid", COL.bid, 1.4);
      drawLine("ask", COL.ask, 1.4);
    }
    drawLine("mid", opts.midColour || COL.up, 2.2);

    // last value badge
    var last = pts[pts.length - 1];
    var lv = last.mid != null ? last.mid : (last.bid != null ? last.bid : last.ask);
    if (lv != null) {
      var ly = y(lv);
      ctx.fillStyle = opts.midColour || COL.up;
      ctx.beginPath(); ctx.arc(w - padR, ly, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0b1014";
    }

    // hover read-out
    canvas.onmousemove = function (ev) {
      var box = canvas.getBoundingClientRect();
      var mx = ev.clientX - box.left;
      if (mx < padL || mx > w - padR) return;
      var tAt = tMin + (mx - padL) / (w - padL - padR) * (tMax - tMin);
      var best = pts[0], bd = Infinity;
      pts.forEach(function (p) { var d = Math.abs(p.t - tAt); if (d < bd) { bd = d; best = p; } });
      priceChart(canvas, series, opts);          // repaint clean
      var c2 = canvas.getContext("2d");
      c2.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      c2.save();
      c2.strokeStyle = "#3d4f5b"; c2.beginPath();
      c2.moveTo(x(best.t), padT); c2.lineTo(x(best.t), h - padB); c2.stroke();
      c2.restore();
      var label = fmtTime(best.t, span) + "  mid " + (best.mid != null ? "$" + best.mid.toFixed(3) : "—");
      var tw = c2.measureText(label).width + 12;
      var bx = Math.min(Math.max(x(best.t) - tw / 2, padL), w - padR - tw);
      c2.fillStyle = "rgba(19,28,34,.96)"; c2.strokeStyle = "#2c3d48";
      c2.beginPath(); c2.roundRect(bx, padT + 2, tw, 18, 4); c2.fill(); c2.stroke();
      c2.fillStyle = "#e9f1f4"; c2.fillText(label, bx + 6, padT + 15);
      if (opts.onHover) opts.onHover(best);
    };
    canvas.onmouseleave = function () { priceChart(canvas, series, opts); };
  }

  /* ------------------------------------------------------------------ line chart */
  function lineChart(canvas, points, opts) {
    opts = opts || {};
    var dims = setup(canvas, opts.height || 190);
    var ctx = dims.ctx, w = dims.w, h = dims.h;
    var padL = 52, padR = 10, padT = 10, padB = 22;
    var pts = (points || []).filter(function (p) { return p && p.t != null && p.v != null; });
    if (pts.length < 1) { emptyBox(ctx, w, h, opts.emptyMessage || "No data yet"); return; }
    var tMin = pts[0].t, tMax = pts[pts.length - 1].t || tMin + 1;
    var vMin = Math.min.apply(null, pts.map(function (p) { return p.v; }));
    var vMax = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (opts.includeZero) { vMin = Math.min(0, vMin); vMax = Math.max(0, vMax); }
    if (vMax === vMin) { vMax = vMin + 1; }
    var padV = (vMax - vMin) * 0.08; vMin -= padV; vMax += padV;

    function x(t) { return padL + (t - tMin) / Math.max(1, tMax - tMin) * (w - padL - padR); }
    function y(v) { return padT + (1 - (v - vMin) / (vMax - vMin)) * (h - padT - padB); }

    ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.faint;
    for (var i = 0; i <= 4; i++) {
      var v = vMin + (vMax - vMin) * i / 4, yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      var lbl = opts.money ? "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)) : v.toFixed(2);
      ctx.fillText(lbl, 4, yy + 3);
    }
    if (opts.baseline != null && opts.baseline >= vMin && opts.baseline <= vMax) {
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = COL.warn;
      ctx.beginPath(); ctx.moveTo(padL, y(opts.baseline)); ctx.lineTo(w - padR, y(opts.baseline)); ctx.stroke();
      ctx.restore();
    }
    var colour = opts.colour || COL.up;
    ctx.strokeStyle = colour; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(function (p, idx) { var px = x(p.t), py = y(p.v); idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    if (opts.fill) {
      ctx.save();
      ctx.lineTo(x(pts[pts.length - 1].t), h - padB); ctx.lineTo(x(pts[0].t), h - padB); ctx.closePath();
      ctx.fillStyle = opts.fill; ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = COL.faint; ctx.textAlign = "center";
    ctx.fillText(fmtTime(tMin, tMax - tMin), padL + 30, h - 6);
    ctx.fillText(fmtTime(tMax, tMax - tMin), w - padR - 30, h - 6);
    ctx.textAlign = "left";
  }

  /* ------------------------------------------------------------------ depth chart */
  function depthChart(canvas, levels, opts) {
    opts = opts || {};
    var dims = setup(canvas, opts.height || 190);
    var ctx = dims.ctx, w = dims.w, h = dims.h;
    var padL = 52, padR = 10, padT = 10, padB = 20;
    var rows = (levels || []).slice(0, 10);
    if (!rows.length) { emptyBox(ctx, w, h, "Order book empty or not sampled"); return; }
    var maxQ = Math.max.apply(null, rows.map(function (r) { return r.q; }).concat([1]));
    var barH = Math.max(6, (h - padT - padB) / rows.length - 4);
    ctx.font = "11px ui-monospace, Menlo, monospace";
    rows.forEach(function (r, i) {
      var yy = padT + i * (barH + 4);
      var bw = (r.q / maxQ) * (w - padL - padR - 60);
      ctx.fillStyle = opts.colour || COL.bid;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.roundRect(padL, yy, Math.max(1, bw), barH, 3); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COL.text;
      ctx.fillText("$" + r.p.toFixed(2), 4, yy + barH - 2);
      ctx.fillStyle = "#cfe0e8";
      ctx.fillText(r.q.toFixed(0), padL + bw + 6, yy + barH - 2);
    });
    ctx.fillStyle = COL.faint;
    ctx.fillText(opts.label || "contracts resting", padL, h - 5);
  }

  window.Trade1Charts = { priceChart: priceChart, lineChart: lineChart, depthChart: depthChart };
})();
