import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Separate from PORT, which dev launchers often set for Vite itself.
const API_PORT = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Food Diary",
        short_name: "Diary",
        description: "Self-hosted food diary, photo meal logging and fasting tracker.",
        theme_color: "#2f6f4f",
        background_color: "#f7f6f3",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Diary and food reads work offline from the last successful response.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/foods/search"),
            handler: "NetworkFirst",
            method: "GET",
            options: { cacheName: "api", networkTimeoutSeconds: 4, expiration: { maxEntries: 300, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${API_PORT}` },
  },
});
