/**
 * Trims the zones to the land: the IRIS polygons run out into the sea, which would colour the
 * water and count it in the area of the coastal zones.
 *
 *   npm run data:zones     (fetches the zones, then clips them; or run this alone after data:amp)
 *
 * The coast comes from OpenStreetMap (natural=coastline, ODbL). OSM draws the coastline with
 * the land on the LEFT of its direction, so the land is rebuilt from it the standard way:
 * each stretch of coast that enters and leaves the working rectangle is closed by walking
 * the rectangle's edge counter-clockwise, and islands are the closed rings. Each zone is then
 * intersected with that land. Running it twice changes nothing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "amp", "zones.geojson");
// A rectangle larger than the study area, so that the coast is complete around it.
const R = { west: 5.10, south: 43.10, east: 5.65, north: 43.45 };
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const round = (n) => Math.round(n * 1e5) / 1e5;

async function coastline() {
  const query = `[out:json][timeout:90];way["natural"="coastline"](${R.south},${R.west},${R.north},${R.east});out geom;`;
  let last = "";
  for (let round = 0; round < 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "msjl-atlas/0.1 (academic project)" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(120_000),
        });
        if (response.ok) return (await response.json()).elements;
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = String(error);
      }
    }
    await new Promise((r) => setTimeout(r, 10_000 * (round + 1)));
  }
  throw new Error(`Could not download the coastline: ${last}`);
}

/** Joins the coastline ways end to end into chains of [lon, lat]. */
function chainsOf(ways) {
  const startsAt = new Map();
  const endNodes = new Set();
  for (const w of ways) {
    startsAt.set(w.nodes[0], w);
    endNodes.add(w.nodes[w.nodes.length - 1]);
  }
  const used = new Set();
  const chains = [];
  const follow = (first) => {
    const coords = first.geometry.map((p) => [p.lon, p.lat]);
    used.add(first);
    let tail = first.nodes[first.nodes.length - 1];
    for (;;) {
      const next = startsAt.get(tail);
      if (!next || used.has(next)) break;
      used.add(next);
      coords.push(...next.geometry.slice(1).map((p) => [p.lon, p.lat]));
      tail = next.nodes[next.nodes.length - 1];
    }
    return coords;
  };
  for (const w of ways) {
    // A chain's head is a way whose first node is nobody's last node.
    if (!used.has(w) && !endNodes.has(w.nodes[0])) chains.push(follow(w));
  }
  for (const w of ways) if (!used.has(w)) chains.push(follow(w)); // what is left are closed rings
  return chains;
}

const W = R.east - R.west;
const H = R.north - R.south;
const eps = 1e-9;
/** Position along the rectangle's border, counter-clockwise from its south-west corner. */
function perimeter([x, y]) {
  if (Math.abs(y - R.south) < eps) return x - R.west;
  if (Math.abs(x - R.east) < eps) return W + (y - R.south);
  if (Math.abs(y - R.north) < eps) return W + H + (R.east - x);
  return 2 * W + H + (R.north - y); // west edge
}
/** The rectangle's corners met going counter-clockwise from perimeter position `from` to `to`. */
function corners(from, to) {
  const total = 2 * (W + H);
  const gap = (((to - from) % total) + total) % total;
  const all = [[0, [R.west, R.south]], [W, [R.east, R.south]], [W + H, [R.east, R.north]], [2 * W + H, [R.west, R.north]]];
  return all
    .map(([t, p]) => ({ d: (((t - from) % total) + total) % total, p }))
    .filter((c) => c.d > eps && c.d < gap - eps)
    .sort((x, y) => x.d - y.d)
    .map((c) => c.p);
}

function landOf(chains) {
  const polygons = [];
  const pieces = [];
  for (const coords of chains) {
    const closed = coords.length > 3 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
    const inside = coords.every(([x, y]) => x > R.west && x < R.east && y > R.south && y < R.north);
    if (closed && inside) {
      // An island has the land on its left: counter-clockwise. A clockwise ring would be a lake: skipped.
      if (ringArea(coords) < 0) polygons.push([coords]); // negative here means counter-clockwise
      continue;
    }
    const clipped = turf.bboxClip(turf.lineString(coords), [R.west, R.south, R.east, R.north]).geometry;
    const lines = clipped.type === "LineString" ? [clipped.coordinates] : clipped.coordinates;
    for (const line of lines) if (line.length > 1) pieces.push(line);
  }
  // Close the open pieces along the rectangle, counter-clockwise.
  const starts = pieces.map((p, i) => ({ i, t: perimeter(p[0]) })).sort((a, b) => a.t - b.t);
  const done = new Set();
  const total = 2 * (W + H);
  for (const first of starts) {
    if (done.has(first.i)) continue;
    const ring = [];
    let current = first.i;
    for (let guard = 0; guard < pieces.length + 2; guard += 1) {
      done.add(current);
      ring.push(...pieces[current]);
      const end = pieces[current].at(-1);
      const tEnd = perimeter(end);
      // The next piece starting after this end, going counter-clockwise.
      const next = starts.filter((s) => s.i === first.i || !done.has(s.i)).map((s) => ({ ...s, d: (((s.t - tEnd) % total) + total) % total })).sort((a, b) => a.d - b.d)[0];
      ring.push(...corners(tEnd, next.t));
      if (next.i === first.i) break;
      current = next.i;
    }
    ring.push(ring[0]);
    polygons.push([ring]);
  }
  return turf.multiPolygon(polygons);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

const zones = JSON.parse(await readFile(FILE, "utf8"));
console.log("Downloading the coastline...");
const chains = chainsOf(await coastline());
console.log(`${chains.length} coast chains`);
const land = landOf(chains);

// Safeguards: the rebuild must put known places on the right side of the water.
const known = [
  [[5.3714, 43.2840], true, "Notre-Dame de la Garde"],
  [[5.3880, 43.2700], true, "Prado, inland"],
  [[5.2800, 43.2300], false, "open sea off the Calanques"],
  [[5.3000, 43.3300], false, "open sea off l'Estaque"],
];
for (const [p, shouldBeLand, label] of known) {
  if (turf.booleanPointInPolygon(p, land) !== shouldBeLand) throw new Error(`The land rebuilt from the coastline is wrong at "${label}" (expected ${shouldBeLand ? "land" : "sea"}).`);
}

const parts = land.geometry.coordinates.map((coordinates) => ({ coordinates, bbox: turf.bbox(turf.polygon(coordinates)) }));
let before = 0, after = 0, dropped = 0;
const out = [];
for (const feature of zones.features) {
  before += turf.area(feature);
  const [w, s, e, n] = turf.bbox(feature);
  // Only the parts of the land that touch the zone's bounding box take part in the intersection.
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
  if (!clipped) { dropped += 1; console.log(`  ${feature.properties.name}: entirely in the sea, dropped`); continue; }
  const round2 = (c) => (typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(round2));
  const geometry = { type: clipped.geometry.type, coordinates: round2(clipped.geometry.coordinates) };
  const feature2 = { type: "Feature", properties: feature.properties, geometry };
  after += turf.area(feature2);
  out.push(feature2);
}
await writeFile(FILE, JSON.stringify({ type: "FeatureCollection", features: out }));
console.log(`${out.length} zones (${dropped} dropped). Area ${(before / 1e6).toFixed(1)} km2 -> ${(after / 1e6).toFixed(1)} km2 (${(((before - after) / before) * 100).toFixed(1)} % was water).`);
