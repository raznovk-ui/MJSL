import type { LngLat } from "./types.js";

/** Stable key for a coordinate (about 0.1 m), shared by every place that matches points. */
export const coordKey = (c: LngLat) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;

/** Local flat projection around Marseille (metres per degree): good to a fraction of a percent over the whole city. */
export const KY = 110_540;
export const KX = 111_320 * Math.cos((43.28 * Math.PI) / 180);

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polylineLengthM(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += distanceM(coords[i - 1]!, coords[i]!);
  return total;
}

/** Bounding box [west, south, east, north] of any nested GeoJSON coordinate array. */
export function bboxOfCoordinates(coordinates: unknown, into: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]): [number, number, number, number] {
  if (Array.isArray(coordinates) && typeof coordinates[0] === "number") {
    const [x, y] = coordinates as [number, number];
    if (x < into[0]) into[0] = x;
    if (y < into[1]) into[1] = y;
    if (x > into[2]) into[2] = x;
    if (y > into[3]) into[3] = y;
  } else if (Array.isArray(coordinates)) {
    for (const c of coordinates) bboxOfCoordinates(c, into);
  }
  return into;
}
