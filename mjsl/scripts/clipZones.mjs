/**
 * Trims the zones to the land: an IRIS can run out over a harbour or the sea, which would
 * colour the water and count it in the area of the coastal zones.
 *
 *   npm run data:zones     (fetches the zones, then trims them; or run this alone after data:amp)
 *
 * The land is the union of the 16 arrondissements of Marseille, from the Metropole's
 * "Contours geographiques des communes et arrondissements municipaux" (the same dataset as
 * DataSud's, Licence Ouverte), whose outline stops at the coast. Each zone is intersected with
 * it. Running the script twice changes nothing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "amp", "zones.geojson");
const API = "https://data.ampmetropole.fr/api/explore/v2.1/catalog/datasets/contours-geographiques-des-communes-et-arrondissements-municipaux/exports/geojson";
const round = (n) => Math.round(n * 1e5) / 1e5;

const url = new URL(API);
url.searchParams.set("where", `statut = "arrondissement municipal"`);
const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { "user-agent": "mjsl/0.1 (academic project)" } });
if (!response.ok) throw new Error(`Could not download the arrondissements: HTTP ${response.status}`);
const arrondissements = (await response.json()).features.filter((f) => /^Marseille/i.test(f.properties.com_arm_name ?? ""));
if (arrondissements.length !== 16) throw new Error(`Expected the 16 arrondissements of Marseille, got ${arrondissements.length}.`);
const land = turf.union(turf.featureCollection(arrondissements.map((f) => turf.feature(f.geometry))));
const parts = (land.geometry.type === "Polygon" ? [land.geometry.coordinates] : land.geometry.coordinates).map((coordinates) => ({ coordinates, bbox: turf.bbox(turf.polygon(coordinates)) }));
console.log(`Land: ${(turf.area(land) / 1e6).toFixed(1)} km2 in ${parts.length} part(s)`);

const zones = JSON.parse(await readFile(FILE, "utf8"));
let before = 0, after = 0, dropped = 0;
const out = [];
for (const feature of zones.features) {
  before += turf.area(feature);
  const [w, s, e, n] = turf.bbox(feature);
  const near = parts.filter((p) => p.bbox[0] <= e && p.bbox[2] >= w && p.bbox[1] <= n && p.bbox[3] >= s).map((p) => p.coordinates);
  let clipped = null;
  if (near.length > 0) {
    try {
      clipped = turf.intersect(turf.featureCollection([feature, turf.multiPolygon(near)]));
    } catch (error) {
      console.log(`  ${feature.properties.name}: kept as it was (${error.message})`);
      clipped = feature;
    }
  }
  if (!clipped) { dropped += 1; console.log(`  ${feature.properties.name}: entirely outside the land, dropped`); continue; }
  const round2 = (c) => (typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(round2));
  const feature2 = { type: "Feature", properties: feature.properties, geometry: { type: clipped.geometry.type, coordinates: round2(clipped.geometry.coordinates) } };
  after += turf.area(feature2);
  out.push(feature2);
}
await writeFile(FILE, JSON.stringify({ type: "FeatureCollection", features: out }));
console.log(`${out.length} zones (${dropped} dropped). Area ${(before / 1e6).toFixed(1)} km2 -> ${(after / 1e6).toFixed(1)} km2 (${(((before - after) / before) * 100).toFixed(1)} % was outside the land).`);
