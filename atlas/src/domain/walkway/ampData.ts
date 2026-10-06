import type { Feature, FeatureCollection, Geometry } from "geojson";
import { SpatialGrid } from "./spatial.js";
import type { LngLat } from "./types.js";

/**
 * Open data of the Aix-Marseille-Provence Metropole portal (see scripts/fetchAmp.mjs):
 * what OpenStreetMap does not hold. Every part is optional: without it the indicators
 * that need it simply stay "no data".
 */
export interface AmpData {
  /** Public transport stops and stations, with their mode. */
  transit?: { lon: number; lat: number; mode: "bus" | "tram" | "metro" }[];
  /** Tourist offices (information centres). */
  tourism?: { lon: number; lat: number }[];
  /** Households' income and poverty by IRIS (2014). */
  iris?: FeatureCollection;
  /** Priority neighbourhoods (QPV). */
  qpv?: FeatureCollection;
  /** Perimeters of urban projects (ZAC, projet urbain partenarial, NPRU). */
  projects?: FeatureCollection;
}

interface PolygonEntry {
  rings: LngLat[][];
  bbox: [number, number, number, number];
  properties: Record<string, unknown>;
}

export class PolygonIndex {
  private grid = new SpatialGrid<PolygonEntry>(250);
  size = 0;

  constructor(collection?: FeatureCollection) {
    for (const feature of (collection?.features ?? []) as Feature[]) {
      for (const rings of polygonsOf(feature.geometry)) {
        const outer = rings[0];
        if (!outer || outer.length < 4) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of outer) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const entry: PolygonEntry = { rings, bbox: [minX, minY, maxX, maxY], properties: (feature.properties ?? {}) as Record<string, unknown> };
        this.grid.addBox(minX, minY, maxX, maxY, entry);
        this.size += 1;
      }
    }
  }

  /** Properties of every polygon containing the point (holes respected). */
  at(point: LngLat): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const e of this.grid.near(point, 0)) {
      const [minX, minY, maxX, maxY] = e.bbox;
      if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
      if (insideRings(point, e.rings)) out.push(e.properties);
    }
    return out;
  }
}

function polygonsOf(geometry: Geometry | null): LngLat[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as LngLat[][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as LngLat[][][];
  return [];
}

/** Even-odd test across every ring, so holes are respected. */
export function insideRings(point: LngLat, rings: LngLat[][]): boolean {
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

export interface AmpIndex {
  transit: SpatialGrid<{ p: LngLat; mode: string }>;
  hasTransit: boolean;
  tourism: SpatialGrid<LngLat>;
  hasTourism: boolean;
  iris: PolygonIndex;
  participation: PolygonIndex;
  hasParticipation: boolean;
}

export function buildAmpIndex(data: AmpData): AmpIndex {
  const transit = new SpatialGrid<{ p: LngLat; mode: string }>();
  for (const s of data.transit ?? []) transit.addPoint([s.lon, s.lat], { p: [s.lon, s.lat], mode: s.mode });
  const tourism = new SpatialGrid<LngLat>(500);
  for (const t of data.tourism ?? []) tourism.addPoint([t.lon, t.lat], [t.lon, t.lat]);
  const participation = new PolygonIndex({
    type: "FeatureCollection",
    features: [...(data.qpv?.features ?? []), ...(data.projects?.features ?? [])],
  });
  return {
    transit,
    hasTransit: (data.transit?.length ?? 0) > 0,
    tourism,
    hasTourism: (data.tourism?.length ?? 0) > 0,
    iris: new PolygonIndex(data.iris),
    participation,
    hasParticipation: participation.size > 0,
  };
}
