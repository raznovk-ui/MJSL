import type { Feature, FeatureCollection } from "geojson";

/**
 * Prepared copies of the OpenStreetMap data, shipped with the app in
 * public/data/osm/, so the app starts without depending on Overpass (a free public
 * server that is sometimes down). Made by `npm run data:osm`.
 */

/** The only tags the scoring and the map read. Everything else is dropped to keep the files small. */
const KEEP_TAGS = new Set([
  "highway", "name", "width", "sidewalk:width", "incline", "surface", "ramp", "ramp:wheelchair",
  "lit", "amenity", "shop", "tourism", "historic", "leisure", "office", "outdoor_seating",
  "kerb", "maxspeed", "foot", "access", "tactile_paving", "wheelchair",
  "sac_scale", "trail_visibility", "mtb:scale",
  "man_made", "barrier", "entrance", "shelter", "covered", "step_count", "fee", "building:part",
  "osm_id", "osm_nodes", "label",
]);

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function roundCoords(value: unknown): unknown {
  if (typeof value === "number") return round(value);
  return Array.isArray(value) ? value.map(roundCoords) : value;
}

export function trimCollection(collection: FeatureCollection): FeatureCollection {
  const features: Feature[] = collection.features.map((feature) => {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (KEEP_TAGS.has(key) && value !== "") properties[key] = value;
    }
    const geometry = feature.geometry as unknown as { type: string; coordinates: unknown };
    return {
      type: "Feature",
      id: feature.id,
      properties,
      geometry: { type: geometry.type, coordinates: roundCoords(geometry.coordinates) } as Feature["geometry"],
    };
  });
  return { type: "FeatureCollection", features };
}

export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a snapshot file. Returns null when the bytes are not a snapshot (for example
 * the dev server answering a missing file with the app's HTML page).
 */
export async function decodeSnapshot(bytes: ArrayBuffer): Promise<FeatureCollection | null> {
  const view = new Uint8Array(bytes);
  try {
    let text: string;
    if (view[0] === 0x1f && view[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(view); // some servers decompress on the way
    }
    const parsed = JSON.parse(text) as FeatureCollection;
    return parsed?.type === "FeatureCollection" && Array.isArray(parsed.features) ? parsed : null;
  } catch {
    return null;
  }
}

export const snapshotUrl = (presetId: string) => `${import.meta.env.BASE_URL}data/osm/${presetId}.geojson.gz`;

export async function fetchSnapshot(presetId: string, fetchImpl: typeof fetch = fetch): Promise<FeatureCollection | null> {
  try {
    const response = await fetchImpl(snapshotUrl(presetId));
    if (!response.ok) return null;
    return await decodeSnapshot(await response.arrayBuffer());
  } catch {
    return null;
  }
}
