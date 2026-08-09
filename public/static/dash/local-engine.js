/**
 * Local-engine fallback for Catena dashboard.
 * On Next.js / Vercel the real API is same-origin /api/* — this stub only
 * re-forwards so a transient probe miss cannot blank the whole dashboard.
 */
(function () {
  "use strict";
  var C = (window.Catena = window.Catena || {});
  C.localEngine = {
    mode: "next-proxy",
    fetch: function (path, init) {
      var url = String(path || "");
      if (url.indexOf("http") === 0) {
        /* absolute — leave alone */
      } else if (url.charAt(0) !== "/") {
        url = "/api/" + url;
      } else if (url.indexOf("/api") !== 0) {
        url = "/api" + url;
      }
      return fetch(url, init || {});
    },
  };
  try {
    console.info("[catena] local-engine: next-proxy ready");
  } catch (_) {}
})();
