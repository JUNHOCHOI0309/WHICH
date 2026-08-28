import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const privateSources = [
      "/api/:path*",
      "/ops/:path*",
      "/me/:path*",
      "/login",
      "/signup/:path*",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/create",
      "/interests",
      "/mobile-auth/:path*",
    ];
    return privateSources.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }));
  },
};

export default nextConfig;
