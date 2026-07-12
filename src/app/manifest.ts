import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fuguBrow",
    short_name: "fuguBrow",
    description: "GH0ST CAPTAIN — your rogue AI first mate.",
    start_url: "/",
    display: "standalone",
    background_color: "#020808",
    theme_color: "#020808",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
