import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { LngLat } from "./types.js";

/** Local flat projection around Marseille: good to a fraction of a percent over the whole city. */
export const KY = 110_540;
export const KX = 111_320 * Math.cos((43.28 * Math.PI) / 180);

export const polygonsOf = (geometry: Polygon | MultiPolygon): LngLat[][][] =>
  geometry.type === "Polygon" ? [geometry.coordinates as LngLat[][]] : (geometry.coordinates as LngLat[][][]);

const ringArea = (ring: LngLat[]): { area: number; cx: number; cy: number } => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = [ring[j]![0] * KX, ring[j]![1] * KY];
    const [x1, y1] = [ring[i]![0] * KX, ring[i]![1] * KY];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return { area: a / 2, cx, cy };
};

/** Area in km2 (holes subtracted) and centroid of a zone. */
export function areaAndCentroid(geometry: Polygon | MultiPolygon): { areaKm2: number; centroid: LngLat } {
  let total = 0, mx = 0, my = 0;
  for (const rings of polygonsOf(geometry)) {
    rings.forEach((ring, index) => {
      const { area, cx, cy } = ringArea(ring);
      if (area === 0) return;
      const sign = index === 0 ? 1 : -1; // holes subtract
      const weight = sign * Math.abs(area);
      total += weight;
      // The ring's own centroid is (cx, cy) / (6 * signed area), whichever way it turns.
      mx += weight * (cx / (6 * area));
      my += weight * (cy / (6 * area));
    });
  }
  return {
    areaKm2: Math.max(total / 1_000_000, 0),
    centroid: total > 0 ? [mx / total / KX, my / total / KY] : firstPoint(geometry),
  };
}

function firstPoint(geometry: Polygon | MultiPolygon): LngLat {
  return polygonsOf(geometry)[0]?.[0]?.[0] ?? [0, 0];
}

/** A representative point of any geometry: the point itself, the middle vertex of a line, the mean of a polygon's vertices. */
export function anchorOf(geometry: Geometry | null | undefined): LngLat | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Point":
      return geometry.coordinates as LngLat;
    case "LineString": {
      const c = geometry.coordinates as LngLat[];
      return c.length ? c[Math.floor(c.length / 2)]! : null;
    }
    case "Polygon": {
      const ring = (geometry.coordinates as LngLat[][])[0];
      if (!ring?.length) return null;
      let x = 0, y = 0;
      for (const [px, py] of ring) { x += px; y += py; }
      return [x / ring.length, y / ring.length];
    }
    default:
      return null;
  }
}
