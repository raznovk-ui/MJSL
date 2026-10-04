/**
 * One-time (re-runnable) download of the official road-noise map for the study
 * area, trimmed to what the scoring needs.
 *
 *   npm run data:noise
 *
 * Source: "Bruit multiexposition (route, fer, air, industrie) - Lden type A", Metropole
 * d'Aix-Marseille-Provence (study by Impedance Ingenierie), Licence Ouverte 2.0.
 * https://data.ampmetropole.fr/explore/dataset/fr-observatoire-du-bruit-bruit_cumul/
 *
 * The portal clips by area on its side, so only the study area is downloaded
 * instead of the whole Metropole (about 60 MB). Coordinates are rounded to
 * 5 decimals (about 1 m) and only the band (isophone) is kept.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BBOX = { south: 43.255, west: 5.335, north: 43.305, east: 5.385 }; // = src/app/studyArea.ts
const DATASET =
  "https://data.ampmetropole.fr/api/explore/v2.1/catalog/datasets/fr-observatoire-du-bruit-bruit_cumul";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "noise_lden_all.geojson");

const { south, west, north, east } = BBOX;
const polygon = `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
const url = new URL(`${DATASET}/exports/geojson`);
url.searchParams.set("where", `intersects(geo_shape, geom'${polygon}')`);
url.searchParams.set("select", "isophone,geo_shape");

console.log("Downloading the noise map for the study area...");
const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
if (!response.ok) throw new Error(`Noise map download failed: HTTP ${response.status}`);
const source = await response.json();

const round = (n) => Math.round(n * 1e5) / 1e5;
const trimRing = (ring) => {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p); // drop points that collapse together
  }
  return out;
};

const features = [];
for (const f of source.features ?? []) {
  const band = Number(f.properties?.isophone);
  if (!Number.isFinite(band) || f.geometry?.type !== "Polygon") continue;
  const rings = f.geometry.coordinates.map(trimRing).filter((r) => r.length >= 4);
  if (rings.length === 0) continue;
  features.push({ type: "Feature", properties: { isophone: band }, geometry: { type: "Polygon", coordinates: rings } });
}
if (features.length === 0) throw new Error("No noise polygons came back. Is the study area right?");

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ type: "FeatureCollection", features }));
const bands = [...new Set(features.map((f) => f.properties.isophone))].sort((a, b) => a - b);
console.log(`${features.length} polygons, bands ${bands.join(", ")} dB -> ${OUT}`);
