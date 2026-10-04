import type { LngLat } from "./types.js";

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

/** Distance from a point to a polyline, on a local flat projection (fine at street scale). */
export function pointToPolylineM(p: LngLat, coords: LngLat[]): number {
  if (coords.length === 0) return Infinity;
  const kx = R * Math.cos(rad(p[1])) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  const toXY = (c: LngLat): [number, number] => [(c[0] - p[0]) * kx, (c[1] - p[1]) * ky];
  if (coords.length === 1) {
    const [x, y] = toXY(coords[0]!);
    return Math.hypot(x, y);
  }
  let best = Infinity;
  for (let i = 1; i < coords.length; i += 1) {
    const [ax, ay] = toXY(coords[i - 1]!);
    const [bx, by] = toXY(coords[i]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** The point `d` metres along a polyline (clamped to its ends). */
export function pointAlong(coords: LngLat[], d: number): LngLat {
  if (coords.length === 0) return [0, 0];
  let remaining = Math.max(0, d);
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const len = distanceM(a, b);
    if (remaining <= len || i === coords.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, remaining / len);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= len;
  }
  return coords[0]!;
}
