/* Catena dashboard core — state, API client, formatting, DOM helpers. */
(function () {
  "use strict";

  var C = (window.Catena = window.Catena || {});

  C.state = {
    view: "overview",
    uid: null,
    geo: null,
    cache: {},
    query: "",
    interventions: {},
    horizon: 60,
    epsilon: 1,
    cohort: 1284,
    zkWindow: 30,
    graphFocus: null
  };

  /* ── Persistent per-browser twin id (keeps the graph stable across reloads) ── */
  try {
    var stored = localStorage.getItem("catena-uid");
    if (!stored) {
      stored = "twin-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("catena-uid", stored);
    }
    C.state.uid = stored;
  } catch (e) {
    C.state.uid = "demo-twin-01";
  }

  /* ── Geolocation (optional; API falls back to Cloudflare edge geo) ── */
  C.requestGeo = function () {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4200);
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (done) return;
          done = true; clearTimeout(t);
          C.state.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          resolve(C.state.geo);
        },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } },
        { timeout: 4000, maximumAge: 600000 }
      );
    });
  };

  /* ── API client ── */
  function qs(extra) {
    var p = new URLSearchParams();
    p.set("uid", C.state.uid);
    if (C.state.geo) { p.set("lat", C.state.geo.lat.toFixed(4)); p.set("lon", C.state.geo.lon.toFixed(4)); }
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== "") p.set(k, extra[k]);
    });
    return p.toString();
  }

  C.api = function (path, params, opts) {
    var o = opts || {};
    var url = "/api" + path + "?" + qs(params);
    var init = { headers: { accept: "application/json", "x-catena-user": C.state.uid } };
    if (o.body) {
      init.method = "POST";
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(o.body);
    }
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    if (ctrl) init.signal = ctrl.signal;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, o.timeout || 22000) : null;

    return fetch(url, init)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status + " on " + path);
        return r.json();
      })
      .then(function (j) {
        if (j && j.provenance) C.renderProvenance(j.provenance, j.degraded);
        return j;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  };

  /* ── Formatting ── */
  C.fmt = {
    num: function (v, d) {
      if (v === null || v === undefined || isNaN(v)) return "—";
      var digits = d === undefined ? (Math.abs(v) >= 100 ? 0 : 1) : d;
      return Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    },
    compact: function (v) {
      if (v === null || v === undefined || isNaN(v)) return "—";
      var n = Number(v);
      var a = Math.abs(n);
      if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
      if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(Math.round(n));
    },
    bytes: function (b) {
      if (!b && b !== 0) return "—";
      var u = ["B", "KB", "MB", "GB"];
      var i = 0; var v = Number(b);
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + " " + u[i];
    },
    pct: function (v, d) { return C.fmt.num(v, d === undefined ? 1 : d) + "%"; },
    time: function (iso) {
      if (!iso) return "—";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },
    day: function (iso) {
      if (!iso) return "—";
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(5);
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    },
    dayShort: function (iso) { return String(iso || "").slice(5).replace("-", "/"); },
    rel: function (iso) {
      if (!iso) return "—";
      var diff = Date.now() - new Date(iso).getTime();
      if (isNaN(diff)) return "—";
      var m = Math.round(diff / 60000);
      if (m < 1) return "just now";
      if (m < 60) return m + "m ago";
      var h = Math.round(m / 60);
      if (h < 24) return h + "h ago";
      return Math.round(h / 24) + "d ago";
    },
    until: function (iso) {
      var diff = new Date(iso).getTime() - Date.now();
      if (isNaN(diff)) return "—";
      if (diff < 0) return "due now";
      var m = Math.round(diff / 60000);
      if (m < 60) return "in " + m + "m";
      var h = Math.floor(m / 60);
      return "in " + h + "h " + (m % 60) + "m";
    },
    hash: function (h, n) {
      if (!h) return "—";
      var s = String(h);
      var k = n || 10;
      return s.length > k * 2 + 3 ? s.slice(0, k + 2) + "…" + s.slice(-k) : s;
    }
  };

  C.esc = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  /* ── Semantic scales ── */
  C.tone = function (v, good, warn) {
    if (v === null || v === undefined || isNaN(v)) return "";
    if (v <= good) return "good";
    if (v <= warn) return "warn";
    return "bad";
  };
  C.toneHigh = function (v, good, warn) {
    if (v === null || v === undefined || isNaN(v)) return "";
    if (v >= good) return "good";
    if (v >= warn) return "warn";
    return "bad";
  };
  C.riskTone = function (score) { return score < 34 ? "good" : score < 62 ? "warn" : "bad"; };

  C.DOMAIN_COLOR = {
    medication: "#7cf5c4",
    sleep: "#79b8ff",
    environment: "#6ee7f5",
    mental: "#b79dff",
    nutrition: "#ffcf7a",
    vital: "#ff8fa3",
    finance: "#9aa4b2",
    symptom: "#ff9f6e"
  };

  C.deltaHtml = function (d, invert) {
    if (d === null || d === undefined || isNaN(d)) return '<span class="delta flat">—</span>';
    var v = Number(d);
    var pos = invert ? v < 0 : v > 0;
    var cls = Math.abs(v) < 0.05 ? "flat" : pos ? "up" : "down";
    var icon = Math.abs(v) < 0.05 ? "bi-dash" : v > 0 ? "bi-arrow-up-short" : "bi-arrow-down-short";
    return '<span class="delta ' + cls + '"><i class="bi ' + icon + '"></i>' + C.fmt.num(Math.abs(v), 1) + "%</span>";
  };

  /* ── DOM helpers ── */
  C.$ = function (sel, root) { return (root || document).querySelector(sel); };
  C.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  C.toast = function (msg, ms) {
    var el = C.$("#dash-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("is-on"); }, ms || 2600);
  };

  C.setLive = function (status, text) {
    var chip = C.$("#live-chip");
    var label = C.$("#live-chip-text");
    if (!chip || !label) return;
    chip.classList.remove("is-degraded", "is-error");
    if (status === "degraded") chip.classList.add("is-degraded");
    if (status === "error") chip.classList.add("is-error");
    label.textContent = text;
  };

  C.renderProvenance = function (prov, degraded) {
    var strip = C.$("#prov-strip");
    if (!strip || !prov) return;
    var live = prov.filter(function (p) { return p.live; }).length;
    strip.innerHTML = prov
      .slice(0, 14)
      .map(function (p) {
        return (
          '<span class="prov-pill ' + (p.live ? "" : "is-off") + '" title="' +
          C.esc(p.source + " · " + (p.detail || (p.live ? "live" : "fallback"))) + '">' +
          '<span class="pdot"></span>' + C.esc(p.source) +
          (p.detail ? ' <span class="muted">' + C.esc(p.detail) + "</span>" : "") +
          "</span>"
        );
      })
      .join("");
    C.setLive(degraded ? "degraded" : "ok", live + "/" + prov.length + " live");
  };

  /* ── Section builders ── */
  C.card = function (opts) {
    var o = opts || {};
    return (
      '<section class="card ' + (o.cls || "") + '"' + (o.id ? ' id="' + o.id + '"' : "") + ">" +
      (o.title
        ? '<div class="card-head"><div style="min-width:0"><h3 class="card-title">' + C.esc(o.title) + "</h3>" +
          (o.note ? '<p class="card-note">' + C.esc(o.note) + "</p>" : "") +
          "</div>" +
          (o.right ? "<div>" + o.right + "</div>" : o.icon ? '<span class="card-icon"><i class="bi ' + o.icon + '"></i></span>' : "") +
          "</div>"
        : "") +
      (o.body || "") +
      "</section>"
    );
  };

  C.viewHead = function (kicker, title, sub, actions) {
    return (
      '<div class="view-head"><div class="view-head-text">' +
      '<p class="view-kicker">' + C.esc(kicker) + "</p>" +
      '<h2 class="view-title">' + C.esc(title) + "</h2>" +
      (sub ? '<p class="view-sub">' + sub + "</p>" : "") +
      "</div>" +
      (actions ? '<div class="view-actions">' + actions + "</div>" : "") +
      "</div>"
    );
  };

  C.skeleton = function (n) {
    var out = '<div class="bento">';
    for (var i = 0; i < (n || 6); i++) {
      out += '<div class="' + (i < 2 ? "c6" : "c4") + ' skeleton ' + (i < 2 ? "sk-t" : "sk-h") + '"></div>';
    }
    return out + "</div>";
  };

  C.errBox = function (err, retryView) {
    return (
      '<div class="err-box"><b>Could not load live data.</b><br />' + C.esc(String(err && err.message ? err.message : err)) +
      '<div class="mt12"><button type="button" class="btn btn-sm" data-retry="' + C.esc(retryView || "") + '">' +
      '<i class="bi bi-arrow-repeat"></i> Retry</button></div></div>'
    );
  };

  C.statCell = function (k, v, unit) {
    return (
      '<div class="stat-cell"><p class="stat-k">' + C.esc(k) + '</p>' +
      '<p class="stat-v">' + v + (unit ? "<small>" + C.esc(unit) + "</small>" : "") + "</p></div>"
    );
  };

  C.bar = function (pct, cls) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<div class="bar-track"><div class="bar-fill ' + (cls || "") + '" style="width:' + p + '%"></div></div>';
  };
})();
