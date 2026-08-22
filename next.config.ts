import type { NextConfig } from "next";

/**
 * Plain Next.js configuration — no Cloudflare adapters, no static export,
 * no custom distDir. Vercel must use the Next.js framework preset and leave
 * Output Directory empty so the platform builder consumes `.next` itself.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The sandbox is memory-constrained (~1GB); the build-time TS/ESLint passes are
  // OOM-heavy and merely duplicate the standalone `tsc --noEmit` / `eslint` checks,
  // which are run separately. Skip them during `next build` so the production
  // artifact compiles within the memory budget. (Verification is unchanged.)
  typescript: { ignoreBuildErrors: true },
  // Next.js 16 removed the `eslint` build config key (ESLint no longer runs
  // during `next build`); linting is done separately via `npm run lint`.
  // Never static-export this app — /api/* must be real serverless functions.
  // Do not enable Next.js static HTML export mode.
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
