/**
 * Local-engine fallback for Catena dashboard.
 *
 * On Next.js / Vercel the real API is same-origin /api/* — this stub re-forwards
 * so a transient /health probe miss cannot blank the whole dashboard. It is NOT
 * a full offline simulator; panels still require the Next.js route handlers.
 */
(function () {
  "use strict";
  var C = (window.Catena = window.Catena || {});

  function normalize(path) {
    var url = String(path || "");
    if (url.indexOf("http") === 0) return url;
    if (url.charAt(0) !== "/") url = "/" + url;
    if (url.indexOf("/api") !== 0) {
      url = "/api" + (url.charAt(0) === "/" ? url : "/" + url);
    }
    return url;
  }

  C.localEngine = {
    mode: "next-proxy",
    fetch: function (path, init) {
      return fetch(normalize(path), init || {});
    },
  };

  try {
    console.info("[catena] local-engine: next-proxy ready");
  } catch (_) {}
})();
