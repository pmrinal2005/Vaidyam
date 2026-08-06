/* Catena dashboard router — nav construction, view lifecycle, delegated events. */
(function () {
  "use strict";
  var C = (window.Catena = window.Catena || {});
  var V = C.views || {};

  // Rail order. Grouped: twin → reasoning → domains → surfaces.
  var ORDER = [
    "overview", "graph", "swarm", "cascade", "counterfactual",
    "environment", "medication", "nutrition",
    "clinician", "privacy", "publichealth", "memory",
    "ingestion", "saas"
  ];
  var TABS = ["overview", "graph", "swarm", "counterfactual", "environment", "privacy"];
  var GROUP_AFTER = { counterfactual: true, nutrition: true, memory: true };

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
      document.title = "Catena — " + (v.title || v.label);
    }
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
        var sub = C.$("#user-sub");
        if (sub && env.data && env.data.graphStats) sub.textContent = "graph " + env.data.graphStats.version;
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
    root.innerHTML = v.render(env);
    if (v.after) v.after();
  };

  C.goto = function (view) {
    if (!V[view]) return;
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
      if (h && V[h] && h !== C.state.view) C.load(h);
    });

    // Re-render SVG-heavy views on breakpoint changes so layouts stay legible.
    var lastBucket = bucket();
    window.addEventListener("resize", function () {
      var b = bucket();
      if (b === lastBucket) return;
      lastBucket = b;
      clearTimeout(wire._t);
      wire._t = setTimeout(function () { C.rerender(); }, 220);
    });
  }

  function bucket() {
    var w = window.innerWidth;
    return w < 431 ? 0 : w < 641 ? 1 : w < 861 ? 2 : w < 1025 ? 3 : w < 1281 ? 4 : 5;
  }

  /* ── Boot ── */
  function boot() {
    buildNav();
    wire();
    var av = C.$("#user-name");
    if (av) av.textContent = "Twin " + String(C.state.uid || "").replace("twin-", "").slice(0, 6);

    var start = location.hash.slice(1);
    if (!V[start]) start = "overview";

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
