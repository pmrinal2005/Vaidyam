/* Catena chart engine — dependency-free responsive SVG (line/area/bar/donut/radial/scatter/heat/graph). */
(function () {
  "use strict";

  var C = (window.Catena = window.Catena || {});
  var Ch = (C.chart = {});
  var uid = 0;
  function nid(p) { uid += 1; return (p || "cx") + uid; }

  function nums(arr) {
    return (arr || []).map(function (v) { return v === null || v === undefined || isNaN(v) ? null : Number(v); });
  }
  function extent(series) {
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) {
      s.forEach(function (v) { if (v === null) return; if (v < lo) lo = v; if (v > hi) hi = v; });
    });
    if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
    if (lo === hi) return [lo - Math.abs(lo || 1) * 0.12 - 0.5, hi + Math.abs(hi || 1) * 0.12 + 0.5];
    var pad = (hi - lo) * 0.1;
    return [lo - pad, hi + pad];
  }
  function pathFrom(pts) {
    var d = ""; var open = false;
    pts.forEach(function (p) {
      if (p === null) { open = false; return; }
      d += (open ? " L " : " M ") + p[0].toFixed(2) + " " + p[1].toFixed(2);
      open = true;
    });
    return d;
  }

  /* ── Sparkline (no axes, fills its box) ── */
  Ch.spark = function (values, opts) {
    var o = opts || {};
    var v = nums(values).filter(function (x) { return x !== null; });
    if (v.length < 2) return '<svg class="chart" viewBox="0 0 100 26" preserveAspectRatio="none"></svg>';
    var w = 100, h = 26, ex = extent([v]);
    var sx = function (i) { return (i / (v.length - 1)) * w; };
    var sy = function (y) { return h - 2 - ((y - ex[0]) / (ex[1] - ex[0])) * (h - 4); };
    var pts = v.map(function (y, i) { return [sx(i), sy(y)]; });
    var color = o.color || "#7cf5c4";
    var gid = nid("sg");
    return (
      '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.36"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + pathFrom(pts) + " L " + w + " " + h + " L 0 " + h + ' Z" fill="url(#' + gid + ')" stroke="none"/>' +
      '<path d="' + pathFrom(pts) + '" fill="none" stroke="' + color + '" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      "</svg>"
    );
  };

  /* ── Multi-series line / area ── */
  Ch.line = function (cfg) {
    var labels = cfg.labels || [];
    var series = (cfg.series || []).map(function (s) { return { name: s.name, color: s.color || "#7cf5c4", values: nums(s.values), area: s.area !== false, dashed: s.dashed, axis: s.axis || "left" }; });
    if (!series.length) return '<div class="empty">No series</div>';

    var w = 760, h = cfg.height || 230;
    var m = { t: 14, r: cfg.rightAxis ? 44 : 14, b: 26, l: 42 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;

    var leftSeries = series.filter(function (s) { return s.axis === "left"; });
    var rightSeries = series.filter(function (s) { return s.axis === "right"; });
    var exL = extent(leftSeries.map(function (s) { return s.values; }));
    var exR = rightSeries.length ? extent(rightSeries.map(function (s) { return s.values; })) : exL;
    if (cfg.min !== undefined) exL[0] = cfg.min;
    if (cfg.max !== undefined) exL[1] = cfg.max;

    var n = Math.max.apply(null, series.map(function (s) { return s.values.length; }).concat([labels.length, 2]));
    var sx = function (i) { return m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw); };
    var syL = function (y) { return m.t + ih - ((y - exL[0]) / (exL[1] - exL[0] || 1)) * ih; };
    var syR = function (y) { return m.t + ih - ((y - exR[0]) / (exR[1] - exR[0] || 1)) * ih; };

    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + C.esc(cfg.aria || "Time series chart") + '">';

    // gridlines + left axis labels
    var ticks = cfg.ticks || 4;
    for (var g = 0; g <= ticks; g++) {
      var yv = exL[0] + ((exL[1] - exL[0]) * g) / ticks;
      var y = syL(yv);
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) +
        '" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>';
      out += '<text x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.34)">' +
        C.fmt.num(yv, Math.abs(exL[1] - exL[0]) > 40 ? 0 : 1) + "</text>";
    }
    if (rightSeries.length) {
      for (var g2 = 0; g2 <= ticks; g2++) {
        var yv2 = exR[0] + ((exR[1] - exR[0]) * g2) / ticks;
        out += '<text x="' + (w - m.r + 7) + '" y="' + (syR(yv2) + 3).toFixed(1) + '" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(121,184,255,0.42)">' +
          C.fmt.num(yv2, Math.abs(exR[1] - exR[0]) > 40 ? 0 : 1) + "</text>";
      }
    }

    // x labels (thinned to avoid overlap)
    var step = Math.max(1, Math.ceil(n / (cfg.xTicks || 6)));
    for (var i = 0; i < n; i += step) {
      if (!labels[i]) continue;
      out += '<text x="' + sx(i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.3)">' +
        C.esc(labels[i]) + "</text>";
    }

    if (cfg.bands) {
      cfg.bands.forEach(function (b) {
        var y1 = syL(b.to), y2 = syL(b.from);
        out += '<rect x="' + m.l + '" y="' + Math.min(y1, y2).toFixed(1) + '" width="' + iw + '" height="' + Math.abs(y2 - y1).toFixed(1) +
          '" fill="' + (b.color || "rgba(255,143,163,0.07)") + '"/>';
      });
    }

    series.forEach(function (s) {
      var sy = s.axis === "right" ? syR : syL;
      var pts = s.values.map(function (y, i) { return y === null ? null : [sx(i), sy(y)]; });
      var d = pathFrom(pts);
      if (!d) return;
      if (s.area && !s.dashed) {
        var gid = nid("lg");
        var first = pts.find(function (p) { return p; });
        var last = pts.slice().reverse().find(function (p) { return p; });
        out += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.3"/>' +
          '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>' +
          '<path d="' + d + " L " + last[0].toFixed(2) + " " + (m.t + ih) + " L " + first[0].toFixed(2) + " " + (m.t + ih) +
          ' Z" fill="url(#' + gid + ')" stroke="none"/>';
      }
      out += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"' +
        (s.dashed ? ' stroke-dasharray="5 4"' : "") + "/>";
      var lastPt = pts.slice().reverse().find(function (p) { return p; });
      if (lastPt && cfg.dots !== false) {
        out += '<circle cx="' + lastPt[0].toFixed(2) + '" cy="' + lastPt[1].toFixed(2) + '" r="3" fill="' + s.color + '" stroke="#07080a" stroke-width="1.4"/>';
      }
    });

    out += "</svg>";
    if (cfg.legend !== false && series.length > 1) {
      out += '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' + C.esc(s.name) + "</span>";
      }).join("") + "</div>";
    }
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── Bars (vertical, optional stacking) ── */
  Ch.bars = function (cfg) {
    var labels = cfg.labels || [];
    var series = (cfg.series || []).map(function (s) { return { name: s.name, color: s.color || "#7cf5c4", values: nums(s.values) }; });
    if (!series.length) return '<div class="empty">No series</div>';
    var w = 760, h = cfg.height || 210;
    var m = { t: 12, r: 12, b: 26, l: 40 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;
    var n = Math.max(labels.length, series[0].values.length, 1);

    var maxV = 0;
    if (cfg.stacked) {
      for (var i = 0; i < n; i++) {
        var sum = series.reduce(function (a, s) { return a + (s.values[i] || 0); }, 0);
        if (sum > maxV) maxV = sum;
      }
    } else {
      series.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
    }
    maxV = maxV || 1;

    var slot = iw / n;
    var bw = cfg.stacked ? Math.min(slot * 0.62, 26) : Math.min((slot * 0.66) / series.length, 18);
    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + C.esc(cfg.aria || "Bar chart") + '">';

    for (var g = 0; g <= 4; g++) {
      var yv = (maxV * g) / 4;
      var y = m.t + ih - (yv / maxV) * ih;
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.05)"/>';
      out += '<text x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.32)">' +
        C.fmt.compact(yv) + "</text>";
    }

    for (var b = 0; b < n; b++) {
      var cx = m.l + slot * b + slot / 2;
      if (cfg.stacked) {
        var acc = 0;
        series.forEach(function (s) {
          var v = s.values[b] || 0;
          var hh = (v / maxV) * ih;
          var y0 = m.t + ih - (acc / maxV) * ih - hh;
          acc += v;
          if (hh > 0.3) {
            out += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) +
              '" height="' + hh.toFixed(1) + '" rx="2" fill="' + s.color + '" opacity="0.92"/>';
          }
        });
      } else {
        series.forEach(function (s, si) {
          var v = s.values[b] || 0;
          var hh = (v / maxV) * ih;
          var x = cx - (bw * series.length) / 2 + si * bw;
          out += '<rect x="' + x.toFixed(1) + '" y="' + (m.t + ih - hh).toFixed(1) + '" width="' + (bw - 1.5).toFixed(1) +
            '" height="' + Math.max(0.6, hh).toFixed(1) + '" rx="2.5" fill="' + s.color + '" opacity="0.9"><title>' +
            C.esc((labels[b] || "") + " · " + s.name + ": " + C.fmt.num(v)) + "</title></rect>";
        });
      }
      var lstep = Math.max(1, Math.ceil(n / (cfg.xTicks || 8)));
      if (labels[b] && b % lstep === 0) {
        out += '<text x="' + cx.toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.3)">' +
          C.esc(labels[b]) + "</text>";
      }
    }
    out += "</svg>";
    if (cfg.legend !== false && series.length > 1) {
      out += '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' + C.esc(s.name) + "</span>";
      }).join("") + "</div>";
    }
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── Horizontal bars with labels ── */
  Ch.hbars = function (rows, opts) {
    var o = opts || {};
    var max = o.max || Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); }).concat([1]));
    return (
      '<div class="row-list">' +
      rows.map(function (r) {
        var pct = (Math.abs(r.value) / max) * 100;
        return (
          '<div style="min-width:0">' +
          '<div class="flexbet" style="margin-bottom:5px">' +
          '<span class="tiny" style="color:var(--ink-2);overflow-wrap:anywhere">' + C.esc(r.label) + "</span>" +
          '<span class="mono tiny nowrap" style="color:' + (r.color || "var(--accent)") + '">' + C.esc(r.display || C.fmt.num(r.value)) + "</span>" +
          "</div>" +
          '<div class="bar-track"><div class="bar-fill ' + (r.cls || "") + '" style="width:' + pct.toFixed(1) + "%" +
          (r.color ? ";background:" + r.color : "") + '"></div></div>' +
          (r.sub ? '<p class="tiny muted" style="margin-top:4px">' + C.esc(r.sub) + "</p>" : "") +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  };

  /* ── Donut ── */
  Ch.donut = function (slices, opts) {
    var o = opts || {};
    var total = slices.reduce(function (a, s) { return a + (s.value || 0); }, 0) || 1;
    var size = 176, r = 66, cx = size / 2, cy = size / 2, sw = 17;
    var acc = -Math.PI / 2;
    var out = '<svg class="chart" viewBox="0 0 ' + size + " " + size + '" style="max-height:190px" role="img" aria-label="' + C.esc(o.aria || "Distribution") + '">';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="' + sw + '"/>';
    slices.forEach(function (s) {
      var frac = (s.value || 0) / total;
      if (frac <= 0) return;
      var a0 = acc, a1 = acc + frac * Math.PI * 2;
      acc = a1;
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      out += '<path d="M ' + x0.toFixed(2) + " " + y0.toFixed(2) + " A " + r + " " + r + " 0 " + large + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2) +
        '" fill="none" stroke="' + s.color + '" stroke-width="' + sw + '" stroke-linecap="butt"><title>' +
        C.esc(s.label + ": " + C.fmt.num(s.value) + " (" + (frac * 100).toFixed(0) + "%)") + "</title></path>";
    });
    if (o.center) {
      out += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="22" font-weight="600" fill="#f4f6f8">' + C.esc(o.center) + "</text>";
      if (o.centerSub) out += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.42)">' + C.esc(o.centerSub) + "</text>";
    }
    out += "</svg>";
    out += '<div class="chart-legend">' + slices.map(function (s) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' + C.esc(s.label) +
        ' <span class="mono muted">' + C.fmt.num((s.value / total) * 100, 0) + "%</span></span>";
    }).join("") + "</div>";
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── Radial gauge (risk score) ── */
  Ch.gauge = function (value, opts) {
    var o = opts || {};
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    var size = 132, r = 50, cx = size / 2, cy = size / 2, sw = 11;
    var a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    var a1 = a0 + span * (v / 100);
    function pt(a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
    var p0 = pt(a0), p1 = pt(a1), pE = pt(a0 + span);
    var color = o.color || (v < 34 ? "#7cf5c4" : v < 62 ? "#ffcf7a" : "#ff8fa3");
    return (
      '<div class="chart-wrap"><svg class="chart" viewBox="0 0 ' + size + " " + size + '" style="max-height:146px" role="img" aria-label="' + C.esc((o.label || "Score") + ": " + v) + '">' +
      '<path d="M ' + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A " + r + " " + r + " 0 1 1 " + pE[0].toFixed(2) + " " + pE[1].toFixed(2) +
      '" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      (v > 0.5
        ? '<path d="M ' + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A " + r + " " + r + " 0 " + (span * (v / 100) > Math.PI ? 1 : 0) + " 1 " +
          p1[0].toFixed(2) + " " + p1[1].toFixed(2) + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round"/>'
        : "") +
      '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="27" font-weight="600" fill="#f4f6f8">' + Math.round(v) + "</text>" +
      '<text x="' + cx + '" y="' + (cy + 22) + '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.4)">' +
      C.esc(o.sub || "/100") + "</text></svg></div>"
    );
  };

  /* ── Scatter with fitted line ── */
  Ch.scatter = function (cfg) {
    var pts = (cfg.points || []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); });
    if (pts.length < 2) return '<div class="empty">Not enough paired observations</div>';
    var w = 760, h = cfg.height || 226;
    var m = { t: 14, r: 14, b: 30, l: 44 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;
    var exX = extent([pts.map(function (p) { return p.x; })]);
    var exY = extent([pts.map(function (p) { return p.y; })]);
    var sx = function (x) { return m.l + ((x - exX[0]) / (exX[1] - exX[0] || 1)) * iw; };
    var sy = function (y) { return m.t + ih - ((y - exY[0]) / (exY[1] - exY[0] || 1)) * ih; };

    var n = pts.length;
    var mx = pts.reduce(function (a, p) { return a + p.x; }, 0) / n;
    var my = pts.reduce(function (a, p) { return a + p.y; }, 0) / n;
    var num = 0, den = 0;
    pts.forEach(function (p) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); });
    var slope = den === 0 ? 0 : num / den;
    var icept = my - slope * mx;

    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + C.esc(cfg.aria || "Scatter plot") + '">';
    for (var g = 0; g <= 4; g++) {
      var yv = exY[0] + ((exY[1] - exY[0]) * g) / 4;
      var y = sy(yv);
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.05)"/>';
      out += '<text x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.32)">' + C.fmt.num(yv, 1) + "</text>";
    }
    for (var gx = 0; gx <= 4; gx++) {
      var xv = exX[0] + ((exX[1] - exX[0]) * gx) / 4;
      out += '<text x="' + sx(xv).toFixed(1) + '" y="' + (h - 12) + '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.3)">' + C.fmt.num(xv, 0) + "</text>";
    }
    out += '<line x1="' + sx(exX[0]).toFixed(1) + '" y1="' + sy(icept + slope * exX[0]).toFixed(1) + '" x2="' + sx(exX[1]).toFixed(1) +
      '" y2="' + sy(icept + slope * exX[1]).toFixed(1) + '" stroke="' + (cfg.fitColor || "#79b8ff") + '" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.85"/>';
    pts.forEach(function (p, i) {
      out += '<circle cx="' + sx(p.x).toFixed(2) + '" cy="' + sy(p.y).toFixed(2) + '" r="3.1" fill="' + (cfg.color || "#7cf5c4") +
        '" opacity="' + (0.42 + 0.5 * (i / n)).toFixed(2) + '"><title>' + C.esc((p.label || "") + " x=" + C.fmt.num(p.x, 1) + " y=" + C.fmt.num(p.y, 1)) + "</title></circle>";
    });
    out += '<text x="' + (w - m.r) + '" y="' + (m.t + 10) + '" text-anchor="end" font-size="9" font-family="Space Mono,monospace" fill="rgba(121,184,255,0.7)">' +
      C.esc((cfg.xLabel || "x") + " → " + (cfg.yLabel || "y")) + "</text>";
    out += "</svg>";
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── 24×n heat strip ── */
  Ch.heat = function (cfg) {
    var cells = cfg.cells || [];
    if (!cells.length) return '<div class="empty">No exposure data</div>';
    var cols = cfg.cols || cells.length;
    var w = 760, cellH = cfg.cellH || 34;
    var cw = w / cols;
    var max = Math.max.apply(null, cells.map(function (c2) { return c2.value; }).concat([1]));
    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + (cellH + 20) + '" role="img" aria-label="' + C.esc(cfg.aria || "Heat strip") + '">';
    cells.forEach(function (c2, i) {
      var t = Math.max(0, Math.min(1, c2.value / max));
      var color = cfg.scale ? cfg.scale(t, c2.value) : "rgba(124,245,196," + (0.14 + t * 0.8).toFixed(2) + ")";
      out += '<rect x="' + (i * cw).toFixed(2) + '" y="0" width="' + (cw - 1.2).toFixed(2) + '" height="' + cellH +
        '" rx="3" fill="' + color + '"><title>' + C.esc(c2.label + ": " + C.fmt.num(c2.value, 1)) + "</title></rect>";
      var step = Math.max(1, Math.ceil(cols / 12));
      if (i % step === 0) {
        out += '<text x="' + (i * cw + cw / 2).toFixed(2) + '" y="' + (cellH + 13) + '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.3)">' +
          C.esc(c2.tick || "") + "</text>";
      }
    });
    out += "</svg>";
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── Force-free causal graph layout (community-clustered radial) ── */
  Ch.graph = function (graph, opts) {
    var o = opts || {};
    var nodes = graph.nodes || [];
    var edges = graph.edges || [];
    if (!nodes.length) return '<div class="empty">Graph not yet constructed</div>';

    var w = 900, h = o.height || 520;
    var cx = w / 2, cy = h / 2;

    // Cluster by community around a ring, then place members on a sub-ring.
    var comms = {};
    nodes.forEach(function (n) { (comms[n.community] = comms[n.community] || []).push(n); });
    var keys = Object.keys(comms).sort(function (a, b) { return Number(a) - Number(b); });
    var R = Math.min(w, h) * 0.33;
    var pos = {};
    keys.forEach(function (k, ci) {
      var ang = (ci / keys.length) * Math.PI * 2 - Math.PI / 2;
      var ccx = cx + R * Math.cos(ang) * 1.34;
      var ccy = cy + R * Math.sin(ang);
      var members = comms[k];
      var sub = 34 + members.length * 11;
      members.forEach(function (n, mi) {
        var a2 = (mi / Math.max(1, members.length)) * Math.PI * 2 + ci * 0.7;
        pos[n.id] = {
          x: Math.max(46, Math.min(w - 46, ccx + (members.length === 1 ? 0 : sub * Math.cos(a2)))),
          y: Math.max(34, Math.min(h - 34, ccy + (members.length === 1 ? 0 : sub * 0.72 * Math.sin(a2))))
        };
      });
    });

    var focus = o.focus;
    var maxPpr = Math.max.apply(null, nodes.map(function (n) { return n.ppr || 0; }).concat([0.0001]));

    var out = '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Personal causal knowledge graph">';
    out += '<defs><marker id="cgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(244,246,248,0.34)"/></marker></defs>';

    edges.forEach(function (e) {
      var a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      var active = !focus || focus === e.source || focus === e.target;
      var mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.13;
      var my = (a.y + b.y) / 2 - (b.x - a.x) * 0.13;
      out += '<path class="gedge" d="M ' + a.x.toFixed(1) + " " + a.y.toFixed(1) + " Q " + mx.toFixed(1) + " " + my.toFixed(1) + " " + b.x.toFixed(1) + " " + b.y.toFixed(1) +
        '" fill="none" stroke="' + (active ? "rgba(121,184,255,0.5)" : "rgba(255,255,255,0.09)") +
        '" stroke-width="' + (0.6 + e.strength * 2.6).toFixed(2) + '" marker-end="url(#cgArrow)" stroke-opacity="' + (active ? 0.9 : 0.3) +
        '" data-edge="' + C.esc(e.source + "|" + e.target) + '"><title>' +
        C.esc(e.source + " --" + e.relation + "--> " + e.target + "  strength " + e.strength + ", lag " + e.lagHours + "h, conf " + e.confidence) + "</title></path>";
    });

    nodes.forEach(function (n) {
      var p = pos[n.id];
      if (!p) return;
      var color = C.DOMAIN_COLOR[n.domain] || "#9aa4b2";
      var pprScale = n.ppr ? n.ppr / maxPpr : 0;
      var r = 9 + n.weight * 8 + pprScale * 8;
      var dim = focus && focus !== n.id && !edges.some(function (e) {
        return (e.source === focus && e.target === n.id) || (e.target === focus && e.source === n.id);
      });
      out += '<g class="gnode" data-node="' + C.esc(n.id) + '" opacity="' + (dim ? 0.34 : 1) + '" tabindex="0">' +
        (pprScale > 0.02 ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (r + 7 + pprScale * 9).toFixed(1) +
          '" fill="' + color + '" opacity="' + (0.07 + pprScale * 0.17).toFixed(3) + '"/>' : "") +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" fill-opacity="0.22" stroke="' + color +
        '" stroke-width="' + (focus === n.id ? 2.6 : 1.5) + '"/>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 11).toFixed(1) + '" text-anchor="middle">' + C.esc(n.label) + "</text>" +
        "<title>" + C.esc(n.label + " · " + n.domain + (n.ppr ? " · PPR " + n.ppr : "")) + "</title></g>";
    });

    out += "</svg>";
    return '<div class="graph-stage" id="graph-stage">' + out + '<div class="graph-tip" id="graph-tip"></div></div>';
  };

  /* ── Waterfall (counterfactual deltas) ── */
  Ch.waterfall = function (rows, opts) {
    var o = opts || {};
    if (!rows.length) return '<div class="empty">Adjust a lever to simulate</div>';
    var w = 760, h = o.height || 220;
    var m = { t: 16, r: 14, b: 40, l: 14 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); }).concat([0.01]));
    var slot = iw / rows.length;
    var zero = m.t + ih / 2;
    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Projected change by outcome">';
    out += '<line x1="' + m.l + '" y1="' + zero + '" x2="' + (w - m.r) + '" y2="' + zero + '" stroke="rgba(255,255,255,0.16)"/>';
    rows.forEach(function (r, i) {
      var bh = (Math.abs(r.value) / max) * (ih / 2 - 8);
      var up = r.value > 0;
      var x = m.l + slot * i + slot * 0.24;
      var bw = slot * 0.52;
      var color = r.good ? "#7cf5c4" : "#ff8fa3";
      out += '<rect x="' + x.toFixed(1) + '" y="' + (up ? zero - bh : zero).toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + Math.max(1.4, bh).toFixed(1) + '" rx="3" fill="' + color + '" opacity="0.88"><title>' +
        C.esc(r.label + ": " + (r.value > 0 ? "+" : "") + C.fmt.num(r.value, 2) + " " + (r.unit || "")) + "</title></rect>";
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (up ? zero - bh - 6 : zero + bh + 13).toFixed(1) +
        '" text-anchor="middle" font-size="9" font-family="Space Mono,monospace" fill="' + color + '">' +
        (r.value > 0 ? "+" : "") + C.fmt.num(r.value, 2) + "</text>";
      var lines = String(r.label).split(" ");
      var l1 = lines.slice(0, 2).join(" ");
      var l2 = lines.slice(2).join(" ");
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 20) + '" text-anchor="middle" font-size="8.3" fill="rgba(244,246,248,0.5)">' + C.esc(l1) + "</text>";
      if (l2) out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 10) + '" text-anchor="middle" font-size="8.3" fill="rgba(244,246,248,0.34)">' + C.esc(l2) + "</text>";
    });
    out += "</svg>";
    return '<div class="chart-wrap">' + out + "</div>";
  };

  /* ── Layered swarm topology (MoA) ── */
  Ch.swarmTopology = function (agents, consensus) {
    var l1 = agents.filter(function (a) { return a.layer === 1; });
    var l2 = agents.filter(function (a) { return a.layer === 2; });
    var w = 760, h = 210;
    var out = '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Mixture-of-Agents topology">';
    var y1 = 52, y2 = 158;
    var cx = w / 2;
    l1.forEach(function (a, i) {
      var x = ((i + 0.5) / l1.length) * w;
      out += '<line x1="' + x.toFixed(1) + '" y1="' + (y1 + 16) + '" x2="' + cx + '" y2="' + (y2 - 18) +
        '" stroke="rgba(124,245,196,' + (0.16 + a.confidence * 0.4).toFixed(2) + ')" stroke-width="' + (0.7 + a.confidence * 1.7).toFixed(2) + '"/>';
      var col = C.DOMAIN_COLOR[a.domain] || "#7cf5c4";
      out += '<circle cx="' + x.toFixed(1) + '" cy="' + y1 + '" r="15" fill="' + col + '" fill-opacity="0.2" stroke="' + col + '" stroke-width="1.5"/>';
      out += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 4) + '" text-anchor="middle" font-size="9.5" font-family="Space Mono,monospace" fill="' + col + '">' +
        C.esc(a.vote.slice(0, 3).toUpperCase()) + "</text>";
      out += '<text x="' + x.toFixed(1) + '" y="' + (y1 - 24) + '" text-anchor="middle" font-size="8.2" fill="rgba(244,246,248,0.55)">' +
        C.esc(a.name.replace(/ (Agent|\/ Circadian Agent|Sentiment Agent)$/, "").slice(0, 16)) + "</text>";
      out += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 30) + '" text-anchor="middle" font-size="7.8" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.34)">' +
        a.latencyMs + "ms · " + a.confidence + "</text>";
    });
    var coord = l2[0];
    out += '<circle cx="' + cx + '" cy="' + y2 + '" r="21" fill="#7cf5c4" fill-opacity="0.22" stroke="#7cf5c4" stroke-width="2"/>';
    out += '<text x="' + cx + '" y="' + (y2 + 4) + '" text-anchor="middle" font-size="10" font-family="Space Mono,monospace" fill="#7cf5c4">' +
      C.esc(consensus && consensus.vote ? consensus.vote.slice(0, 4).toUpperCase() : "SYNTH") + "</text>";
    out += '<text x="' + cx + '" y="' + (y2 + 40) + '" text-anchor="middle" font-size="8.6" fill="rgba(244,246,248,0.6)">Preventive-Care Coordinator (layer 2)</text>';
    if (coord) {
      out += '<text x="' + cx + '" y="' + (y2 - 30) + '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="rgba(244,246,248,0.34)">' +
        C.esc(coord.model) + "</text>";
    }
    out += '<text x="12" y="' + (y1 - 40) + '" font-size="8.4" font-family="Space Mono,monospace" fill="rgba(121,184,255,0.6)">LAYER 1 — SPECIALISTS</text>';
    out += "</svg>";
    return '<div class="chart-wrap">' + out + "</div>";
  };
})();
