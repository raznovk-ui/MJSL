import type { FeatureCollection } from "geojson";
import { PolygonIndex } from "./spatial.js";
import type { LngLat } from "./types.js";

/** The official Lden band polygons, indexed by place. */
export type NoiseIndex = PolygonIndex;

/** Reads the official Lden band polygons (property `isophone` = lower limit of the band in dB: 55, 60, 65, 70, 75). */
export function buildNoiseIndex(collection: FeatureCollection): NoiseIndex {
  return new PolygonIndex({
    type: "FeatureCollection",
    features: collection.features.filter((f) => Number.isFinite(Number(f.properties?.isophone))),
  });
}

/**
 * Highest band containing the point, or null when it is in none. Taking the
 * highest works whether the source polygons are stacked ("55 and above") or
 * exclusive ("55 to 60").
 */
export function bandAt(index: NoiseIndex, point: LngLat): number | null {
  const bands = index.at(point).map((p) => Number(p.isophone));
  return bands.length > 0 ? Math.max(...bands) : null;
}
