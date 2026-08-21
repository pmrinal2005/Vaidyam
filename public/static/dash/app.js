/* Vaidyam dashboard router — nav construction, view lifecycle, delegated events. */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = C.views || {};

  // Rail order. Grouped: casual home → twin → reasoning → domains → surfaces.
  // "casual" is the gamified home lens; every Pro view remains present and
  // 100% unchanged, so a Casual user can expand any card into the original
  // panel and a Pro user can ignore casual entirely.
  var ORDER = [
    "casual",
    "overview", "assistant", "graph", "swarm", "cascade", "counterfactual",
    "environment", "medication", "nutrition",
    "clinician", "privacy", "publichealth", "memory",
    "ingestion", "saas"
  ];
  // Casual is the DEFAULT home tab on the mobile tab-bar.
  var TABS = ["casual", "overview", "assistant", "counterfactual", "environment"];
  var GROUP_AFTER = { casual: true, assistant: true, counterfactual: true, nutrition: true, memory: true };

  function views() {
    return ORDER.filter(function (k) { return V[k]; });
  }

  /* ── Nav ── */
  function buildNav() {
    var nav = C.$("#rail-nav");
    if (nav) {
      nav.innerHTML = views().map(function (k) {
        var v = V[k];
        return '<button type="button" class="rail-item" data-view="' + k + '" aria-label="' + C.esc(v.label) + '">' +
          '<i class="bi ' + v.icon + '" aria-hidden="true"></i>' +
          '<span class="rail-tip">' + C.esc(v.label) + "</span></button>" +
          (GROUP_AFTER[k] ? '<span class="rail-sep" aria-hidden="true"></span>' : "");
      }).join("");
    }
    var tabbar = C.$("#dash-tabbar");
    if (tabbar) {
      tabbar.innerHTML = TABS.filter(function (k) { return V[k]; }).map(function (k) {
        return '<button type="button" class="tab-item" data-view="' + k + '">' +
          '<i class="bi ' + V[k].icon + '" aria-hidden="true"></i><span>' + C.esc(V[k].label) + "</span></button>";
      }).join("");
    }
  }

  function markActive(view) {
    C.$$("[data-view]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === view);
      if (b.classList.contains("rail-item")) b.setAttribute("aria-current", b.getAttribute("data-view") === view ? "page" : "false");
    });
    var v = V[view];
    if (v) {
      var h = C.$("#topbar-heading");
      if (h) h.textContent = v.title || v.label;
      document.title = "Vaidyam — " + (v.title || v.label);
    }
    syncModeToggle(view);
  }

  /* ── Casual / Pro mode toggle ──────────────────────────────────────────
     A persistent, one-tap switch (localStorage + ?mode= via C.mode) that
     flips the DEFAULT surface between the gamified Casual home and the
     original Pro Twin Overview. Switching only navigates + reskins the
     shell; the Pro views themselves are never modified. */
  function ensureModeToggle() {
    if (!V.casual) return null; // casual view not loaded → no toggle
    var host = C.$(".topbar-right");
    if (!host) return null;
    var btn = C.$("#mode-toggle");
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "mode-toggle";
    btn.className = "mode-toggle";
    btn.setAttribute("aria-label", "Switch dashboard mode");
    btn.setAttribute("title", "Switch between Casual and Pro");
    btn.innerHTML =
      '<i class="bi bi-controller ic-casual" aria-hidden="true"></i>' +
      '<i class="bi bi-bar-chart-steps ic-pro" aria-hidden="true"></i>' +
      '<span class="mode-toggle-label" id="mode-toggle-label"></span>';
    // Insert before the theme toggle so the two sit together.
    var theme = C.$("#theme-toggle", host);
    if (theme) host.insertBefore(btn, theme);
    else host.insertBefore(btn, host.firstChild);
    btn.addEventListener("click", function () {
      var next = (C.mode && C.mode.toggle) ? C.mode.toggle() : "casual";
      applyMode(next);
      C.goto(next === "pro" ? "overview" : "casual");
      C.toast(next === "pro" ? "Pro view — full causal depth" : "Casual view — your living twin");
    });
    return btn;
  }

  function applyMode(mode) {
    var shell = C.$("#dash-shell");
    if (shell) shell.setAttribute("data-mode", mode);
    try {
      var u = new URL(location.href);
      u.searchParams.set("mode", mode);
      history.replaceState(null, "", u.pathname + u.search + location.hash);
    } catch (e) {}
    syncModeToggle(C.state.view);
  }

  function syncModeToggle(view) {
    var btn = C.$("#mode-toggle");
    if (!btn) return;
    var mode = (C.mode && C.mode.get) ? C.mode.get() : "casual";
    btn.setAttribute("data-mode", mode);
    var lbl = C.$("#mode-toggle-label", btn);
    if (lbl) lbl.textContent = mode === "pro" ? "Pro" : "Casual";
    btn.setAttribute("aria-pressed", mode === "pro" ? "true" : "false");
  }

  /* ── Mobile drawer ── */
  function closeRail() {
    var rail = C.$("#dash-rail");
    var scrim = C.$("#dash-scrim");
    var btn = C.$("#dash-menu-btn");
    if (rail) rail.classList.remove("is-open");
    if (scrim) scrim.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function toggleRail() {
    var rail = C.$("#dash-rail");
    var scrim = C.$("#dash-scrim");
    var btn = C.$("#dash-menu-btn");
    if (!rail) return;
    var open = rail.classList.toggle("is-open");
    if (scrim) scrim.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* ── View lifecycle ── */
  C.load = function (view, opts) {
    var o = opts || {};
    var v = V[view];
    if (!v) return Promise.resolve();
    C.state.view = view;
    markActive(view);
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);

    var root = C.$("#view-root");
    if (!root) return Promise.resolve();
    if (!o.silent) {
      root.innerHTML = C.skeleton(v.skeleton || 6);
      C.setLive("", "loading");
    }

    var token = (C.state.token = (C.state.token || 0) + 1);
    return v.load()
      .then(function (env) {
        if (token !== C.state.token) return;
        C.state.cache[view] = env;
        root.innerHTML = v.render(env);
        if (v.after) v.after();
        /* Re-wire chart hit-targets + [data-tip] KPI/stat tooltips after every paint. */
        if (C.chart && typeof C.chart.bind === "function") C.chart.bind(root);
        else if (typeof C.bindTips === "function") C.bindTips(root);
        var sub = C.$("#user-sub");
        if (sub && env.data) {
          var loc = env.data.location;
          var bits = [];
          if (env.data.graphStats) bits.push("graph " + env.data.graphStats.version);
          if (loc && (loc.city || loc.country)) {
            bits.push([loc.city, loc.country].filter(Boolean).join(", ") + (loc.live ? "" : " (approx)"));
          }
          if (bits.length) sub.textContent = bits.join(" · ");
        }
        if (!o.silent) C.$("#dash-main").scrollTop = 0;
      })
      .catch(function (err) {
        if (token !== C.state.token) return;
        root.innerHTML = C.errBox(err, view);
        C.setLive("error", "upstream error");
      });
  };

  C.rerender = function () {
    var view = C.state.view;
    var env = C.state.cache[view];
    var v = V[view];
    if (!env || !v) return C.load(view);
    var root = C.$("#view-root");
    if (!root) return;
    root.innerHTML = v.render(env);
    if (v.after) v.after();
    if (C.chart && typeof C.chart.bind === "function") C.chart.bind(root);
    else if (typeof C.bindTips === "function") C.bindTips(root);
  };

  C.goto = function (view) {
    if (!V[view]) return;
    // Keep the persisted mode aligned with the surface the user actually
    // lands on: entering Casual persists casual; entering a Pro panel
    // persists pro — so the next visit reopens where they left off.
    if (C.mode && C.mode.set) {
      var want = view === "casual" ? "casual" : "pro";
      if (C.mode.get() !== want) { C.mode.set(want); applyMode(want); }
    }
    closeRail();
    C.load(view);
  };

  /* ── Delegated interaction ── */
  function wire() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-view],[data-goto],[data-retry],[data-rerun],[data-focus-node]") : null;
      if (!el) return;

      if (el.hasAttribute("data-view")) { C.goto(el.getAttribute("data-view")); return; }
      if (el.hasAttribute("data-goto")) { C.goto(el.getAttribute("data-goto")); return; }
      if (el.hasAttribute("data-retry")) { C.load(el.getAttribute("data-retry") || C.state.view); return; }
      if (el.hasAttribute("data-rerun")) { C.load(el.getAttribute("data-rerun")); return; }
      if (el.hasAttribute("data-focus-node")) {
        var id = el.getAttribute("data-focus-node");
        C.state.graphFocus = C.state.graphFocus === id ? null : id;
        C.rerender();
      }
    });

    var menu = C.$("#dash-menu-btn");
    if (menu) menu.addEventListener("click", toggleRail);
    var scrim = C.$("#dash-scrim");
    if (scrim) scrim.addEventListener("click", closeRail);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeRail();
    });

    var refresh = C.$("#rail-refresh");
    if (refresh) refresh.addEventListener("click", function () {
      refresh.classList.add("is-spinning");
      C.load(C.state.view).then(function () {
        setTimeout(function () { refresh.classList.remove("is-spinning"); }, 320);
        C.toast("Live data refreshed");
      });
    });

    // Search bar seeds PPR retrieval and the swarm query.
    var q = C.$("#graph-query-input");
    if (q) {
      q.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        C.state.query = q.value.trim();
        if (!C.state.query) return;
        var target = C.state.view === "graph" || C.state.view === "cascade" ? C.state.view : "swarm";
        C.load(target);
        C.toast("Routing query through the cascade…");
      });
    }

    window.addEventListener("hashchange", function () {
      var h = location.hash.slice(1);
      if (h && V[h] && h !== C.state.view) {
        // Keep the persisted mode + toggle aligned with hash-driven navigation.
        if (C.mode && C.mode.set) {
          var want = h === "casual" ? "casual" : "pro";
          if (C.mode.get() !== want) { C.mode.set(want); applyMode(want); }
        }
        C.load(h);
      }
    });

    // Re-render SVG-heavy views on resize so chart widths stay correct.
    // Debounced; always fires (not only on breakpoint bucket changes) because
    // chart viewBoxes are computed from the host width at render time.
    var lastW = window.innerWidth;
    window.addEventListener("resize", function () {
      var w = window.innerWidth;
      // Ignore sub-pixel / mobile URL-bar jitter under 8px.
      if (Math.abs(w - lastW) < 8) return;
      lastW = w;
      clearTimeout(wire._rt);
      wire._rt = setTimeout(function () { C.rerender(); }, 180);
    });
  }

  /* ── Boot ── */
  function boot() {
    buildNav();
    wire();

    /* Theme toggle (Sun/Moon) next to the live indicator. */
    var themeBtn = C.$("#theme-toggle");
    if (themeBtn && C.theme) {
      C.theme.syncToggle();
      themeBtn.addEventListener("click", function () {
        C.theme.toggle();
      });
    }
    /* Charts bake colours into SVG attributes — re-render on every theme flip. */
    if (C.theme && typeof C.theme.onChange === "function") {
      C.theme.onChange(function () {
        C.theme.invalidate();
        C.rerender();
      });
    }

    var av = C.$("#user-name");
    if (av) av.textContent = "Twin " + String(C.state.uid || "").replace("twin-", "").slice(0, 6);

    // Casual / Pro mode toggle + shell state.
    ensureModeToggle();
    var mode = (C.mode && C.mode.get) ? C.mode.get() : "casual";
    applyMode(mode);

    // Start view resolution:
    //   1. explicit #hash wins (deep links / shares),
    //   2. otherwise the persisted mode chooses the home surface —
    //      Casual is the default for new/demo users (falls back to overview
    //      if the casual view failed to load).
    var start = location.hash.slice(1);
    if (!V[start]) {
      start = mode === "pro" ? "overview" : (V.casual ? "casual" : "overview");
    }

    // Geolocation is best-effort; the API falls back to edge geo either way.
    C.requestGeo().then(function () { C.load(start); });

    // Light polling keeps the environment panel honest without hammering upstreams.
    setInterval(function () {
      if (document.hidden) return;
      if (C.state.view === "overview" || C.state.view === "environment") C.load(C.state.view, { silent: true });
    }, 180000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
