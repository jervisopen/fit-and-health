import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Separate from PORT, which dev launchers often set for Vite itself.
const API_PORT = Number(process.env.API_PORT ?? 8787);

/**
 * Two builds of the same app:
 *   default        local-first static site: the API runs in a Web Worker on SQLite WebAssembly and
 *                  data stays in the browser. Host it anywhere static (Cloudflare Pages, GitHub Pages).
 *   --mode server  talks to a self-hosted fit&health server at /api (npm run build:server; npm start).
 */
export default defineConfig(({ mode }) => {
  const server = mode === "server";
  return {
    define: { "import.meta.env.VITE_API_MODE": JSON.stringify(server ? "server" : "local") },
    // sqlite-wasm loads its .wasm relative to its own module; pre-bundling would break that.
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    worker: { format: "es" },
    build: { target: "es2022" },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg"],
        manifest: {
          name: "fit&health",
          short_name: "fit&health",
          description: "Free food diary with Indian portions, photo meal logging and a fasting tracker. Your data stays on your phone.",
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
          // The whole app, including the SQLite engine (.wasm), works offline after the first visit.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,wasm,webmanifest}"],
          // sqlite-wasm also emits workers this app does not use.
          globIgnores: ["**/sqlite3-worker1-*", "**/sqlite3-opfs-async-proxy-*", ...(server ? ["**/worker-*", "**/*.wasm"] : [])],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: server
            ? [
                {
                  // Diary and food reads work offline from the last successful response.
                  urlPattern: ({ url }) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/foods/search"),
                  handler: "NetworkFirst",
                  method: "GET",
                  options: { cacheName: "api", networkTimeoutSeconds: 4, expiration: { maxEntries: 300, maxAgeSeconds: 7 * 86400 } },
                },
              ]
            : [],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: server ? { "/api": `http://127.0.0.1:${API_PORT}` } : undefined,
    },
  };
});
