/**
 * Local-engine stub for Next.js / Vercel hosts.
 *
 * The original Catena static deploy ran the full Hono API inside the browser
 * when no /api worker existed. This Next.js port always mounts /api/* server-
 * side, so the real engine is unnecessary. core.js still probes for
 * window.Catena.localEngine as a last-resort fallback — we register a thin
 * proxy that forwards to same-origin /api so a transient probe failure can
 * still recover without a 404 on this script.
 */
(function () {
  "use strict";
  var C = (window.Catena = window.Catena || {});

  C.localEngine = {
    mode: "next-proxy",
    fetch: function (path, init) {
      // path is already "/api/..." from core.js
      var url = path.charAt(0) === "/" ? path : "/api/" + path;
      return fetch(url, init || {});
    },
  };

  try {
    console.info("[catena] local-engine: next-proxy ready (server /api is primary)");
  } catch (_) {}
})();
