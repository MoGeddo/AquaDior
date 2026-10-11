import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // 🧹 الـ SW بيمسح نفسه وبيمسح كل الكاش القديم
      selfDestroying: true,
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "حضور ومصاريف العمال",
        short_name: "العمال",
        description: "تسجيل حضور العمال والفلوس اللي بياخدوها والتسويات",
        lang: "ar",
        dir: "rtl",
        theme_color: "#0f766e",
        background_color: "#f4f6fa",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
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
        // ⚠️ مفيش runtimeCaching — عشان الداتا تيجي من الشبكة دايماً
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
