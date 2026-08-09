/* Catena dashboard core — state, API client, formatting, DOM helpers. */
(function () {
  "use strict";

  var C = (window.Catena = window.Catena || {});

  /* ══════════════════════════════════════════════════════════════════════
     THEME RUNTIME
     ----------------------------------------------------------------------
     Why this exists (root cause of the invisible-text bug):

     The previous build painted its dark surface from `.dash-body`, a class the
     App Router's shared layout never applied, while the *text* tokens were
     global. Result: near-white --ink-2/3/4 on the UA-default white body →
     ~1.04:1 contrast → invisible labels, notes, subheads and rail icons.

     The theme is therefore anchored on <html data-theme>, which:
       • cannot be lost by a body-class regression,
       • is set pre-paint by an inline boot script (no FOUC),
       • is the single source of truth for BOTH CSS and SVG-attribute colours.

     Charts write colours into SVG attributes, which CSS cannot restyle. They
     read `C.theme.palette()` instead — a cached snapshot of the very same
     custom properties, refreshed on every theme change.
     ══════════════════════════════════════════════════════════════════════ */
  var THEME_KEY = "catena-theme";
  var PALETTE_VARS = [
    "ink", "ink-2", "ink-3", "ink-4", "ink-graph",
    "accent", "accent-2", "violet", "amber", "rose", "cyan", "orange", "slate",
    "on-accent", "bg", "bg-elev", "panel", "panel-2", "stroke", "stroke-2",
    "chart-grid", "chart-grid-2", "chart-axis", "chart-axis-dim", "chart-zero",
    "chart-dot-stroke", "chart-edge-idle", "chart-edge-active", "chart-arrow",
    "s-mint", "s-blue", "s-violet", "s-amber", "s-rose", "s-cyan", "s-orange", "s-slate"
  ];

  var themeListeners = [];
  var paletteCache = null;

  C.theme = {
    /** Current theme name — always "dark" or "light". */
    get: function () {
      var t = document.documentElement.getAttribute("data-theme");
      return t === "light" ? "light" : "dark";
    },

    /** Stored preference, or null when the visitor never chose one. */
    stored: function () {
      try { var v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : null; }
      catch (e) { return null; }
    },

    /** Applies a theme, persists it, refreshes the palette, notifies views. */
    set: function (name, opts) {
      var next = name === "light" ? "light" : "dark";
      var o = opts || {};
      var root = document.documentElement;
      if (root.getAttribute("data-theme") !== next) root.setAttribute("data-theme", next);
      root.style.colorScheme = next;
      if (o.persist !== false) {
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      }
      paletteCache = null;
      C.theme.syncMeta();
      C.theme.syncToggle();
      if (o.silent) return next;
      themeListeners.forEach(function (fn) { try { fn(next); } catch (e) {} });
      return next;
    },

    toggle: function () {
      return C.theme.set(C.theme.get() === "dark" ? "light" : "dark");
    },

    /** Registers a callback fired after every (non-silent) theme change. */
    onChange: function (fn) { if (typeof fn === "function") themeListeners.push(fn); },

    /** Keeps <meta name="theme-color"> (mobile browser chrome) in step. */
    syncMeta: function () {
      var el = document.querySelector('meta[name="theme-color"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", "theme-color");
        document.head.appendChild(el);
      }
      el.setAttribute("content", C.theme.get() === "light" ? "#eef2f8" : "#07080a");
    },

    /** Reflects state onto the toggle button (a11y + tooltip text). */
    syncToggle: function () {
      var btn = document.getElementById("theme-toggle");
      if (!btn) return;
      var dark = C.theme.get() === "dark";
      var label = dark ? "Switch to light theme" : "Switch to dark theme";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", dark ? "false" : "true");
      var live = document.getElementById("theme-toggle-label");
      if (live) live.textContent = (dark ? "Dark" : "Light") + " theme active";
    },

    /**
     * Resolved colour snapshot for SVG-attribute use. Cached because
     * getComputedStyle is not free and charts read it dozens of times
     * per render.
     */
    palette: function () {
      if (paletteCache) return paletteCache;
      var cs = getComputedStyle(document.documentElement);
      var p = { name: C.theme.get() };
      PALETTE_VARS.forEach(function (k) {
        var v = cs.getPropertyValue("--" + k);
        p[k] = (v || "").trim();
      });
      /* Defensive fallbacks: if a stylesheet has not applied yet (rare, but a
         cold cache on a slow connection can do it) we must never hand a chart
         an empty string, which SVG treats as `black` — reintroducing an
         unreadable state. */
      var dark = p.name === "dark";
      function fb(key, d, l) { if (!p[key]) p[key] = dark ? d : l; }
      fb("ink", "#f4f6f8", "#0c1118");
      fb("ink-2", "rgba(244,246,248,0.78)", "#38424f");
      fb("ink-3", "rgba(244,246,248,0.62)", "#4f5b6d");
      fb("ink-4", "rgba(244,246,248,0.5)", "#5e6a7d");
      fb("ink-graph", "rgba(244,246,248,0.82)", "#1b2531");
      fb("chart-grid", "rgba(255,255,255,0.055)", "rgba(12,17,24,0.1)");
      fb("chart-grid-2", "rgba(255,255,255,0.09)", "rgba(12,17,24,0.16)");
      fb("chart-axis", "rgba(244,246,248,0.62)", "#4f5b6d");
      fb("chart-axis-dim", "rgba(244,246,248,0.5)", "#5e6a7d");
      fb("chart-zero", "rgba(255,255,255,0.22)", "rgba(12,17,24,0.3)");
      fb("chart-dot-stroke", "#07080a", "#ffffff");
      fb("chart-edge-idle", "rgba(255,255,255,0.12)", "rgba(12,17,24,0.16)");
      fb("chart-edge-active", "rgba(121,184,255,0.62)", "rgba(18,87,184,0.6)");
      fb("chart-arrow", "rgba(244,246,248,0.5)", "rgba(12,17,24,0.5)");
      fb("s-mint", "#7cf5c4", "#0e9b73");
      fb("s-blue", "#79b8ff", "#1f6fe0");
      fb("s-violet", "#b79dff", "#7b4fe0");
      fb("s-amber", "#ffcf7a", "#b8791a");
      fb("s-rose", "#ff8fa3", "#d93b5c");
      fb("s-cyan", "#6ee7f5", "#0a90ad");
      fb("s-orange", "#ff9f6e", "#cc5f21");
      fb("s-slate", "#9aa4b2", "#5c6879");
      fb("accent", "#7cf5c4", "#0b6f50");
      fb("accent-2", "#79b8ff", "#1257b8");
      fb("bg", "#07080a", "#eef2f8");
      paletteCache = p;
      return p;
    },

    /** Invalidates the palette cache (used after a stylesheet swap/reload). */
    invalidate: function () { paletteCache = null; }
  };

  /**
   * Semantic series colours. Views ask for a NAME, never a hex, so a series
   * automatically re-tints when the theme flips. `C.hue()` is the single
   * lookup used by every view and by DOMAIN_COLOR below.
   */
  C.HUE_KEYS = {
    mint: "s-mint", blue: "s-blue", violet: "s-violet", amber: "s-amber",
    rose: "s-rose", cyan: "s-cyan", orange: "s-orange", slate: "s-slate"
  };
  C.hue = function (name) {
    var p = C.theme.palette();
    var key = C.HUE_KEYS[name];
    return (key && p[key]) || p["s-mint"];
  };

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

  /* ── Geolocation (optional; API falls back to edge geo headers or New Delhi default) ── */
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

  /* ══════════════════════════════════════════════════════════════════════
     API BASE RESOLUTION
     ----------------------------------------------------------------------
     Primary host is Next.js (Vercel / local) with real serverless /api/*
     routes (Hono mounted at src/app/api/[[...route]]). Same-origin /api is
     therefore the default and preferred base.

     Candidate order:
       ?api=<url>                 → explicit per-visit override
       <meta name="catena-api-base">
       window.CATENA_API_BASE
       localStorage catena-api-base
       same-origin /api           → Next.js App Router (this build)

     If no base answers /health with { app: "catena" }, fall back to the
     optional in-browser local engine stub so panels still degrade gracefully.
     ══════════════════════════════════════════════════════════════════════ */
  C.API_BASES = (function () {
    var list = [];
    function add(v) {
      if (!v) return;
      var s = String(v).trim().replace(/\/+$/, "");
      if (s && list.indexOf(s) === -1) list.push(s);
    }
    var sameOrigin = location.origin + "/api";
    try {
      var sp = new URLSearchParams(location.search);
      var override = sp.get("api");
      if (override) {
        add(override);
        try { localStorage.setItem("catena-api-base", override); } catch (e) {}
      } else if (override === "") {
        /* ESCAPE HATCH: empty ?api= clears a remembered override. */
        try { localStorage.removeItem("catena-api-base"); } catch (e) {}
      }
    } catch (e) {}
    /* Next.js host: same-origin /api is always first so a stale remote
       override in localStorage cannot 404 the dashboard. */
    add(sameOrigin);
    var meta = document.querySelector('meta[name="catena-api-base"]');
    if (meta) add(meta.getAttribute("content"));
    add(window.CATENA_API_BASE);
    try {
      var stored = localStorage.getItem("catena-api-base");
      /* Ignore stored bases that look like dead CF/static leftovers. */
      if (stored && /pages\.dev|workers\.dev|dist-static|cloudflare/i.test(stored)) {
        try { localStorage.removeItem("catena-api-base"); } catch (e2) {}
      } else {
        add(stored);
      }
    } catch (e) {}
    return list;
  })();

  /** Resolved base, or the string "local" once the in-browser engine wins. */
  C.apiBase = null;

  function probe(base, timeoutMs) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var init = { headers: { accept: "application/json" } };
    if (ctrl) init.signal = ctrl.signal;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 4500) : null;
    return fetch(base + "/health", init)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        // Guard against an SPA fallback returning index.html with
        // a 200: only an actual Catena health envelope counts as a live base.
        if (!j || j.app !== "catena") throw new Error("not a catena api");
        return base;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  /** Resolves (and memoises) the API base. Never rejects. */
  C.resetApi = function () {
    C.apiBase = null;
    C._resolving = null;
  };

  C.resolveApi = function () {
    if (C._resolving) return C._resolving;
    C._resolving = (function () {
      var bases = C.API_BASES.slice();
      function next() {
        if (!bases.length) {
          // No reachable /api yet — try same-origin proxy stub (Next.js host).
          if (C.localEngine) {
            C.apiBase = "local";
            C.setLive("degraded", "local proxy");
            return Promise.resolve("local");
          }
          C.apiBase = null;
          return Promise.resolve(null);
        }
        var base = bases.shift();
        return probe(base).then(
          function (ok) { C.apiBase = ok; return ok; },
          function () { return next(); }
        );
      }
      return next();
    })();
    return C._resolving;
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
    var query = qs(params);

    function buildInit() {
      var init = { headers: { accept: "application/json", "x-catena-user": C.state.uid } };
      if (o.body) {
        init.method = "POST";
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(o.body);
      }
      return init;
    }

    /* Runs the request against a concrete transport ("local" or an http base). */
    function run(base) {
      var init = buildInit();

      if (base === "local") {
        // Same Hono app, executed in-page. Response is a real Response object,
        // so the .then chain below is identical for both transports.
        return C.localEngine.fetch("/api" + path + "?" + query, init);
      }

      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      if (ctrl) init.signal = ctrl.signal;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, o.timeout || 22000) : null;
      return fetch(base + path + "?" + query, init).then(
        function (r) { if (timer) clearTimeout(timer); return r; },
        function (err) { if (timer) clearTimeout(timer); throw err; }
      );
    }

    function handle(r, base) {
      if (!r.ok) {
        var e = new Error("HTTP " + r.status + " on " + path);
        e.status = r.status;
        e.base = base;
        throw e;
      }
      return r.json();
    }

    return C.resolveApi().then(function (base) {
      if (!base) {
        throw new Error(
          "No Catena API reachable at same-origin /api. " +
          "This app must be deployed as Next.js (not a static host). " +
          "On Vercel: Framework Preset = Next.js, Output Directory EMPTY, " +
          "Build Command = next build. Or pass ?api=<origin>/api."
        );
      }
      return run(base)
        .then(function (r) { return handle(r, base); })
        .catch(function (err) {
          // A base that answered /health but fails a real route (cold start,
          // transient 5xx, network drop) must not kill the dashboard: fall back
          // to the in-browser engine once, then retry there.
          if (base !== "local" && C.localEngine) {
            C.apiBase = "local";
            C._resolving = Promise.resolve("local");
            C.setLive("degraded", "local engine");
            return run("local").then(function (r) { return handle(r, "local"); });
          }
          throw err;
        })
        .then(function (j) {
          if (j && j.provenance) C.renderProvenance(j.provenance, j.degraded);
          return j;
        });
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

  /**
   * Domain → semantic hue name (NOT a hex). `C.domainColor()` resolves it
   * through the live palette, so graph nodes, agent dots and legends all
   * re-tint on a theme flip instead of staying stuck on the dark-theme hexes
   * that used to be baked in here.
   */
  C.DOMAIN_HUE = {
    medication: "mint",
    sleep: "blue",
    environment: "cyan",
    mental: "violet",
    nutrition: "amber",
    vital: "rose",
    finance: "slate",
    symptom: "orange"
  };
  C.DOMAIN_KEYS = Object.keys(C.DOMAIN_HUE);
  C.domainColor = function (domain) { return C.hue(C.DOMAIN_HUE[domain] || "slate"); };

  /* Back-compat: some call sites index C.DOMAIN_COLOR[domain] directly. A
     Proxy is not available in every target browser, so this is rebuilt from
     the palette on each theme change (see the onChange hook at the bottom). */
  C.DOMAIN_COLOR = {};
  C.refreshDomainColors = function () {
    C.DOMAIN_KEYS.forEach(function (k) { C.DOMAIN_COLOR[k] = C.domainColor(k); });
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

  /**
   * Serialises a tooltip payload for data-tip="…". Escapes quotes so the
   * attribute stays well-formed when values contain units or punctuation.
   */
  C.tipPayload = function (model) {
    try {
      return C.esc(JSON.stringify(model || {}));
    } catch (e) {
      return C.esc("{\"title\":\"\"}");
    }
  };

  /**
   * KPI / stat tooltip builder — keeps the shape consistent across views.
   * rows: [{name,value,unit,color?}]
   */
  C.tipModel = function (title, rows, foot) {
    return { title: title || "", rows: rows || [], foot: foot || "" };
  };

  /**
   * Wraps a bento cell with the stagger index CSS custom property.
   * Usage: out += C.cell("c8", 2, html)
   */
  C._stagger = 0;
  C.cell = function (cls, i, html) {
    var idx = (typeof i === "number") ? i : (C._stagger++);
    return '<div class="' + (cls || "c12") + '" style="--i:' + idx + '">' + (html || "") + "</div>";
  };
  C.resetStagger = function () { C._stagger = 0; };

  C.statCell = function (k, v, unit, tip) {
    var tipAttr = "";
    if (tip) {
      var plain = String(v == null ? "" : v).replace(/<[^>]+>/g, "");
      var model;
      if (tip === true) {
        model = C.tipModel(k, [{ name: k, value: plain, unit: unit || "" }]);
      } else if (typeof tip === "string") {
        model = C.tipModel(tip, [{ name: k, value: plain, unit: unit || "" }]);
      } else {
        model = tip;
        if (!model.title) model.title = k;
      }
      tipAttr = ' data-tip="' + C.tipPayload(model) + '"';
    }
    return (
      '<div class="stat-cell"' + tipAttr + '><p class="stat-k">' + C.esc(k) + "</p>" +
      '<p class="stat-v">' + v + (unit ? "<small>" + C.esc(unit) + "</small>" : "") + "</p></div>"
    );
  };

  /** KPI card helper with data-tip + semantic hue. */
  C.kpiCell = function (opts) {
    var o = opts || {};
    var color = o.color || C.hue("mint");
    var tip = o.tip || C.tipModel(o.label, [
      { name: o.label || "Value", value: String(o.display != null ? o.display : o.value), unit: o.unit || "", color: color },
      o.delta != null ? { name: "Δ", value: (o.delta > 0 ? "+" : "") + C.fmt.num(o.delta, 2), unit: o.unit || "" } : null
    ].filter(Boolean), o.foot || "");
    return (
      '<div class="kpi" data-tip="' + C.tipPayload(tip) + '">' +
      '<p class="kpi-label">' + C.esc(o.label || "") + "</p>" +
      '<p class="kpi-value">' + (o.display != null ? o.display : C.fmt.num(o.value, o.digits != null ? o.digits : 0)) +
      (o.unit ? "<small>" + C.esc(o.unit) + "</small>" : "") + "</p>" +
      '<div class="kpi-foot"><div class="kpi-spark">' +
      (window.Catena.chart && o.spark ? window.Catena.chart.spark(o.spark, { color: color }) : "") +
      "</div>" + (o.deltaHtml != null ? o.deltaHtml : (o.delta != null ? C.deltaHtml(o.delta, o.invert) : "")) +
      "</div></div>"
    );
  };

  C.bar = function (pct, cls) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<div class="bar-track"><div class="bar-fill ' + (cls || "") + '" style="width:' + p + '%"></div></div>';
  };

  /* ══════════════════════════════════════════════════════════════════════
     TOOLTIP ENGINE
     ----------------------------------------------------------------------
     One floating element per positioned container, reused across hovers, so
     hundreds of chart points cost a single node. Shared by:
       • chart hover (crosshair readouts, bars, heat cells, scatter, donut)
       • metric cards (.kpi[data-tip]) and stat cells (.stat-cell[data-tip])
     Content is built from structured rows so units and timestamps are always
     rendered in the same place regardless of the caller.
     ══════════════════════════════════════════════════════════════════════ */
  C.tip = (function () {
    function ensure(host) {
      var el = host.querySelector(":scope > .chart-tip");
      if (!el) {
        el = document.createElement("div");
        el.className = "chart-tip";
        host.appendChild(el);
      }
      return el;
    }

    /**
     * @param {Object} m  { title, rows:[{name,value,unit,color}], foot }
     */
    function html(m) {
      var out = "";
      if (m.title) out += '<p class="chart-tip-title">' + C.esc(m.title) + "</p>";
      (m.rows || []).forEach(function (r) {
        out += '<div class="chart-tip-row">' +
          (r.color ? '<span class="sw" style="background:' + C.esc(r.color) + '"></span>' : "") +
          '<span class="nm">' + C.esc(r.name) + "</span>" +
          '<span class="vl">' + C.esc(r.value) + "</span>" +
          (r.unit ? '<span class="un">' + C.esc(r.unit) + "</span>" : "") +
          "</div>";
      });
      if (m.foot) out += '<div class="chart-tip-foot">' + C.esc(m.foot) + "</div>";
      return out;
    }

    return {
      /**
       * Shows the tooltip for `host` at host-relative (x, y).
       * Clamped horizontally and flipped vertically so it can never be
       * clipped by the card (`.card` is overflow:hidden).
       */
      show: function (host, model, x, y) {
        if (!host) return;
        var el = ensure(host);
        el.innerHTML = html(model || {});
        el.classList.add("is-on");

        var hw = host.clientWidth || 1;
        var tw = el.offsetWidth || 0;
        var th = el.offsetHeight || 0;
        var half = tw / 2 + 6;
        var cx = hw > tw + 12 ? Math.max(half, Math.min(hw - half, x)) : hw / 2;

        /* Above the cursor by default; below when there is not enough room. */
        var above = y - th - 12 >= -2;
        var top = above ? y - th - 10 : y + 16;
        top = Math.max(2, Math.min(Math.max(2, (host.clientHeight || th) - th - 2), top));

        el.style.left = cx + "px";
        el.style.top = top + "px";
        el.style.transform = "translateX(-50%)";
      },
      hide: function (host) {
        if (!host) return;
        var el = host.querySelector(":scope > .chart-tip");
        if (el) el.classList.remove("is-on");
      },
      hideAll: function () {
        C.$$(".chart-tip.is-on").forEach(function (el) { el.classList.remove("is-on"); });
      },
      /** Nearest positioned container that should own the floating element. */
      host: function (el) {
        return (el.closest && (el.closest(".tip-host") || el.closest(".chart-wrap") || el.closest(".card"))) || el;
      }
    };
  })();

  /**
   * Wires `[data-tip]` elements (metric cards, stat cells) to the tooltip.
   * The payload is a JSON blob on the attribute so the markup stays a pure
   * string — views never need imperative code for this.
   *
   * Idempotent: safe to call after every render.
   */
  C.bindTips = function (root) {
    C.$$("[data-tip]", root || document).forEach(function (el) {
      if (el._tipBound) return;
      el._tipBound = true;

      var host = el;                      /* tooltip is appended to the element itself */
      if (getComputedStyle(host).position === "static") host.style.position = "relative";

      function model() {
        try { return JSON.parse(el.getAttribute("data-tip") || "{}"); }
        catch (e) { return { title: el.getAttribute("data-tip") || "" }; }
      }
      function show(ev) {
        el.classList.add("is-hot");
        var box = el.getBoundingClientRect();
        var x = ev && ev.clientX ? ev.clientX - box.left : box.width / 2;
        C.tip.show(host, model(), x, 4);
      }
      function hide() {
        el.classList.remove("is-hot");
        C.tip.hide(host);
      }
      el.addEventListener("mouseenter", show);
      el.addEventListener("mousemove", show);
      el.addEventListener("mouseleave", hide);
      el.addEventListener("focus", show);
      el.addEventListener("blur", hide);
      /* Touch: tap toggles, and any other tap dismisses. */
      el.addEventListener("click", function (ev) {
        if (window.matchMedia && window.matchMedia("(hover: hover)").matches) return;
        var on = host.querySelector(":scope > .chart-tip.is-on");
        C.tip.hideAll();
        if (!on) show(ev);
      });
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    });
  };

  /* Keep the back-compat DOMAIN_COLOR map and the palette in step. */
  C.refreshDomainColors();
  C.theme.onChange(function () {
    C.refreshDomainColors();
    C.tip.hideAll();
  });
  C.theme.syncMeta();
})();
