import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  // The MJSL layers are imported from ../site/data at build time rather than
  // copied in, so there is exactly one source of truth for that data.
  // Pre-bundling maplibre-gl drops its worker file, which Firefox then refuses to
  // load (empty MIME type). Served from node_modules as-is, the worker resolves.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: { fs: { allow: [".."] } },
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
