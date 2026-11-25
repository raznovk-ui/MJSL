/**
 * Builds public/data/osm/manifest.json: one hash per snapshot file, plus a version
 * hash over the set. The app fetches this small file before re-reading the 60 OSM
 * snapshots, so "Recharger les donnees" is instant when nothing changed.
 *
 * Called by fetchOsm.ts at the end of a data:osm run, and available alone as
 * `npm run data:osm-manifest` after replacing snapshot files by hand.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OSM_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "osm");

export async function writeOsmManifest(out = OSM_DIR) {
  const names = (await readdir(out)).filter((name) => name.endsWith(".geojson.gz")).sort();
  const files = {};
  for (const name of names) {
    const bytes = await readFile(join(out, name));
    files[name.replace(/\.geojson\.gz$/, "")] = createHash("sha256").update(bytes).digest("hex");
  }
  const version = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const manifest = { generatedAt: new Date().toISOString(), version, files };
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
