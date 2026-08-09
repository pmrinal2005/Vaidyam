/**
 * Browser local-engine is not used on the Next.js host.
 * Kept as a typed stub so any residual imports resolve cleanly.
 */
export type LocalEngine = {
  mode: "next-proxy";
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const engine: LocalEngine = {
  mode: "next-proxy",
  fetch(path: string, init?: RequestInit) {
    const url = path.startsWith("/") ? path : `/api/${path}`;
    return fetch(url, init || {});
  },
};

export default engine;
