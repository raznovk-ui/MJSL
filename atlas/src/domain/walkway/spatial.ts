import type { LngLat } from "./types.js";

const KY = 110_540;
const KX = 111_320 * Math.cos((43.28 * Math.PI) / 180); // Marseille: flat, local metres

/**
 * A uniform grid of ~100 m cells, so "what is near here?" looks at a handful of
 * items instead of every one in the city. Without it, scoring the whole city
 * compares every segment with every bench, road and noise polygon.
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
