import type { NextConfig } from "next";

/**
 * Plain Next.js configuration — no Cloudflare adapters, no Hono, no
 * `@cloudflare/next-on-pages` / wrangler integration. This app deploys as a
 * standard Next.js app on Vercel (or any Node.js host) with real serverless
 * `/api/*` route handlers.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pg/drizzle use Node.js APIs that must not be bundled for edge runtimes.
  serverExternalPackages: ["pg", "drizzle-orm"],
  async headers() {
    return [
      {
        source: "/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
