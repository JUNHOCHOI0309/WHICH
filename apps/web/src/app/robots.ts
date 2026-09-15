import type { MetadataRoute } from "next";

import { canonicalUrl } from "@/lib/search-discovery";

const privatePaths = [
  "/api/",
  "/ops",
  "/me$",
  "/me/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/create",
  "/interests",
  "/mobile-auth",
];
const publicMachinePaths = ["/", "/public/issues.json", "/api/public/issues", "/api/share-cards/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: publicMachinePaths, disallow: privatePaths },
      {
        userAgent: "ChatGPT-User",
        allow: publicMachinePaths,
        disallow: privatePaths,
      },
      {
        userAgent: "OAI-SearchBot",
        allow: publicMachinePaths,
        disallow: privatePaths,
      },
      {
        userAgent: "OAI-AdsBot",
        allow: publicMachinePaths,
        disallow: privatePaths,
      },
      {
        userAgent: "PerplexityBot",
        allow: publicMachinePaths,
        disallow: privatePaths,
      },
      { userAgent: "GPTBot", disallow: "/" },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
    host: canonicalUrl("/"),
  };
}
