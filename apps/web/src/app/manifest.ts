import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION } from "@/lib/search-discovery";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WHICH",
    short_name: "WHICH",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#F7F9FA",
    theme_color: "#F7F9FA",
    icons: [
      {
        src: "/icons/which-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  };
}
