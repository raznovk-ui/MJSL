import { SpatialGrid } from "./spatial.js";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { LngLat } from "./types.js";

interface BandPolygon {
  /** Lower limit of the Lden band, in dB (55, 60, 65, 70, 75). */
  band: number;
  bbox: [number, number, number, number];
  /** Outer ring first, then any holes. */
  rings: LngLat[][];
}

export interface NoiseIndex {
  polygons: BandPolygon[];
  grid: SpatialGrid<BandPolygon>;
}

function polygonsOf(geometry: Geometry | null): LngLat[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as LngLat[][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as LngLat[][][];
  return [];
}

/** Reads the official Lden band polygons (property `isophone` = lower limit in dB). */
export function buildNoiseIndex(collection: FeatureCollection): NoiseIndex {
  const polygons: BandPolygon[] = [];
  const grid = new SpatialGrid<BandPolygon>();
  for (const feature of collection.features as Feature[]) {
    const band = Number((feature.properties as Record<string, unknown> | null)?.isophone);
    if (!Number.isFinite(band)) continue;
    for (const rings of polygonsOf(feature.geometry)) {
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of outer) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const polygon: BandPolygon = { band, bbox: [minX, minY, maxX, maxY], rings };
      polygons.push(polygon);
      grid.addBox(minX, minY, maxX, maxY, polygon);
    }
  }
  return { polygons, grid };
}

/** Even-odd test across every ring, so holes are respected. */
function inside(point: LngLat, rings: LngLat[][]): boolean {
  const [x, y] = point;
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

/**
 * Highest band containing the point, or null when it is in none. Taking the
 * highest works whether the source polygons are stacked ("55 and above") or
 * exclusive ("55 to 60").
 */
export function bandAt(index: NoiseIndex, point: LngLat): number | null {
  let best: number | null = null;
  for (const polygon of index.grid.near(point, 0)) {
    const [minX, minY, maxX, maxY] = polygon.bbox;
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
    if ((best === null || polygon.band > best) && inside(point, polygon.rings)) best = polygon.band;
  }
  return best;
}
