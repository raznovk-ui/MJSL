import type { Feature, FeatureCollection, Geometry } from "geojson";
import { KX, KY, bboxOfCoordinates } from "./geo.js";
import type { LngLat } from "./types.js";

/**
 * A uniform grid of ~100 m cells, so "what is near here?" looks at a handful of
 * items instead of every one in the city. Without it, scoring the whole city
 * compares every zone, report and place with every other one.
 */
export class SpatialGrid<T> {
  private cells = new Map<string, T[]>();
  /** Items too large to index cell by cell: returned by every query. */
  private oversize: T[] = [];
  constructor(private cellM = 100) {}

  private cx = (lng: number) => Math.floor((lng * KX) / this.cellM);
  private cy = (lat: number) => Math.floor((lat * KY) / this.cellM);

  addPoint(p: LngLat, item: T) {
    this.push(this.cx(p[0]), this.cy(p[1]), item);
  }

  addBox(minLng: number, minLat: number, maxLng: number, maxLat: number, item: T) {
    const x0 = this.cx(minLng), x1 = this.cx(maxLng), y0 = this.cy(minLat), y1 = this.cy(maxLat);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) {
      this.oversize.push(item);
      return;
    }
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) this.push(x, y, item);
  }

  private push(x: number, y: number, item: T) {
    const key = `${x},${y}`;
    const list = this.cells.get(key);
    if (list) list.push(item);
    else this.cells.set(key, [item]);
  }

  /** Items whose cell lies within `radiusM` of the point (a superset of those truly within it). */
  near(p: LngLat, radiusM: number): T[] {
    const r = Math.ceil(radiusM / this.cellM);
    const x0 = this.cx(p[0]);
    const y0 = this.cy(p[1]);
    const seen = new Set<T>(this.oversize);
    for (let x = x0 - r; x <= x0 + r; x += 1) {
      for (let y = y0 - r; y <= y0 + r; y += 1) for (const item of this.cells.get(`${x},${y}`) ?? []) seen.add(item);
    }
    return [...seen];
  }
}

/** The polygons of a geometry, each as its rings (outer ring first, then any holes). Anything else gives none. */
export function polygonsOf(geometry: Geometry | null | undefined): LngLat[][][] {
  if (geometry?.type === "Polygon") return [geometry.coordinates as LngLat[][]];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates as LngLat[][][];
  return [];
}

/** Even-odd test across every ring, so holes are respected. */
function insideRings(point: LngLat, rings: LngLat[][]): boolean {
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

interface PolygonEntry {
  rings: LngLat[][];
  bbox: [number, number, number, number];
  properties: Record<string, unknown>;
}

/**
 * "Which polygons contain this point?" over a collection of polygons (the zones, the noise
 * bands, the participation perimeters), answered through a spatial grid.
 */
export class PolygonIndex {
  private grid = new SpatialGrid<PolygonEntry>(250);
  size = 0;

  constructor(collection?: FeatureCollection) {
    for (const feature of (collection?.features ?? []) as Feature[]) {
      for (const rings of polygonsOf(feature.geometry)) {
        const outer = rings[0];
        if (!outer || outer.length < 4) continue;
        const bbox = bboxOfCoordinates(outer);
        this.grid.addBox(...bbox, { rings, bbox, properties: (feature.properties ?? {}) as Record<string, unknown> });
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
