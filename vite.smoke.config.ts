// إعداد بناء خاص باختبار التشغيل (لا يلمس dist الحقيقي) — بيتبني كـ IIFE عشان يشتغل في متصفح وهمي (jsdom)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "/home/user/AquaDior",
  plugins: [react()],
  build: {
    outDir: ".smoke-out",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: "/home/user/AquaDior/src/main.tsx",
      output: {
        format: "iife",
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
      preserveEntrySignatures: false,
    },
  },
});
