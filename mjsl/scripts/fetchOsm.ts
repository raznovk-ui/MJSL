/**
 * Downloads the OpenStreetMap data the app needs and saves it as files in
 * public/data/osm/, so the app can start with no connection to Overpass.
 *
 *   npm run data:osm              all tiles (skips the ones already saved)
 *   npm run data:osm -- --force   download everything again
 *
 * It is patient on purpose: Overpass is a free public server that is often busy, so
 * each tile is retried on three servers with growing pauses, one request at a time.
 * Safe to stop and run again: finished tiles are kept. Takes 10-30 minutes the first time.
 *
 * Data (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { osmToGeojson } from "../src/app/overpass/osmToGeojson.ts";
import { OVERPASS_PRESETS } from "../src/app/overpass/presets.ts";
import { SOCIAL_TILES, OSM_TILES } from "../src/app/overpass/zonePreset.ts";
import { gzipText, trimCollection } from "../src/app/overpass/snapshot.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "osm");
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "mjsl/0.1 (academic project; prepared offline snapshot)";
const force = process.argv.includes("--force");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(text: string): Promise<unknown> {
  let last = "";
  for (let round = 0; round < 4; round += 1) {
    if (round > 0) await sleep(15_000 * round);
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
          body: `data=${encodeURIComponent(text)}`,
          signal: AbortSignal.timeout(150_000),
        });
        if (response.ok) return await response.json();
        last = `HTTP ${response.status} from ${new URL(endpoint).host}`;
      } catch (error) {
        last = `${new URL(endpoint).host}: ${error instanceof Error ? error.message : error}`;
      }
    }
    console.log(`   ... still failing (${last}), pausing before another round`);
  }
  throw new Error(last);
}

const exists = async (path: string) => stat(path).then(() => true, () => false);

await mkdir(OUT, { recursive: true });
const jobs = [...OSM_TILES, ...SOCIAL_TILES, ...OVERPASS_PRESETS];
const failed: string[] = [];
let features = 0;

for (const [i, preset] of jobs.entries()) {
  const file = join(OUT, `${preset.id}.geojson.gz`);
  const label = `[${i + 1}/${jobs.length}] ${preset.id}`;
  if (!force && (await exists(file))) {
    console.log(`${label}: already saved`);
    continue;
  }
  try {
    const collection = trimCollection(osmToGeojson((await query(preset.query)) as Parameters<typeof osmToGeojson>[0]));
    const bytes = await gzipText(JSON.stringify(collection));
    await writeFile(file, bytes);
    features += collection.features.length;
    console.log(`${label}: ${collection.features.length} objects, ${(bytes.length / 1024).toFixed(0)} kB`);
  } catch (error) {
    failed.push(preset.id);
    console.log(`${label}: FAILED (${error instanceof Error ? error.message : error})`);
  }
  await sleep(3000); // one request at a time, with a pause: go easy on a free server
}

const total = (await readdir(OUT)).filter((f) => f.endsWith(".gz"));
let bytes = 0;
for (const f of total) bytes += (await stat(join(OUT, f))).size;
console.log(`\n${total.length}/${jobs.length} files in ${OUT} (${(bytes / 1024 / 1024).toFixed(1)} MB), ${features} objects downloaded this run.`);
if (failed.length) {
  console.log(`Missing: ${failed.join(", ")}\nRun the command again later to fetch only those.`);
  process.exitCode = 1;
}
