/**
 * Downloads the open data of the Aix-Marseille-Provence Metropole portal that the
 * scoring uses, trimmed to the study area, into public/data/amp/.
 *
 *   npm run data:amp
 *
 * Sources (Licence Ouverte 2.0, https://data.ampmetropole.fr):
 *   - transit stops (RTM) and metro/tram stations ........ physical: public transport
 *   - tourist offices ..................................... cognitive: information centres
 *   - income and poverty by IRIS (2014) ................... social: household context
 *   - priority neighbourhoods (QPV 2024) and project
 *     perimeters (ZAC, projet urbain partenarial, NPRU) ... political: participation devices
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BBOX = { south: 43.17, west: 5.22, north: 43.39, east: 5.54 }; // = STUDY_AREA in src/app/studyArea.ts
const API = "https://data.ampmetropole.fr/api/explore/v2.1/catalog/datasets";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "amp");
const { south, west, north, east } = BBOX;
const polygon = `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
const round = (n) => Math.round(n * 1e5) / 1e5;

async function records(dataset, { where, select } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const url = new URL(`${API}/${dataset}/records`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    if (where) url.searchParams.set("where", where);
    if (select) url.searchParams.set("select", select);
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "msjl-atlas/0.1 (academic project)" } });
    if (!response.ok) throw new Error(`${dataset}: HTTP ${response.status}`);
    const page = (await response.json()).results ?? [];
    rows.push(...page);
    if (page.length < 100 || offset > 9_000) return rows;
  }
}

const shapeOf = (row, key = "geo_shape") => {
  const g = row[key]?.geometry ?? row[key];
  if (!g || !["Polygon", "MultiPolygon"].includes(g.type)) return null;
  const ring = (r) => r.map(([x, y]) => [round(x), round(y)]);
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(ring)) };
};
const inside = (lon, lat) => lon >= west && lon <= east && lat >= south && lat <= north;
const save = async (name, data) => {
  await writeFile(join(OUT, name), JSON.stringify(data));
  console.log(`${name}: ${Array.isArray(data) ? data.length : data.features.length} objects`);
};

await mkdir(OUT, { recursive: true });

// Transit: stations (metro, tram) give the mode; the RTM stops are the bus network.
const stations = (await records("ls-stations-de-metro-et-de-tramway-marseille"))
  .filter((r) => r.point_geo && inside(r.point_geo.lon, r.point_geo.lat))
  .map((r) => ({ lon: round(r.point_geo.lon), lat: round(r.point_geo.lat), mode: /tram/i.test(r.mode_de_transport ?? "") ? "tram" : "metro" }));
const stops = (await records("ol-points-d-arret-des-reseaux-de-transport-en-commun"))
  .filter((r) => r.stop_coordinates && inside(r.stop_coordinates.lon, r.stop_coordinates.lat))
  .map((r) => ({ lon: round(r.stop_coordinates.lon), lat: round(r.stop_coordinates.lat), mode: "bus" }));
await save("transit.json", [...stations, ...stops]);

await save(
  "tourism.json",
  (await records("an-localisation-des-offices-de-tourisme"))
    .filter((r) => r.geo && inside(r.geo.lon, r.geo.lat))
    .map((r) => ({ lon: round(r.geo.lon), lat: round(r.geo.lat) })),
);

const features = (rows, props) =>
  ({ type: "FeatureCollection", features: rows.flatMap((r) => { const geometry = shapeOf(r); return geometry ? [{ type: "Feature", properties: props(r), geometry }] : []; }) });

await save(
  "iris.geojson",
  features(await records("fed-revenus-declares-pauvrete-et-niveau-de-vie-en-2014-iris", { where: `intersects(geo_shape, geom'${polygon}')` }), (r) => ({
    name: r.libiris,
    poverty: r.dec_tp6014 ?? null, // % of households under the poverty line (60 % of the median)
    median: r.dec_med14 ?? null, // median disposable income per consumption unit, euros
  })),
);

await save("qpv.geojson", features(await records("amest_pdv_qpv_2024_amp-", { where: `intersects(geo_shape, geom'${polygon}')` }), (r) => ({ name: r.lib_qp, kind: "qpv" })));

const projects = [];
for (const [dataset, kind] of [
  ["zone-d-amenagement-concerte-sur-amp", "zac"],
  ["projet-urbain-partenarial-sur-amp", "pup"],
  ["programme-national-pour-la-renovation-urbaine", "pnru"],
  ["quartier-prioritaire-de-la-politique-de-la-ville-vise-par-le-nouveau-programme-d", "npnru"],
]) {
  try {
    const rows = await records(dataset, { where: `intersects(geo_shape, geom'${polygon}')` });
    projects.push(...features(rows, (r) => ({ name: r.nom ?? r.lib_qp ?? r.libelle ?? kind, kind })).features);
  } catch (error) {
    console.log(`${kind}: skipped (${error.message})`);
  }
}
await save("projects.geojson", { type: "FeatureCollection", features: projects });
