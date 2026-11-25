/**
 * Computes the UN-Habitat 11.7.1 public-space share for every IRIS:
 *
 *   (public open spaces + streets) / built-up area
 *
 * The output is a small per-IRIS file the app reads at runtime:
 * public/data/amp/public_space.json.
 *
 *   npm run data:public-space
 *
 * Method: sample a 50 m lattice inside each zone. A point is "built-up" unless it
 * falls in a natural/agricultural OSM polygon; it is "public" if it falls in a
 * public OSM polygon or within the estimated width of a street. This avoids heavy
 * polygon intersections and keeps the output small.
 *
 * Sources: OpenStreetMap (ODbL) for land use, public spaces and streets; the
 * UN-Habitat Indicator 11.7.1 training module for the definition.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Feature, FeatureCollection } from "geojson";
import { STUDY_AREA } from "../src/app/studyArea.ts";
import { osmToGeojson } from "../src/app/overpass/osmToGeojson.ts";
import { ZONE_CONFIG } from "../src/domain/zone/index.ts";
import { bboxOfCoordinates, distanceM, KX, KY } from "../src/domain/zone/geo.ts";
import { PolygonIndex, SpatialGrid } from "../src/domain/zone/spatial.ts";
import type { LngLat } from "../src/domain/zone/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OSM_DIR = join(ROOT, "public", "data", "osm");
const ZONES_FILE = join(ROOT, "public", "data", "amp", "zones.geojson");
const OUT = join(ROOT, "public", "data", "amp", "public_space.json");
const CONFIG = ZONE_CONFIG.autoData.publicSpace;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const tagsOf = (feature: Feature): Record<string, string> =>
  Object.fromEntries(Object.entries(feature.properties ?? {}).map(([k, v]) => [k, String(v)]));

const isPolygon = (feature: Feature): boolean =>
  feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon";

const isTrail = (tags: Record<string, string>): boolean => {
  const highway = tags.highway;
  if (highway !== "path" && highway !== "footway" && highway !== "steps") return false;
  const rule = ZONE_CONFIG.autoData.excludeTrails;
  if (rule.tags.some((key) => tags[key] !== undefined)) return true;
  const name = tags.name?.toLowerCase();
  if (name && rule.nameStartsWith.some((p) => name.startsWith(p.toLowerCase()))) return true;
  const surface = tags.surface?.toLowerCase();
  return highway === "path" && surface !== undefined && rule.unpavedSurfaces.includes(surface);
};

async function overpass(query: string): Promise<unknown> {
  let last = "";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "mjsl/0.1 (academic project)" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(240_000),
      });
      if (response.ok) return await response.json();
      last = `HTTP ${response.status} from ${new URL(endpoint).host}`;
    } catch (error) {
      last = `${new URL(endpoint).host}: ${error instanceof Error ? error.message : error}`;
    }
  }
  throw new Error(`Overpass failed: ${last}`);
}

const b = STUDY_AREA.bbox;
const bbox = `${b.south},${b.west},${b.north},${b.east}`;
console.log("Querying public spaces, land use and natural areas from OSM...");
const payload = (await overpass(`[out:json][timeout:180];
(
  way["landuse"](${bbox});
  way["natural"](${bbox});
  way["leisure"~"^(park|garden|playground|sports_centre|nature_reserve)$"](${bbox});
  way["place"="square"](${bbox});
  way["amenity"~"^(school|townhall|community_centre|social_centre|library|marketplace|place_of_worship|arts_centre|theatre|cinema)$"](${bbox});
);
out body geom;`)) as Parameters<typeof osmToGeojson>[0];

const osm = osmToGeojson(payload);
const publicFeatures: Feature[] = [];
const naturalFeatures: Feature[] = [];
for (const feature of osm.features as Feature[]) {
  if (!isPolygon(feature)) continue;
  const tags = tagsOf(feature);
  const isPublic =
    (tags.leisure && CONFIG.publicLeisure.includes(tags.leisure)) ||
    (tags.place && CONFIG.publicPlaces.includes(tags.place)) ||
    (tags.landuse && CONFIG.publicLanduse.includes(tags.landuse)) ||
    (tags.amenity && CONFIG.publicAmenities.includes(tags.amenity));
  const isNatural =
    (tags.natural && CONFIG.naturalTags.includes(tags.natural)) ||
    (tags.landuse && CONFIG.naturalLanduse.includes(tags.landuse));
  if (isPublic) publicFeatures.push(feature);
  if (isNatural) naturalFeatures.push(feature);
}
const publicIndex = new PolygonIndex({ type: "FeatureCollection", features: publicFeatures } as FeatureCollection);
const naturalIndex = new PolygonIndex({ type: "FeatureCollection", features: naturalFeatures } as FeatureCollection);
console.log(`OSM: ${publicFeatures.length} public polygons, ${naturalFeatures.length} natural polygons.`);

// Streets from the committed snapshots, so the script does not query them again.
type Street = { a: LngLat; b: LngLat; width: number };
const streets = new SpatialGrid<Street>(50);
const seen = new Set<string>();
const snapshots = (await readdir(OSM_DIR)).filter((f) => /^walkways_mjsl5_.*\.geojson\.gz$/.test(f));
let streetSegments = 0;
for (const name of snapshots) {
  const bytes = gunzipSync(await readFile(join(OSM_DIR, name)));
  const collection = JSON.parse(bytes.toString("utf8")) as FeatureCollection;
  for (const feature of collection.features as Feature[]) {
    const tags = tagsOf(feature);
    const highway = tags.highway;
    if (!highway || !ZONE_CONFIG.autoData.streetHighways.includes(highway) || isTrail(tags)) continue;
    const key = String(feature.id ?? tags.osm_id ?? "");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (feature.geometry?.type !== "LineString") continue;
    const coords = feature.geometry.coordinates as LngLat[];
    const width = CONFIG.streetWidthsM[highway] ?? CONFIG.defaultStreetWidthM;
    for (let i = 1; i < coords.length; i += 1) {
      const start = coords[i - 1]!;
      const end = coords[i]!;
      const length = distanceM(start, end);
      const pieces = Math.max(1, Math.ceil(length / 100));
      for (let k = 0; k < pieces; k += 1) {
        const t0 = k / pieces;
        const t1 = (k + 1) / pieces;
        const a: LngLat = [start[0] + (end[0] - start[0]) * t0, start[1] + (end[1] - start[1]) * t0];
        const bb: LngLat = [start[0] + (end[0] - start[0]) * t1, start[1] + (end[1] - start[1]) * t1];
        const halfLon = width / 2 / KX;
        const halfLat = width / 2 / KY;
        streets.addBox(
          Math.min(a[0], bb[0]) - halfLon,
          Math.min(a[1], bb[1]) - halfLat,
          Math.max(a[0], bb[0]) + halfLon,
          Math.max(a[1], bb[1]) + halfLat,
          { a, b: bb, width },
        );
        streetSegments += 1;
      }
    }
  }
}
console.log(`Streets: ${snapshots.length} snapshots, ${streetSegments} segments.`);

function pointSegmentDistanceM(p: LngLat, a: LngLat, b: LngLat): number {
  const px = p[0] * KX;
  const py = p[1] * KY;
  const ax = a[0] * KX;
  const ay = a[1] * KY;
  const bx = b[0] * KX;
  const by = b[1] * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const zones = JSON.parse(await readFile(ZONES_FILE, "utf8")) as FeatureCollection;
const zoneIndex = new PolygonIndex(zones);
const gridM = CONFIG.gridM;
const dLon = gridM / KX;
const dLat = gridM / KY;
const iris: Record<string, Record<string, number | string>> = {};
let done = 0;

for (const feature of zones.features as Feature[]) {
  const id = String(feature.properties?.id ?? "");
  if (!id || !feature.geometry) continue;
  const [west, south, east, north] = bboxOfCoordinates((feature.geometry as { coordinates: unknown }).coordinates);
  let builtUp = 0;
  let publicPolygon = 0;
  let publicStreet = 0;

  for (let i = Math.ceil(west / dLon); i * dLon <= east; i += 1) {
    for (let j = Math.ceil(south / dLat); j * dLat <= north; j += 1) {
      const p: LngLat = [i * dLon, j * dLat];
      const hit = zoneIndex.at(p)[0];
      if (!hit || String(hit.id) !== id) continue;
      const isPublic = publicIndex.at(p).length > 0;
      const isNatural = naturalIndex.at(p).length > 0;
      if (isNatural && !isPublic) continue; // outside the built-up area
      builtUp += 1;
      if (isPublic) {
        publicPolygon += 1;
        continue;
      }
      for (const street of streets.near(p, 0)) {
        if (pointSegmentDistanceM(p, street.a, street.b) <= street.width / 2) {
          publicStreet += 1;
          break;
        }
      }
    }
  }

  const publicTotal = publicPolygon + publicStreet;
  const record: Record<string, number | string> = {
    builtUpSamples: builtUp,
    publicSamples: publicTotal,
    parkSamples: publicPolygon,
    streetSamples: publicStreet,
    builtUpM2: builtUp * gridM * gridM,
    publicM2: publicTotal * gridM * gridM,
    gridM,
    quality: builtUp < CONFIG.minBuiltUpSamples ? "low" : naturalFeatures.length === 0 ? "no-natural" : "osm",
  };
  if (builtUp >= CONFIG.minBuiltUpSamples) record.share = Number((publicTotal / builtUp).toFixed(4));
  iris[id] = record;
  done += 1;
  if (done % 50 === 0) console.log(`  ${done}/${zones.features.length} zones...`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      source: "OpenStreetMap (ODbL), methode UN-Habitat 11.7.1",
      method: "(public open spaces + streets) / built-up area, 50 m lattice",
      gridM,
      minBuiltUpSamples: CONFIG.minBuiltUpSamples,
      iris,
    },
    null,
    2,
  )}\n`,
);
console.log(`${Object.keys(iris).length} IRIS -> ${OUT}`);
