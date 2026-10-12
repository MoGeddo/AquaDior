// إعداد بناء خاص باختبار التشغيل (لا يلمس dist الحقيقي).
// يُبنى كـ IIFE كي يعمل داخل jsdom، مع تفعيل Demo Mode صراحةً على بيانات وهمية.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_DEMO_MODE": JSON.stringify("1"),
    "import.meta.env.VITE_SMOKE_TEST": JSON.stringify("1"),
  },
  build: {
    outDir: ".smoke-out",
    emptyOutDir: true,
    minify: false,
    rolldownOptions: {
      input: fileURLToPath(new URL("./src/main.tsx", import.meta.url)),
      output: {
        format: "iife",
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
      preserveEntrySignatures: false,
      transform: {
        define: { "import.meta": "{}" },
      },
    },
  },
});
