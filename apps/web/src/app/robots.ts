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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/api/share-cards/"], disallow: privatePaths },
      {
        userAgent: "OAI-SearchBot",
        allow: ["/", "/api/share-cards/"],
        disallow: privatePaths,
      },
      {
        userAgent: "OAI-AdsBot",
        allow: ["/", "/api/share-cards/"],
        disallow: privatePaths,
      },
      {
        userAgent: "PerplexityBot",
        allow: ["/", "/api/share-cards/"],
        disallow: privatePaths,
      },
      { userAgent: "GPTBot", disallow: "/" },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
    host: canonicalUrl("/"),
  };
}
