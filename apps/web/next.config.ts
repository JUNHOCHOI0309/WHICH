import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STANDALONE === "true"
    ? {
        output: "standalone" as const,
        // pnpm + standalone tracing otherwise omits SWC's ESM helpers, which
        // are resolved at runtime by Next's require hook rather than the build.
        outputFileTracingIncludes: {
          "/*": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*"],
        },
      }
    : {}),
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: process.env.AUTH_BASE_URL?.startsWith("https://")
    ? [new URL(process.env.AUTH_BASE_URL).hostname]
    : [],
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
