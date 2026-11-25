import type { Feature, FeatureCollection } from "geojson";
import { versionedUrl } from "../dataManifest.js";

/**
 * Prepared copies of the OpenStreetMap data, shipped with the app in
 * public/data/osm/, so the app starts without depending on Overpass (a free public
 * server that is sometimes down). Made by `npm run data:osm`.
 */

/** The only tags the scoring and the map read. Everything else is dropped to keep the files small. */
const KEEP_TAGS = new Set([
  // read by the scoring (domain/zone/build.ts)
  "highway", "name", "width", "sidewalk:width", "surface", "ramp", "ramp:wheelchair", "lit",
  "amenity", "shop", "tourism", "historic", "leisure", "office", "outdoor_seating", "fee",
  "man_made", "barrier", "shelter", "covered", "building:part", "crossing", "information",
  "traffic_signals", "tactile_paving",
  // the trail tags of autoData.excludeTrails in zone.config.json
  "sac_scale", "trail_visibility", "mtb:scale",
  // read by the "Indices OSM" map layer (app/map/osmStyle.ts)
  "kerb",
  "osm_id",
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

const snapshotUrl = (presetId: string, version?: string) =>
  versionedUrl(`${import.meta.env.BASE_URL}data/osm/${presetId}.geojson.gz`, version);
const manifestUrl = () => `${import.meta.env.BASE_URL}data/osm/manifest.json`;
const memorySnapshots = new Map<string, FeatureCollection>();

export interface SnapshotOptions {
  /** Revalidate the file with the server even if this session already decoded it. */
  forceReload?: boolean;
  /** Global data version, appended to the URL so a new deployment cannot reuse old cached bytes. */
  dataVersion?: string;
}

/** Hashes of every snapshot file, made by `npm run data:osm` (or `data:osm-manifest`). */
export interface SnapshotManifest {
  generatedAt: string;
  version: string;
  files: Record<string, string>;
}

/** The current deployment's snapshot manifest, or null when it is missing/unreadable. */
export async function fetchSnapshotManifest(
  fetchImpl: typeof fetch = fetch,
  options: SnapshotOptions = {},
): Promise<SnapshotManifest | null> {
  try {
    const response = await fetchImpl(manifestUrl(), options.forceReload ? { cache: "no-cache" } : undefined);
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<SnapshotManifest> | null;
    if (!data || typeof data.version !== "string" || typeof data.files !== "object" || data.files === null) return null;
    return data as SnapshotManifest;
  } catch {
    return null;
  }
}

export async function fetchSnapshot(
  presetId: string,
  fetchImpl: typeof fetch = fetch,
  options: SnapshotOptions = {},
): Promise<FeatureCollection | null> {
  const memoryKey = `${presetId}:${options.dataVersion ?? ""}`;
  if (!options.forceReload && fetchImpl === fetch) {
    const cached = memorySnapshots.get(memoryKey);
    if (cached) return cached;
  }
  try {
    const response = await fetchImpl(snapshotUrl(presetId, options.dataVersion), options.forceReload ? { cache: "no-cache" } : undefined);
    if (!response.ok) return null;
    const decoded = await decodeSnapshot(await response.arrayBuffer());
    if (decoded && fetchImpl === fetch) {
      memorySnapshots.set(memoryKey, decoded);
    }
    return decoded;
  } catch {
    return null;
  }
}
