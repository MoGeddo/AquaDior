import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const mockStub = fileURLToPath(new URL("./src/lib/mock.stub.ts", import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const demoMode = env.VITE_DEMO_MODE === "1";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        // Keep the precached app shell available offline; API data is never cached by Workbox.
        injectRegister: "auto",
        includeAssets: ["favicon.svg", "icon.svg", "icon-maskable.svg", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"],
        manifest: {
          name: "أكوا ديور للمقاولات",
          short_name: "أكوا ديور",
          description: "أكوا ديور للمقاولات — نظام إدارة المشاريع وحضور ومصاريف العمال والتسويات",
          lang: "ar",
          dir: "rtl",
          theme_color: "#08090b",
          background_color: "#08090b",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api/],
          // No runtimeCaching: API data must always come from the server.
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      // A demo build opts in explicitly; normal builds exclude sample users/data entirely.
      alias: demoMode ? [] : [{ find: "./mock", replacement: mockStub }],
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            minSize: 20_000,
            groups: [
              {
                name: "react-vendor",
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 20,
                minSize: 10_000,
              },
              {
                name: "router-vendor",
                test: /node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/,
                priority: 15,
                minSize: 10_000,
              },
              {
                name: "supabase-vendor",
                test: /node_modules[\\/]@supabase[\\/]/,
                priority: 15,
                minSize: 10_000,
              },
              {
                name: "data-vendor",
                test: /node_modules[\\/](dexie|dexie-react-hooks|zustand)[\\/]/,
                priority: 10,
                minSize: 10_000,
              },
              { name: "vendor", test: /node_modules[\\/]/, priority: 0, minSize: 20_000 },
            ],
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      allowedHosts: true,
    },
    preview: {
      host: true,
      port: 4173,
      allowedHosts: true,
    },
  };
});
