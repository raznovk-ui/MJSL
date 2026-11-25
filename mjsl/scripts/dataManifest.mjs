/**
 * Builds public/data/manifest.json from every runtime data file: OSM snapshots,
 * AMP files, noise, reports and the economic files (rents, income, public space).
 *
 * It is called automatically by the Vite plugin in vite.config.ts at buildStart
 * (prod build) and configureServer (dev). It is never meant to be run by hand.
 *
 * The OSM manifest and the global manifest are excluded from the hash: they are
 * metadata, not data. The global version only changes when a data file changes.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

async function filesIn(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesIn(full)));
    else if (entry.name !== "manifest.json") out.push(full);
  }
  return out;
}

export async function writeDataManifest(dataDir) {
  const files = (await filesIn(dataDir)).sort();
  const hashes = {};
  for (const file of files) {
    const key = relative(dataDir, file).replaceAll("\\", "/");
    const bytes = await readFile(file);
    hashes[key] = createHash("sha256").update(bytes).digest("hex");
  }
  const version = createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
  const manifest = { generatedAt: new Date().toISOString(), version, files: hashes };
  await writeFile(join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
