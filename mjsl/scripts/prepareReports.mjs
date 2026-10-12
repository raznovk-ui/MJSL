/**
 * Turns the raw citizen reports ("Galere pietons", 1393 points) into the small file the
 * app reads: public/data/reports.json, one { lon, lat, type } per report.
 *
 *   npm run data:reports
 *
 * The free text and the photo links are left out: the scoring only counts reports by type.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(await readFile(join(root, "data", "raw", "signalements_voirie_marseille.geojson"), "utf8"));
const reports = source.features
  .filter((f) => f.geometry?.type === "Point")
  .map((f) => ({
    lon: Math.round(f.geometry.coordinates[0] * 1e6) / 1e6,
    lat: Math.round(f.geometry.coordinates[1] * 1e6) / 1e6,
    type: String(f.properties?.Types ?? "").trim(),
  }));
await mkdir(join(root, "public", "data"), { recursive: true });
await writeFile(join(root, "public", "data", "reports.json"), JSON.stringify(reports));
console.log(`${reports.length} reports -> public/data/reports.json`);
