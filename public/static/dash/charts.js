/* ══════════════════════════════════════════════════════════════════════════
   Vaidyam chart engine — dependency-free responsive SVG.

   WHY THIS FILE WAS REWRITTEN
   ---------------------------
   Charts write colours into SVG *attributes* (fill="…", stroke="…"). CSS
   cannot restyle an attribute, so the previous build's literal
   `rgba(244,246,248,0.34)` axis labels and `#f4f6f8` donut centres survived
   every stylesheet change — they were 16 of the near-white values behind the
   invisible-text report, and they would have re-broken instantly under a light
   theme even after the body/theme bug was fixed.

   Every colour is therefore resolved at *render* time from
   `Vaidyam.theme.palette()` (a cached snapshot of the CSS custom properties on
   <html data-theme>). A theme flip invalidates that cache and re-renders, so
   axis labels, gridlines, gauge digits and graph edges all re-tint.

   Three further capabilities are built in rather than bolted on:
     • ANIMATION — declarative only. Charts stamp classes (.ch-line, .ch-area,
       .ch-bar, .ch-arc, .ch-pop, .ch-dot) plus CSS custom properties
       (--len, --delay, --dur, --r) onto the generated markup; dashboard.css
       owns the keyframes. No JS timers, so re-renders stay jank-free and
       `prefers-reduced-motion` is honoured by CSS alone.
     • TOOLTIPS — a model is registered per chart under a generated id and
       read back by `Ch.bind()`. Values carry real units (mmHg, ms, µg/m³,
       AQI…) and a timestamp/label footer.
     • HOVER — crosshair line, per-series pulsing focus dots, column/cell
       highlight bands. All hit-testing happens in viewBox coordinates so it
       is resolution- and breakpoint-independent.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var C = (window.Vaidyam = window.Vaidyam || {});
  var Ch = (C.chart = {});
  var uid = 0;
  function nid(p) { uid += 1; return (p || "cx") + uid; }

  /* Chart interaction models, keyed by the generated svg id. Pruned in bind()
     so a long session cannot leak models for charts no longer in the DOM. */
  var MODELS = {};

  /* ────────────────────────────────────────────────────────────────────────
     COLOUR RESOLUTION
     ------------------------------------------------------------------------
     Views should pass a semantic hue NAME ("rose", "amber", …). Two legacy
     forms are still accepted so no call-site can silently fall back to an
     unreadable hard-coded colour:
       • "--token"      → resolved from the palette
       • a dark hex     → mapped to its semantic hue, then resolved
     Anything else (an explicit rgba() a view really means) passes through.
     ──────────────────────────────────────────────────────────────────────── */
  var HEX_TO_HUE = {
    "#7cf5c4": "mint", "#79b8ff": "blue", "#b79dff": "violet",
    "#ffcf7a": "amber", "#ff8fa3": "rose", "#6ee7f5": "cyan",
    "#ff9f6e": "orange", "#9aa4b2": "slate"
  };

  function col(v, fallback) {
    if (v === null || v === undefined || v === "") return C.hue(fallback || "mint");
    var s = String(v).trim();
    if (C.HUE_KEYS[s]) return C.hue(s);
    if (s.charAt(0) === "-") {
      var p = C.theme.palette();
      var k = s.replace(/^--/, "");
      return p[k] || C.hue(fallback || "mint");
    }
    var lower = s.toLowerCase();
    if (HEX_TO_HUE[lower]) return C.hue(HEX_TO_HUE[lower]);
    return s;
  }

  /** Alpha-composites a resolved colour. Accepts #rgb/#rrggbb/rgb()/rgba(). */
  function alpha(color, a) {
    var s = String(color || "").trim();
    var m;
    if (s.charAt(0) === "#") {
      var hex = s.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      var n = parseInt(hex, 16);
      if (isNaN(n)) return s;
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + a + ")";
    return s;
  }

  /* ── Numeric helpers ── */
  function nums(arr) {
    return (arr || []).map(function (v) {
      return v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v);
    });
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
  /** Exact polyline length — the animated quantity for .ch-line / .ch-spark-line. */
  function polyLen(pts) {
    var total = 0, prev = null;
    pts.forEach(function (p) {
      if (p === null) { prev = null; return; }
      if (prev) {
        var dx = p[0] - prev[0], dy = p[1] - prev[1];
        total += Math.sqrt(dx * dx + dy * dy);
      }
      prev = p;
    });
    return Math.max(1, Math.ceil(total));
  }

  /**
   * Splits "Systolic (mmHg)" into { name: "Systolic", unit: "mmHg" } so every
   * existing call-site gains real units in tooltips with no edit. An explicit
   * `unit` on the series always wins.
   */
  function parseUnit(name, explicit) {
    var s = String(name === null || name === undefined ? "" : name);
    var m = s.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (explicit) return { name: m ? m[1] : s, unit: explicit };
    return m ? { name: m[1], unit: m[2] } : { name: s, unit: "" };
  }

  function decimals(unit, spread) {
    if (/mmhg|bpm|aqi|ms|mg|ml|steps|kcal|hpa|µg|ug/i.test(unit || "")) return 0;
    return spread !== undefined && Math.abs(spread) > 40 ? 0 : 1;
  }

  /* ── Registry helpers ──────────────────────────────────────────────────
     Charts are emitted as HTML *strings*, so a chart's interaction data
     cannot travel with its element. Each chart therefore registers its model
     under the id it stamped on the <svg>, and the binder (bottom of this file)
     looks it back up once the string has been inserted into the DOM.
     ────────────────────────────────────────────────────────────────────── */
  function register(id, model) { MODELS[id] = model; return id; }

  /** Model lookup used by Ch.bind(). */
  Ch.model = function (id) { return MODELS[id] || null; };

  /**
   * Drops models whose <svg> is no longer in the document. Without this a
   * long session (silent refresh every 3 minutes, view switching, theme
   * flips) would accumulate one model per chart render forever.
   */
  Ch.prune = function () {
    Object.keys(MODELS).forEach(function (id) {
      if (!document.getElementById(id)) delete MODELS[id];
    });
  };

  /* ══════════════════════════════════════════════════════════════════════
     SPARKLINE
     Fills its box, no axes. Draw-animated, and (when `opts.tip` is set)
     hoverable through the KPI tile's own [data-tip] binding.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.spark = function (values, opts) {
    var o = opts || {};
    var v = nums(values).filter(function (x) { return x !== null; });
    if (v.length < 2) return '<svg class="chart" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"></svg>';
    var w = 100, h = 26, ex = extent([v]);
    var sx = function (i) { return (i / (v.length - 1)) * w; };
    var sy = function (y) { return h - 2 - ((y - ex[0]) / (ex[1] - ex[0])) * (h - 4); };
    var pts = v.map(function (y, i) { return [sx(i), sy(y)]; });
    var color = col(o.color, "mint");
    var gid = nid("sg");
    var len = polyLen(pts);
    var d = pathFrom(pts);
    return (
      '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.36"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path class="ch-spark-area" d="' + d + " L " + w + " " + h + " L 0 " + h + ' Z" fill="url(#' + gid + ')" stroke="none"/>' +
      '<path class="ch-spark-line" style="--len:' + len + '" d="' + d + '" fill="none" stroke="' + color +
      '" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>' +
      "</svg>"
    );
  };

  /* ══════════════════════════════════════════════════════════════════════
     MULTI-SERIES LINE / AREA
     Animation: stroke draw → area fade → terminal dot pulse.
     Interaction: crosshair + per-series focus dots + multi-row tooltip with
     units and the point's own label/timestamp.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.line = function (cfg) {
    var p = C.theme.palette();
    var labels = cfg.labels || [];
    var series = (cfg.series || []).map(function (s) {
      var pu = parseUnit(s.name, s.unit);
      return {
        name: pu.name, unit: pu.unit, raw: s.name,
        color: col(s.color, "mint"),
        values: nums(s.values),
        area: s.area !== false, dashed: s.dashed, axis: s.axis || "left"
      };
    });
    if (!series.length) return '<div class="empty">No series</div>';

    var w = 760, h = cfg.height || 230;
    var m = { t: 14, r: cfg.rightAxis ? 44 : 14, b: 26, l: 42 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;

    var leftSeries = series.filter(function (s) { return s.axis === "left"; });
    var rightSeries = series.filter(function (s) { return s.axis === "right"; });
    var exL = extent((leftSeries.length ? leftSeries : series).map(function (s) { return s.values; }));
    var exR = rightSeries.length ? extent(rightSeries.map(function (s) { return s.values; })) : exL;
    if (cfg.min !== undefined) exL[0] = cfg.min;
    if (cfg.max !== undefined) exL[1] = cfg.max;

    var n = Math.max.apply(null, series.map(function (s) { return s.values.length; }).concat([labels.length, 2]));
    var sx = function (i) { return m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw); };
    var syL = function (y) { return m.t + ih - ((y - exL[0]) / (exL[1] - exL[0] || 1)) * ih; };
    var syR = function (y) { return m.t + ih - ((y - exR[0]) / (exR[1] - exR[0] || 1)) * ih; };

    var id = nid("chl");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="line" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="' + C.esc(cfg.aria || "Time series chart") + '">';

    /* Shaded reference bands sit beneath everything else. */
    if (cfg.bands) {
      cfg.bands.forEach(function (b) {
        var y1 = syL(b.to), y2 = syL(b.from);
        out += '<rect class="ch-fade" x="' + m.l + '" y="' + Math.min(y1, y2).toFixed(1) + '" width="' + iw +
          '" height="' + Math.abs(y2 - y1).toFixed(1) + '" fill="' + (b.color ? col(b.color, "rose") : alpha(C.hue("rose"), 0.08)) + '"/>';
      });
    }

    /* Gridlines + left axis labels — theme tokens, never literals. */
    var ticks = cfg.ticks || 4;
    for (var g = 0; g <= ticks; g++) {
      var yv = exL[0] + ((exL[1] - exL[0]) * g) / ticks;
      var y = syL(yv);
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) +
        '" stroke="' + p["chart-grid"] + '" stroke-width="1"/>';
      out += '<text class="ch-fade" x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) +
        '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis"] + '">' +
        C.fmt.num(yv, Math.abs(exL[1] - exL[0]) > 40 ? 0 : 1) + "</text>";
    }
    if (rightSeries.length) {
      for (var g2 = 0; g2 <= ticks; g2++) {
        var yv2 = exR[0] + ((exR[1] - exR[0]) * g2) / ticks;
        out += '<text class="ch-fade" x="' + (w - m.r + 7) + '" y="' + (syR(yv2) + 3).toFixed(1) +
          '" font-size="8.5" font-family="Space Mono,monospace" fill="' + alpha(rightSeries[0].color, 0.85) + '">' +
          C.fmt.num(yv2, Math.abs(exR[1] - exR[0]) > 40 ? 0 : 1) + "</text>";
      }
    }

    /* x labels, thinned so they never overlap at any breakpoint. */
    var step = Math.max(1, Math.ceil(n / (cfg.xTicks || 6)));
    for (var i = 0; i < n; i += step) {
      if (!labels[i]) continue;
      out += '<text class="ch-fade" x="' + sx(i).toFixed(1) + '" y="' + (h - 8) +
        '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
        C.esc(labels[i]) + "</text>";
    }

    /* Series paths. Each stroke animates its own exact length. */
    var xs = [];
    for (var xi = 0; xi < n; xi++) xs.push(sx(xi));
    var ptsBySeries = [];

    series.forEach(function (s, si) {
      var sy = s.axis === "right" ? syR : syL;
      var pts = s.values.map(function (yv3, ix) { return yv3 === null ? null : [sx(ix), sy(yv3)]; });
      ptsBySeries.push(pts);
      var d = pathFrom(pts);
      if (!d) return;
      var delay = 60 + si * 130;

      if (s.area && !s.dashed) {
        var gid = nid("lg");
        var first = pts.find(function (q) { return q; });
        var last = pts.slice().reverse().find(function (q) { return q; });
        out += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.3"/>' +
          '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>' +
          '<path class="ch-area" style="--delay:' + delay + 'ms" d="' + d + " L " + last[0].toFixed(2) + " " + (m.t + ih) +
          " L " + first[0].toFixed(2) + " " + (m.t + ih) + ' Z" fill="url(#' + gid + ')" stroke="none"/>';
      }

      out += '<path class="ch-line" style="--len:' + polyLen(pts) + ";--delay:" + delay + "ms;--dur:" +
        (900 + Math.min(500, n * 8)) + 'ms" d="' + d + '" fill="none" stroke="' + s.color +
        '" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"' +
        (s.dashed ? ' stroke-dasharray="5 4"' : "") + "/>";

      var lastPt = pts.slice().reverse().find(function (q) { return q; });
      if (lastPt && cfg.dots !== false) {
        out += '<circle class="ch-dot" style="--r:3;--delay:' + delay + 'ms" cx="' + lastPt[0].toFixed(2) +
          '" cy="' + lastPt[1].toFixed(2) + '" r="3" fill="' + s.color + '" stroke="' + p["chart-dot-stroke"] + '" stroke-width="1.4"/>';
      }
    });

    /* Interaction layer: column highlight → crosshair → focus dots → hit area. */
    out += '<rect class="ch-band-hl" x="0" y="' + m.t + '" width="' + Math.max(6, iw / Math.max(1, n - 1)) +
      '" height="' + ih + '" rx="3"/>';
    out += '<g class="ch-crosshair"><line x1="0" y1="' + m.t + '" x2="0" y2="' + (m.t + ih) + '"/></g>';
    out += '<g class="ch-focus-dot">' + series.map(function (s) {
      return '<circle class="ring" cx="-99" cy="-99" r="4" fill="none" stroke="' + s.color + '" stroke-width="1.4"/>' +
        '<circle class="fd" cx="-99" cy="-99" r="3.4" fill="' + s.color + '" stroke="' + p["chart-dot-stroke"] + '" stroke-width="1.3"/>';
    }).join("") + "</g>";
    out += '<rect class="ch-hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>';
    out += "</svg>";

    register(id, {
      kind: "line",
      m: m, w: w, h: h, iw: iw, ih: ih, n: n, xs: xs,
      labels: labels, times: cfg.times || null,
      title: cfg.tipTitle || "",
      series: series.map(function (s, si) {
        return {
          name: s.name, unit: s.unit, color: s.color,
          values: s.values, pts: ptsBySeries[si]
        };
      })
    });

    if (cfg.legend !== false && series.length > 1) {
      out += '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' +
          C.esc(s.name) + (s.unit ? ' <span class="mono muted">' + C.esc(s.unit) + "</span>" : "") + "</span>";
      }).join("") + "</div>";
    }
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     BARS (grouped or stacked)
     Animation: each bar grows from the axis, staggered left→right.
     Interaction: whole-column hit areas → one tooltip listing every series.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.bars = function (cfg) {
    var p = C.theme.palette();
    var labels = cfg.labels || [];
    var series = (cfg.series || []).map(function (s) {
      var pu = parseUnit(s.name, s.unit);
      return { name: pu.name, unit: pu.unit, color: col(s.color, "mint"), values: nums(s.values) };
    });
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
    var id = nid("chb");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="bars" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="' + C.esc(cfg.aria || "Bar chart") + '">';

    for (var g = 0; g <= 4; g++) {
      var yv = (maxV * g) / 4;
      var y = m.t + ih - (yv / maxV) * ih;
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) +
        '" stroke="' + p["chart-grid"] + '"/>';
      out += '<text class="ch-fade" x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) +
        '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis"] + '">' +
        C.fmt.compact(yv) + "</text>";
    }

    /* Column highlight band sits under the bars so it reads as a backdrop. */
    out += '<rect class="ch-band-hl" x="0" y="' + m.t + '" width="' + slot.toFixed(2) + '" height="' + ih + '" rx="3"/>';

    for (var b = 0; b < n; b++) {
      var cx = m.l + slot * b + slot / 2;
      var delay = 40 + b * Math.max(6, Math.round(360 / n));
      if (cfg.stacked) {
        var acc = 0;
        /* eslint-disable no-loop-func */
        series.forEach(function (s, si) {
          var v = s.values[b] || 0;
          var hh = (v / maxV) * ih;
          var y0 = m.t + ih - (acc / maxV) * ih - hh;
          acc += v;
          if (hh > 0.3) {
            out += '<rect class="ch-bar" style="--delay:' + (delay + si * 60) + 'ms" x="' + (cx - bw / 2).toFixed(1) +
              '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) +
              '" rx="2" fill="' + s.color + '" opacity="0.92"/>';
          }
        });
      } else {
        series.forEach(function (s, si) {
          var v = s.values[b] || 0;
          var hh = (v / maxV) * ih;
          var x = cx - (bw * series.length) / 2 + si * bw;
          out += '<rect class="ch-bar" style="--delay:' + (delay + si * 60) + 'ms" x="' + x.toFixed(1) +
            '" y="' + (m.t + ih - hh).toFixed(1) + '" width="' + (bw - 1.5).toFixed(1) +
            '" height="' + Math.max(0.6, hh).toFixed(1) + '" rx="2.5" fill="' + s.color + '" opacity="0.9"/>';
        });
      }
      var lstep = Math.max(1, Math.ceil(n / (cfg.xTicks || 8)));
      if (labels[b] && b % lstep === 0) {
        out += '<text class="ch-fade" x="' + cx.toFixed(1) + '" y="' + (h - 8) +
          '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
          C.esc(labels[b]) + "</text>";
      }
    }

    out += '<rect class="ch-hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>';
    out += "</svg>";

    register(id, {
      kind: "bars", m: m, w: w, h: h, iw: iw, ih: ih, n: n, slot: slot,
      stacked: !!cfg.stacked, labels: labels, times: cfg.times || null,
      title: cfg.tipTitle || "",
      series: series.map(function (s) { return { name: s.name, unit: s.unit, color: s.color, values: s.values }; })
    });

    if (cfg.legend !== false && series.length > 1) {
      out += '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' +
          C.esc(s.name) + (s.unit ? ' <span class="mono muted">' + C.esc(s.unit) + "</span>" : "") + "</span>";
      }).join("") + "</div>";
    }
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     HORIZONTAL BARS
     Plain DOM (not SVG) so long labels wrap naturally on phones. Rows carry
     a [data-tip] payload, which C.bindTips() turns into the same tooltip.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.hbars = function (rows, opts) {
    var o = opts || {};
    var list = rows || [];
    if (!list.length) return '<div class="empty">No rows to rank</div>';
    var max = o.max || Math.max.apply(null, list.map(function (r) { return Math.abs(r.value); }).concat([1]));
    return (
      '<div class="row-list">' +
      list.map(function (r, i) {
        var pct = (Math.abs(r.value) / max) * 100;
        var color = r.color ? col(r.color, "mint") : "";
        var tipRow = {
          name: o.valueName || "Value",
          value: r.display !== undefined ? String(r.display) : C.fmt.num(r.value),
          unit: r.unit || o.unit || ""
        };
        if (color) tipRow.color = color;
        var tip = C.esc(JSON.stringify({
          title: r.label,
          rows: [tipRow],
          foot: r.sub || o.foot || ""
        }));
        return (
          '<div class="hbar-row" style="min-width:0;--i:' + i + '" data-tip="' + tip + '">' +
          '<div class="flexbet" style="margin-bottom:5px">' +
          '<span class="tiny t-ink-2" style="overflow-wrap:anywhere">' + C.esc(r.label) + "</span>" +
          '<span class="mono tiny nowrap' + (color ? '" style="color:' + color + '"' : ' t-accent"') + ">" +
          C.esc(r.display !== undefined ? r.display : C.fmt.num(r.value)) + "</span>" +
          "</div>" +
          '<div class="bar-track"><div class="bar-fill ' + (r.cls || "") + '" style="width:' + pct.toFixed(1) + "%" +
          (color ? ";background:" + color : "") + '"></div></div>' +
          (r.sub ? '<p class="tiny muted" style="margin-top:4px">' + C.esc(r.sub) + "</p>" : "") +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  };

  /* ══════════════════════════════════════════════════════════════════════
     DONUT — arcs sweep in sequentially; each slice is independently hoverable.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.donut = function (slices, opts) {
    var o = opts || {};
    var p = C.theme.palette();
    var list = (slices || []).filter(function (s) { return s && (s.value || 0) > 0; });
    if (!list.length) return '<div class="empty">Nothing to distribute yet</div>';
    var total = list.reduce(function (a, s) { return a + (s.value || 0); }, 0) || 1;
    var size = 176, r = 66, cx = size / 2, cy = size / 2, sw = 17;
    var acc = -Math.PI / 2;
    var id = nid("chd");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="donut" viewBox="0 0 ' + size + " " + size +
      '" style="max-height:190px" role="img" aria-label="' + C.esc(o.aria || "Distribution") + '">';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + p["chart-grid"] +
      '" stroke-width="' + sw + '"/>';

    var model = [];
    list.forEach(function (s, si) {
      var frac = (s.value || 0) / total;
      var a0 = acc, a1 = acc + frac * Math.PI * 2;
      acc = a1;
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var color = col(s.color, "mint");
      var arcLen = Math.max(1, Math.ceil(r * (a1 - a0)));
      out += '<path class="ch-arc" data-i="' + si + '" style="--len:' + arcLen + ";--delay:" + (90 + si * 150) +
        "ms;--dur:" + (520 + arcLen) + 'ms" d="M ' + x0.toFixed(2) + " " + y0.toFixed(2) + " A " + r + " " + r + " 0 " +
        large + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + '" fill="none" stroke="' + color +
        '" stroke-width="' + sw + '" stroke-linecap="butt"/>';
      model.push({
        label: s.label, value: s.value, unit: s.unit || o.unit || "", color: color,
        pct: frac * 100, mid: (a0 + a1) / 2
      });
    });

    if (o.center) {
      out += '<text class="ch-fade" style="--delay:520ms" x="' + cx + '" y="' + (cy - 2) +
        '" text-anchor="middle" font-size="22" font-weight="600" fill="' + p.ink + '">' + C.esc(o.center) + "</text>";
      if (o.centerSub) {
        out += '<text class="ch-fade" style="--delay:600ms" x="' + cx + '" y="' + (cy + 16) +
          '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
          C.esc(o.centerSub) + "</text>";
      }
    }
    out += "</svg>";

    register(id, { kind: "donut", cx: cx, cy: cy, r: r, sw: sw, total: total, slices: model, title: o.tipTitle || o.centerSub || "" });

    out += '<div class="chart-legend">' + model.map(function (s) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' +
        C.esc(s.label) + ' <span class="mono muted">' + C.fmt.num(s.pct, 0) + "%</span></span>";
    }).join("") + "</div>";
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     RADIAL GAUGE — arc sweeps to the value; hovering reads out value + unit.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.gauge = function (value, opts) {
    var o = opts || {};
    var p = C.theme.palette();
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    var size = 132, r = 50, cx = size / 2, cy = size / 2, sw = 11;
    var a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    var a1 = a0 + span * (v / 100);
    function pt(a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
    var p0 = pt(a0), p1 = pt(a1), pE = pt(a0 + span);
    var color = o.color ? col(o.color, "mint") : C.hue(v < 34 ? "mint" : v < 62 ? "amber" : "rose");
    var arcLen = Math.max(1, Math.ceil(r * span * (v / 100)));
    var id = nid("chg");

    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="gauge" viewBox="0 0 ' + size + " " + size +
      '" style="max-height:146px" role="img" aria-label="' + C.esc((o.label || "Score") + ": " + Math.round(v)) + '">' +
      '<path d="M ' + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A " + r + " " + r + " 0 1 1 " +
      pE[0].toFixed(2) + " " + pE[1].toFixed(2) + '" fill="none" stroke="' + p["chart-grid-2"] +
      '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      (v > 0.5
        ? '<path class="ch-arc" style="--len:' + arcLen + ';--dur:1000ms;--delay:120ms" d="M ' +
          p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A " + r + " " + r + " 0 " +
          (span * (v / 100) > Math.PI ? 1 : 0) + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) +
          '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round"/>'
        : "") +
      '<text class="ch-fade" style="--delay:340ms" x="' + cx + '" y="' + (cy + 4) +
      '" text-anchor="middle" font-size="27" font-weight="600" fill="' + p.ink + '">' + Math.round(v) + "</text>" +
      '<text class="ch-fade" style="--delay:420ms" x="' + cx + '" y="' + (cy + 22) +
      '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
      C.esc(o.sub || "/100") + "</text>" +
      '<rect class="ch-hit" x="0" y="0" width="' + size + '" height="' + size + '"/>' +
      "</svg>";

    register(id, {
      kind: "gauge", cx: cx, cy: cy, value: v, color: color,
      label: o.label || o.sub || "Score", unit: o.unit || "/100",
      exact: o.exact !== undefined ? o.exact : v,
      foot: o.foot || ""
    });
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCATTER + least-squares fit. Dots pop in; nearest-point hover.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.scatter = function (cfg) {
    var p = C.theme.palette();
    var pts = (cfg.points || []).filter(function (q) { return q && isFinite(q.x) && isFinite(q.y); });
    if (pts.length < 2) return '<div class="empty">Not enough paired observations</div>';
    var w = 760, h = cfg.height || 226;
    var m = { t: 14, r: 14, b: 30, l: 44 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;
    var exX = extent([pts.map(function (q) { return q.x; })]);
    var exY = extent([pts.map(function (q) { return q.y; })]);
    var sx = function (x) { return m.l + ((x - exX[0]) / (exX[1] - exX[0] || 1)) * iw; };
    var sy = function (y) { return m.t + ih - ((y - exY[0]) / (exY[1] - exY[0] || 1)) * ih; };

    var n = pts.length;
    var mx = pts.reduce(function (a, q) { return a + q.x; }, 0) / n;
    var my = pts.reduce(function (a, q) { return a + q.y; }, 0) / n;
    var num = 0, den = 0;
    pts.forEach(function (q) { num += (q.x - mx) * (q.y - my); den += (q.x - mx) * (q.x - mx); });
    var slope = den === 0 ? 0 : num / den;
    var icept = my - slope * mx;

    var dotColor = col(cfg.color, "mint");
    var fitColor = col(cfg.fitColor || "blue", "blue");
    var id = nid("chs");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="scatter" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="' + C.esc(cfg.aria || "Scatter plot") + '">';
    for (var g = 0; g <= 4; g++) {
      var yv = exY[0] + ((exY[1] - exY[0]) * g) / 4;
      var y = sy(yv);
      out += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - m.r) + '" y2="' + y.toFixed(1) +
        '" stroke="' + p["chart-grid"] + '"/>';
      out += '<text class="ch-fade" x="' + (m.l - 7) + '" y="' + (y + 3).toFixed(1) +
        '" text-anchor="end" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis"] + '">' +
        C.fmt.num(yv, 1) + "</text>";
    }
    for (var gx = 0; gx <= 4; gx++) {
      var xv = exX[0] + ((exX[1] - exX[0]) * gx) / 4;
      out += '<text class="ch-fade" x="' + sx(xv).toFixed(1) + '" y="' + (h - 12) +
        '" text-anchor="middle" font-size="8.5" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
        C.fmt.num(xv, 0) + "</text>";
    }
    var fitPts = [[sx(exX[0]), sy(icept + slope * exX[0])], [sx(exX[1]), sy(icept + slope * exX[1])]];
    out += '<path class="ch-line" style="--len:' + polyLen(fitPts) + ';--dur:900ms" d="' + pathFrom(fitPts) +
      '" fill="none" stroke="' + fitColor + '" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.85"/>';

    var model = [];
    pts.forEach(function (q, i) {
      var px = sx(q.x), py = sy(q.y);
      out += '<circle class="ch-pop" data-i="' + i + '" style="--delay:' + (120 + i * 14) + 'ms" cx="' + px.toFixed(2) +
        '" cy="' + py.toFixed(2) + '" r="3.1" fill="' + dotColor + '" opacity="' + (0.42 + 0.5 * (i / n)).toFixed(2) + '"/>';
      model.push({ x: q.x, y: q.y, px: px, py: py, label: q.label || "" });
    });
    out += '<text class="ch-fade" x="' + (w - m.r) + '" y="' + (m.t + 10) +
      '" text-anchor="end" font-size="9" font-family="Space Mono,monospace" fill="' + alpha(fitColor, 0.9) + '">' +
      C.esc((cfg.xLabel || "x") + " → " + (cfg.yLabel || "y")) + "</text>";
    out += '<rect class="ch-hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>';
    out += '<g class="ch-focus-dot"><circle class="ring" cx="-99" cy="-99" r="4" fill="none" stroke="' + dotColor +
      '" stroke-width="1.4"/><circle class="fd" cx="-99" cy="-99" r="4" fill="' + dotColor + '" stroke="' +
      p["chart-dot-stroke"] + '" stroke-width="1.3"/></g>';
    out += "</svg>";

    register(id, {
      kind: "scatter", points: model, color: dotColor,
      xLabel: cfg.xLabel || "x", yLabel: cfg.yLabel || "y",
      xUnit: cfg.xUnit || "", yUnit: cfg.yUnit || "",
      title: cfg.tipTitle || ""
    });
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     HEAT STRIP — cells pop in left→right; per-cell tooltip with units.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.heat = function (cfg) {
    var p = C.theme.palette();
    var cells = cfg.cells || [];
    if (!cells.length) return '<div class="empty">No exposure data</div>';
    var cols = cfg.cols || cells.length;
    var w = 760, cellH = cfg.cellH || 34;
    var cw = w / cols;
    var max = Math.max.apply(null, cells.map(function (c2) { return c2.value; }).concat([1]));
    var id = nid("chh");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="heat" viewBox="0 0 ' + w + " " + (cellH + 20) +
      '" role="img" aria-label="' + C.esc(cfg.aria || "Heat strip") + '">';
    var model = [];
    cells.forEach(function (c2, i) {
      var t = Math.max(0, Math.min(1, c2.value / max));
      var color = cfg.scale ? cfg.scale(t, c2.value) : alpha(C.hue("mint"), (0.14 + t * 0.8).toFixed(2));
      out += '<rect class="ch-pop" data-i="' + i + '" style="--delay:' + (30 + i * 9) + 'ms" x="' + (i * cw).toFixed(2) +
        '" y="0" width="' + (cw - 1.2).toFixed(2) + '" height="' + cellH + '" rx="3" fill="' + color + '"/>';
      model.push({ label: c2.label, value: c2.value, unit: c2.unit || cfg.unit || "", tick: c2.tick || "", color: color, x: i * cw, w: cw });
      var step = Math.max(1, Math.ceil(cols / 12));
      if (i % step === 0) {
        out += '<text class="ch-fade" x="' + (i * cw + cw / 2).toFixed(2) + '" y="' + (cellH + 13) +
          '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
          C.esc(c2.tick || "") + "</text>";
      }
    });
    out += '<rect class="ch-hit" x="0" y="0" width="' + w + '" height="' + cellH + '"/>';
    out += "</svg>";
    register(id, { kind: "heat", cells: model, cw: cw, cellH: cellH, valueName: cfg.valueName || "Value", title: cfg.tipTitle || "" });
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     CAUSAL GRAPH — community-clustered radial layout.
     Node colours come from C.domainColor() (palette-resolved), edges and the
     arrow marker from chart tokens, so the whole graph re-tints on a flip.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.graph = function (graph, opts) {
    var o = opts || {};
    var p = C.theme.palette();
    var nodes = graph.nodes || [];
    var edges = graph.edges || [];
    if (!nodes.length) return '<div class="empty">Graph not yet constructed</div>';

    var w = 900, h = o.height || 520;
    var cx = w / 2, cy = h / 2;

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
    var arrowId = nid("cgArrow");

    var out = '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Personal causal knowledge graph">';
    out += '<defs><marker id="' + arrowId + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + p["chart-arrow"] + '"/></marker></defs>';

    edges.forEach(function (e, ei) {
      var a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      var active = !focus || focus === e.source || focus === e.target;
      var mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.13;
      var my = (a.y + b.y) / 2 - (b.x - a.x) * 0.13;
      out += '<path class="gedge ch-fade" style="--delay:' + (20 + ei * 12) + 'ms" d="M ' + a.x.toFixed(1) + " " + a.y.toFixed(1) +
        " Q " + mx.toFixed(1) + " " + my.toFixed(1) + " " + b.x.toFixed(1) + " " + b.y.toFixed(1) +
        '" fill="none" stroke="' + (active ? p["chart-edge-active"] : p["chart-edge-idle"]) +
        '" stroke-width="' + (0.6 + e.strength * 2.6).toFixed(2) + '" marker-end="url(#' + arrowId +
        ')" stroke-opacity="' + (active ? 0.9 : 0.3) + '" data-edge="' + C.esc(e.source + "|" + e.target) + '"><title>' +
        C.esc(e.source + " --" + e.relation + "--> " + e.target + "  strength " + e.strength + ", lag " + e.lagHours + "h, conf " + e.confidence) +
        "</title></path>";
    });

    nodes.forEach(function (n, ni) {
      var q = pos[n.id];
      if (!q) return;
      var color = C.domainColor(n.domain);
      var pprScale = n.ppr ? n.ppr / maxPpr : 0;
      var r = 9 + n.weight * 8 + pprScale * 8;
      var dim = focus && focus !== n.id && !edges.some(function (e) {
        return (e.source === focus && e.target === n.id) || (e.target === focus && e.source === n.id);
      });
      out += '<g class="gnode ch-pop" style="--delay:' + (140 + ni * 22) + 'ms" data-node="' + C.esc(n.id) +
        '" data-domain="' + C.esc(n.domain || "") + '" opacity="' + (dim ? 0.34 : 1) + '" tabindex="0">' +
        (pprScale > 0.02
          ? '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + (r + 7 + pprScale * 9).toFixed(1) +
            '" fill="' + color + '" opacity="' + (0.07 + pprScale * 0.17).toFixed(3) + '"/>'
          : "") +
        '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color +
        '" fill-opacity="0.22" stroke="' + color + '" stroke-width="' + (focus === n.id ? 2.6 : 1.5) + '"/>' +
        '<text x="' + q.x.toFixed(1) + '" y="' + (q.y + r + 11).toFixed(1) + '" text-anchor="middle">' + C.esc(n.label) + "</text>" +
        "<title>" + C.esc(n.label + " · " + n.domain + (n.ppr ? " · PPR " + n.ppr : "")) + "</title></g>";
    });

    out += "</svg>";
    return '<div class="graph-stage tip-host" id="graph-stage">' + out + '<div class="graph-tip" id="graph-tip"></div></div>';
  };

  /* ══════════════════════════════════════════════════════════════════════
     WATERFALL (counterfactual deltas) — bars grow from the zero line.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.waterfall = function (rows, opts) {
    var o = opts || {};
    var p = C.theme.palette();
    var list = rows || [];
    if (!list.length) return '<div class="empty">Adjust a lever to simulate</div>';
    var w = 760, h = o.height || 220;
    var m = { t: 16, r: 14, b: 40, l: 14 };
    var iw = w - m.l - m.r, ih = h - m.t - m.b;
    var max = Math.max.apply(null, list.map(function (r) { return Math.abs(r.value); }).concat([0.01]));
    var slot = iw / list.length;
    var zero = m.t + ih / 2;
    var id = nid("chw");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="waterfall" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="Projected change by outcome">';
    out += '<line x1="' + m.l + '" y1="' + zero + '" x2="' + (w - m.r) + '" y2="' + zero + '" stroke="' + p["chart-zero"] + '"/>';
    out += '<rect class="ch-band-hl" x="0" y="' + m.t + '" width="' + slot.toFixed(2) + '" height="' + ih + '" rx="3"/>';

    var model = [];
    list.forEach(function (r, i) {
      var bh = (Math.abs(r.value) / max) * (ih / 2 - 8);
      var up = r.value > 0;
      var x = m.l + slot * i + slot * 0.24;
      var bw = slot * 0.52;
      var color = C.hue(r.good ? "mint" : "rose");
      var delay = 60 + i * 90;
      out += '<rect class="ch-bar" style="--delay:' + delay + 'ms;transform-origin:50% ' + (up ? "100%" : "0%") +
        '" x="' + x.toFixed(1) + '" y="' + (up ? zero - bh : zero).toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + Math.max(1.4, bh).toFixed(1) + '" rx="3" fill="' + color + '" opacity="0.88"/>';
      out += '<text class="ch-fade" style="--delay:' + (delay + 220) + 'ms" x="' + (x + bw / 2).toFixed(1) +
        '" y="' + (up ? zero - bh - 6 : zero + bh + 13).toFixed(1) +
        '" text-anchor="middle" font-size="9" font-family="Space Mono,monospace" fill="' + color + '">' +
        (r.value > 0 ? "+" : "") + C.fmt.num(r.value, 2) + "</text>";
      var words = String(r.label).split(" ");
      var l1 = words.slice(0, 2).join(" ");
      var l2 = words.slice(2).join(" ");
      out += '<text class="ch-fade" style="--delay:' + (delay + 260) + 'ms" x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 20) +
        '" text-anchor="middle" font-size="8.3" fill="' + p["chart-axis"] + '">' + C.esc(l1) + "</text>";
      if (l2) {
        out += '<text class="ch-fade" style="--delay:' + (delay + 300) + 'ms" x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 10) +
          '" text-anchor="middle" font-size="8.3" fill="' + p["chart-axis-dim"] + '">' + C.esc(l2) + "</text>";
      }
      model.push({ label: r.label, value: r.value, unit: r.unit || "", good: !!r.good, color: color });
    });
    out += '<rect class="ch-hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>';
    out += "</svg>";
    register(id, { kind: "waterfall", m: m, slot: slot, rows: model, title: o.tipTitle || "Projected change" });
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };

  /* ══════════════════════════════════════════════════════════════════════
     SWARM TOPOLOGY (Mixture-of-Agents) — nodes pop in, edges fade in.
     ══════════════════════════════════════════════════════════════════════ */
  Ch.swarmTopology = function (agents, consensus) {
    var p = C.theme.palette();
    var all = agents || [];
    var l1 = all.filter(function (a) { return a.layer === 1; });
    var l2 = all.filter(function (a) { return a.layer === 2; });
    if (!l1.length) return '<div class="empty">No layer-1 agents reported</div>';
    var w = 760, h = 210;
    var id = nid("cht");
    var out = '<svg id="' + id + '" class="chart ch-i" data-ch="swarm" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="Mixture-of-Agents topology">';
    var y1 = 52, y2 = 158;
    var cx = w / 2;
    var accent = C.hue("mint");
    var model = [];

    l1.forEach(function (a, i) {
      var x = ((i + 0.5) / l1.length) * w;
      var col1 = C.domainColor(a.domain);
      var delay = 80 + i * 80;
      out += '<line class="ch-fade" style="--delay:' + (delay + 160) + 'ms" x1="' + x.toFixed(1) + '" y1="' + (y1 + 16) +
        '" x2="' + cx + '" y2="' + (y2 - 18) + '" stroke="' + alpha(accent, (0.16 + a.confidence * 0.4).toFixed(2)) +
        '" stroke-width="' + (0.7 + a.confidence * 1.7).toFixed(2) + '"/>';
      out += '<g class="ch-pop" data-i="' + i + '" style="--delay:' + delay + 'ms">' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y1 + '" r="15" fill="' + col1 + '" fill-opacity="0.2" stroke="' + col1 + '" stroke-width="1.5"/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y1 + 4) + '" text-anchor="middle" font-size="9.5" font-family="Space Mono,monospace" fill="' + col1 + '">' +
        C.esc(String(a.vote || "").slice(0, 3).toUpperCase()) + "</text></g>";
      out += '<text class="ch-fade" style="--delay:' + (delay + 120) + 'ms" x="' + x.toFixed(1) + '" y="' + (y1 - 24) +
        '" text-anchor="middle" font-size="8.2" fill="' + p["chart-axis"] + '">' +
        C.esc(String(a.name || "").replace(/ (Agent|\/ Circadian Agent|Sentiment Agent)$/, "").slice(0, 16)) + "</text>";
      out += '<text class="ch-fade" style="--delay:' + (delay + 160) + 'ms" x="' + x.toFixed(1) + '" y="' + (y1 + 30) +
        '" text-anchor="middle" font-size="7.8" font-family="Space Mono,monospace" fill="' + p["chart-axis-dim"] + '">' +
        a.latencyMs + "ms · " + a.confidence + "</text>";
      model.push({ x: x, y: y1, agent: a, color: col1 });
    });

    var coord = l2[0];
    out += '<g class="ch-pop" data-coord="1" style="--delay:' + (140 + l1.length * 80) + 'ms">' +
      '<circle cx="' + cx + '" cy="' + y2 + '" r="21" fill="' + accent + '" fill-opacity="0.22" stroke="' + accent + '" stroke-width="2"/>' +
      '<text x="' + cx + '" y="' + (y2 + 4) + '" text-anchor="middle" font-size="10" font-family="Space Mono,monospace" fill="' + accent + '">' +
      C.esc(consensus && consensus.vote ? String(consensus.vote).slice(0, 4).toUpperCase() : "SYNTH") + "</text></g>";
    out += '<text class="ch-fade" x="' + cx + '" y="' + (y2 + 40) + '" text-anchor="middle" font-size="8.6" fill="' + p["chart-axis"] +
      '">Preventive-Care Coordinator (layer 2)</text>';
    if (coord) {
      out += '<text class="ch-fade" x="' + cx + '" y="' + (y2 - 30) + '" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" fill="' +
        p["chart-axis-dim"] + '">' + C.esc(coord.model) + "</text>";
    }
    out += '<text class="ch-fade" x="12" y="' + (y1 - 40) + '" font-size="8.4" font-family="Space Mono,monospace" fill="' +
      alpha(C.hue("blue"), 0.85) + '">LAYER 1 — SPECIALISTS</text>';
    out += "</svg>";
    register(id, { kind: "swarm", nodes: model, coord: coord, consensus: consensus, accent: accent });
    return '<div class="chart-wrap tip-host">' + out + "</div>";
  };
})();

/* ══════════════════════════════════════════════════════════════════════════
   CHART INTERACTION BINDER
   --------------------------------------------------------------------------
   `Ch.bind(root)` is called by app.js after every view render (and after a
   theme flip re-render). It attaches pointer handlers to each `svg.ch-i` whose
   model was registered above.

   Design notes
   ------------
   • Hit-testing happens in **viewBox** coordinates, converted from client
     coordinates via the SVG's own CTM. That makes it correct at every
     breakpoint and zoom level without the chart knowing its pixel size — the
     reason a fixed-viewBox SVG can stay interactive while fluid.
   • Handlers are registered once per element (`_chBound`) so repeated binds
     after silent refreshes cannot stack listeners.
   • Touch is supported: a tap reads out the nearest point, and a second tap
     elsewhere dismisses. Pointer events are used where available so pen input
     behaves like a mouse.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var Ch = C.chart;

  /* Models live in the previous IIFE's closure and are reached through the
     `Ch.model(id)` accessor it installs — the map itself is never exported. */

  function toViewBox(svg, clientX, clientY) {
    var pt;
    if (svg.createSVGPoint) {
      pt = svg.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      var ctm = svg.getScreenCTM();
      if (ctm) {
        var inv = ctm.inverse();
        var r = pt.matrixTransform(inv);
        return { x: r.x, y: r.y };
      }
    }
    /* Fallback: linear map from the bounding box onto the viewBox. */
    var box = svg.getBoundingClientRect();
    var vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/\s+/).map(Number);
    return {
      x: vb[0] + ((clientX - box.left) / (box.width || 1)) * vb[2],
      y: vb[1] + ((clientY - box.top) / (box.height || 1)) * vb[3]
    };
  }

  /** Host-relative pixel position for the tooltip, from a viewBox point. */
  function toHostPx(svg, host, vx, vy) {
    var box = svg.getBoundingClientRect();
    var hostBox = host.getBoundingClientRect();
    var vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/\s+/).map(Number);
    var sx = (box.width || 1) / (vb[2] || 1);
    var sy = (box.height || 1) / (vb[3] || 1);
    return {
      x: box.left - hostBox.left + (vx - vb[0]) * sx,
      y: box.top - hostBox.top + (vy - vb[1]) * sy
    };
  }

  function fmtVal(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var abs = Math.abs(v);
    var d;
    if (/mmhg|bpm|aqi|ms|mg|ml|steps|kcal|hpa|µg\/m³|ug\/m3|%|constraints/i.test(unit || "")) d = 0;
    else if (abs >= 1000) d = 0;
    else if (abs >= 100) d = 1;
    else if (abs >= 1) d = 2;
    else d = 3;
    return C.fmt.num(v, d);
  }

  /** Timestamp / label footer. ISO-ish labels are rendered as real times. */
  function footFor(model, i) {
    if (model.times && model.times[i]) {
      var t = model.times[i];
      var d = new Date(t);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      }
      return String(t);
    }
    var lbl = model.labels && model.labels[i];
    return lbl ? String(lbl) : "";
  }

  /* ── Per-kind handlers ─────────────────────────────────────────────────── */

  function bindLine(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    var cross = svg.querySelector(".ch-crosshair");
    var crossLine = cross ? cross.querySelector("line") : null;
    var dots = svg.querySelector(".ch-focus-dot");
    var band = svg.querySelector(".ch-band-hl");
    if (!hit) return;

    function nearestIndex(vx) {
      var best = 0, bestD = Infinity;
      for (var i = 0; i < model.xs.length; i++) {
        var d = Math.abs(model.xs[i] - vx);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    function move(ev) {
      var pt = toViewBox(svg, ev.clientX, ev.clientY);
      var i = nearestIndex(pt.x);
      var x = model.xs[i];

      if (crossLine) {
        crossLine.setAttribute("x1", x.toFixed(2));
        crossLine.setAttribute("x2", x.toFixed(2));
        cross.classList.add("is-on");
      }
      if (band) {
        var bw = Number(band.getAttribute("width")) || 8;
        band.setAttribute("x", (x - bw / 2).toFixed(2));
        band.classList.add("is-on");
      }

      var rows = [];
      var circles = dots ? dots.querySelectorAll("circle") : [];
      model.series.forEach(function (s, si) {
        var v = s.values[i];
        var p = s.pts[i];
        var ring = circles[si * 2];
        var fd = circles[si * 2 + 1];
        if (p && v !== null && v !== undefined) {
          if (ring) { ring.setAttribute("cx", p[0].toFixed(2)); ring.setAttribute("cy", p[1].toFixed(2)); }
          if (fd) { fd.setAttribute("cx", p[0].toFixed(2)); fd.setAttribute("cy", p[1].toFixed(2)); }
          rows.push({ name: s.name, value: fmtVal(v, s.unit), unit: s.unit, color: s.color });
        } else {
          if (ring) { ring.setAttribute("cx", "-99"); ring.setAttribute("cy", "-99"); }
          if (fd) { fd.setAttribute("cx", "-99"); fd.setAttribute("cy", "-99"); }
          rows.push({ name: s.name, value: "—", unit: s.unit, color: s.color });
        }
      });
      if (dots) dots.classList.add("is-on");

      var top = Math.min.apply(null, model.series.map(function (s) {
        return s.pts[i] ? s.pts[i][1] : model.m.t + model.ih;
      }));
      var px = toHostPx(svg, host, x, top);
      C.tip.show(host, {
        title: model.title || footFor(model, i) || "Reading",
        rows: rows,
        foot: model.title ? footFor(model, i) : ""
      }, px.x, px.y);
    }

    function leave() {
      if (cross) cross.classList.remove("is-on");
      if (dots) dots.classList.remove("is-on");
      if (band) band.classList.remove("is-on");
      C.tip.hide(host);
    }

    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    svg.addEventListener("pointerleave", leave);
  }

  function bindBars(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    var band = svg.querySelector(".ch-band-hl");
    if (!hit) return;

    function move(ev) {
      var pt = toViewBox(svg, ev.clientX, ev.clientY);
      var i = Math.max(0, Math.min(model.n - 1, Math.floor((pt.x - model.m.l) / model.slot)));
      var x = model.m.l + model.slot * i;
      if (band) { band.setAttribute("x", x.toFixed(2)); band.classList.add("is-on"); }

      var rows = model.series.map(function (s) {
        return { name: s.name, value: fmtVal(s.values[i], s.unit), unit: s.unit, color: s.color };
      });
      if (model.stacked && model.series.length > 1) {
        var total = model.series.reduce(function (a, s) { return a + (Number(s.values[i]) || 0); }, 0);
        rows.push({ name: "Total", value: fmtVal(total, model.series[0].unit), unit: model.series[0].unit });
      }
      var px = toHostPx(svg, host, x + model.slot / 2, model.m.t);
      C.tip.show(host, {
        title: model.title || footFor(model, i) || "Bucket",
        rows: rows,
        foot: model.title ? footFor(model, i) : ""
      }, px.x, px.y);
    }
    function leave() {
      if (band) band.classList.remove("is-on");
      C.tip.hide(host);
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    svg.addEventListener("pointerleave", leave);
  }

  function bindDonut(svg, host, model) {
    svg.querySelectorAll(".ch-arc").forEach(function (arc) {
      var i = Number(arc.getAttribute("data-i"));
      var s = model.slices[i];
      if (!s) return;
      arc.style.cursor = "pointer";
      function show(ev) {
        svg.querySelectorAll(".ch-arc").forEach(function (a) { a.setAttribute("opacity", a === arc ? "1" : "0.42"); });
        var vx = model.cx + model.r * Math.cos(s.mid);
        var vy = model.cy + model.r * Math.sin(s.mid);
        var px = toHostPx(svg, host, vx, vy);
        C.tip.show(host, {
          title: model.title || "Share",
          rows: [
            { name: s.label, value: fmtVal(s.value, s.unit), unit: s.unit, color: s.color },
            { name: "Share", value: C.fmt.num(s.pct, 1), unit: "%" }
          ],
          foot: "of " + fmtVal(model.total, s.unit) + (s.unit ? " " + s.unit : "") + " total"
        }, px.x, px.y);
        if (ev) ev.stopPropagation();
      }
      function hide() {
        svg.querySelectorAll(".ch-arc").forEach(function (a) { a.setAttribute("opacity", "1"); });
        C.tip.hide(host);
      }
      arc.addEventListener("pointerenter", show);
      arc.addEventListener("pointermove", show);
      arc.addEventListener("pointerdown", show);
      arc.addEventListener("pointerleave", hide);
    });
    svg.addEventListener("pointerleave", function () { C.tip.hide(host); });
  }

  function bindGauge(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    if (!hit) return;
    function show() {
      var px = toHostPx(svg, host, model.cx, model.cy - 22);
      C.tip.show(host, {
        title: model.label,
        rows: [{ name: "Value", value: fmtVal(model.exact, model.unit), unit: model.unit, color: model.color }],
        foot: model.foot || ""
      }, px.x, px.y);
    }
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", function () { C.tip.hide(host); });
  }

  function bindScatter(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    var dots = svg.querySelector(".ch-focus-dot");
    if (!hit) return;
    function move(ev) {
      var pt = toViewBox(svg, ev.clientX, ev.clientY);
      var best = null, bestD = Infinity;
      model.points.forEach(function (q) {
        var dx = q.px - pt.x, dy = q.py - pt.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = q; }
      });
      if (!best) return;
      if (dots) {
        dots.querySelectorAll("circle").forEach(function (c2) {
          c2.setAttribute("cx", best.px.toFixed(2));
          c2.setAttribute("cy", best.py.toFixed(2));
        });
        dots.classList.add("is-on");
      }
      var px = toHostPx(svg, host, best.px, best.py);
      C.tip.show(host, {
        title: model.title || best.label || "Observation",
        rows: [
          { name: model.xLabel, value: fmtVal(best.x, model.xUnit), unit: model.xUnit, color: model.color },
          { name: model.yLabel, value: fmtVal(best.y, model.yUnit), unit: model.yUnit }
        ],
        foot: best.label || ""
      }, px.x, px.y);
    }
    function leave() {
      if (dots) dots.classList.remove("is-on");
      C.tip.hide(host);
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  function bindHeat(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    if (!hit) return;
    function move(ev) {
      var pt = toViewBox(svg, ev.clientX, ev.clientY);
      var i = Math.max(0, Math.min(model.cells.length - 1, Math.floor(pt.x / model.cw)));
      var c2 = model.cells[i];
      if (!c2) return;
      svg.querySelectorAll(".ch-pop").forEach(function (r, ri) {
        r.setAttribute("stroke", ri === i ? C.theme.palette()["chart-zero"] : "none");
        r.setAttribute("stroke-width", ri === i ? "1.4" : "0");
      });
      var px = toHostPx(svg, host, c2.x + model.cw / 2, 0);
      C.tip.show(host, {
        title: model.title || "Hour",
        rows: [{ name: model.valueName, value: fmtVal(c2.value, c2.unit), unit: c2.unit, color: c2.color }],
        foot: c2.label || c2.tick || ""
      }, px.x, px.y);
    }
    function leave() {
      svg.querySelectorAll(".ch-pop").forEach(function (r) { r.setAttribute("stroke", "none"); r.setAttribute("stroke-width", "0"); });
      C.tip.hide(host);
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  function bindWaterfall(svg, host, model) {
    var hit = svg.querySelector(".ch-hit");
    var band = svg.querySelector(".ch-band-hl");
    if (!hit) return;
    function move(ev) {
      var pt = toViewBox(svg, ev.clientX, ev.clientY);
      var i = Math.max(0, Math.min(model.rows.length - 1, Math.floor((pt.x - model.m.l) / model.slot)));
      var r = model.rows[i];
      if (!r) return;
      var x = model.m.l + model.slot * i;
      if (band) { band.setAttribute("x", x.toFixed(2)); band.classList.add("is-on"); }
      var px = toHostPx(svg, host, x + model.slot / 2, model.m.t);
      C.tip.show(host, {
        title: r.label,
        rows: [{
          name: r.good ? "Improvement" : "Deterioration",
          value: (r.value > 0 ? "+" : "") + C.fmt.num(r.value, 2),
          unit: r.unit, color: r.color
        }],
        foot: model.title || ""
      }, px.x, px.y);
    }
    function leave() {
      if (band) band.classList.remove("is-on");
      C.tip.hide(host);
    }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  function bindSwarm(svg, host, model) {
    svg.querySelectorAll("[data-i]").forEach(function (g) {
      var i = Number(g.getAttribute("data-i"));
      var node = model.nodes[i];
      if (!node) return;
      g.style.cursor = "pointer";
      function show(ev) {
        var a = node.agent;
        var px = toHostPx(svg, host, node.x, node.y - 16);
        C.tip.show(host, {
          title: a.name,
          rows: [
            { name: "Vote", value: String(a.vote || "—"), unit: "", color: node.color },
            { name: "Confidence", value: C.fmt.num(a.confidence, 2), unit: "" },
            { name: "Latency", value: C.fmt.num(a.latencyMs, 0), unit: "ms" },
            { name: "Tokens", value: C.fmt.num(a.tokens, 0), unit: "tok" }
          ],
          foot: (a.provider || "") + (a.model ? " · " + a.model : "")
        }, px.x, px.y);
        if (ev) ev.stopPropagation();
      }
      g.addEventListener("pointerenter", show);
      g.addEventListener("pointermove", show);
      g.addEventListener("pointerdown", show);
      g.addEventListener("pointerleave", function () { C.tip.hide(host); });
    });
    var coordEl = svg.querySelector("[data-coord]");
    if (coordEl && model.coord) {
      coordEl.style.cursor = "pointer";
      coordEl.addEventListener("pointerenter", function () {
        var a = model.coord;
        var px = toHostPx(svg, host, 380, 130);
        C.tip.show(host, {
          title: "Layer-2 coordinator",
          rows: [
            { name: "Consensus", value: String((model.consensus && model.consensus.vote) || "—"), unit: "", color: model.accent },
            { name: "Support", value: C.fmt.num((model.consensus && model.consensus.support) || 0, 0), unit: "%" },
            { name: "Latency", value: C.fmt.num(a.latencyMs, 0), unit: "ms" }
          ],
          foot: a.model || ""
        }, px.x, px.y);
      });
      coordEl.addEventListener("pointerleave", function () { C.tip.hide(host); });
    }
  }

  var HANDLERS = {
    line: bindLine, bars: bindBars, donut: bindDonut, gauge: bindGauge,
    scatter: bindScatter, heat: bindHeat, waterfall: bindWaterfall, swarm: bindSwarm
  };

  /**
   * Wires every registered chart inside `root` (default: document) and the
   * `[data-tip]` elements that share the same tooltip engine.
   * Idempotent — safe to call after every render.
   */
  Ch.bind = function (root) {
    var scope = root || document;
    C.$$("svg.ch-i", scope).forEach(function (svg) {
      if (svg._chBound) return;
      var model = Ch.model(svg.id);
      if (!model) return;
      svg._chBound = true;
      var host = C.tip.host(svg);
      var fn = HANDLERS[model.kind];
      if (fn) fn(svg, host, model);
    });
    C.bindTips(scope);
    Ch.prune();
  };
})();
