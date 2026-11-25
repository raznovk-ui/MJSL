import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDataManifest } from "./scripts/dataManifest.mjs";

const require = createRequire(import.meta.url);

/**
 * MapLibre draws on a web worker made of two files that the bundler does not copy
 * into the build, so the production map would fail to load them (the server answers
 * with the HTML page, which the browser refuses as a worker). Copy them beside the app.
 */
/**
 * Generates public/data/manifest.json from every runtime data file, at build and
 * at dev-server start. The app uses its `version` to skip a full reload when no
 * data changed. Never edit this file by hand.
 */
function dataManifest() {
  const dataDir = fileURLToPath(new URL("./public/data", import.meta.url));
  return {
    name: "data-manifest",
    enforce: "pre" as const,
    async buildStart() {
      const manifest = await writeDataManifest(dataDir);
      console.log(`data manifest: ${Object.keys(manifest.files).length} files, version ${manifest.version.slice(0, 12)}`);
    },
    async configureServer() {
      const manifest = await writeDataManifest(dataDir);
      console.log(`data manifest (dev): ${Object.keys(manifest.files).length} files, version ${manifest.version.slice(0, 12)}`);
    },
  };
}

function copyMaplibreWorker() {
  return {
    name: "copy-maplibre-worker",
    generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: Uint8Array }) => void }) {
      const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        this.emitFile({ type: "asset", fileName: `assets/${file}`, source: readFileSync(join(dist, file)) });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // A relative base for the build, so the same dist/ works at any path: the
  // GitHub Pages project URL (/<repo>/), a sub-folder, or a plain static server.
  // Every runtime URL is built from import.meta.env.BASE_URL.
  base: command === "build" ? "./" : "/",
  plugins: [dataManifest(), react(), tailwind(), copyMaplibreWorker()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Pre-bundling maplibre-gl drops its worker file, which Firefox then refuses to
  // load (empty MIME type). Served from node_modules as-is, the worker resolves.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
}));
