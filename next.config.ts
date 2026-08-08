import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the large prebuilt reveal island and dashboard scripts under /public.
  poweredByHeader: false,
  reactStrictMode: true,
  // External packages that should not be bundled into edge (we use nodejs runtime).
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
