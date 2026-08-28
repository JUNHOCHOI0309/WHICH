import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WHICH",
    short_name: "WHICH",
    description: "고르고, 결과를 보고, 다음 질문으로.",
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
