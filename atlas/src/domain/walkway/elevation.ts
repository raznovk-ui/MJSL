import { coordKey } from "./geo.js";
import type { WalkwayConfig } from "./loadConfig.js";
import type { LngLat, Segment } from "./types.js";

/** Both ends of every segment, once each: the points whose altitude is needed. */
export function endpointCoordinates(segments: Segment[]): LngLat[] {
  const seen = new Map<string, LngLat>();
  for (const segment of segments) {
    const g = segment.geometry;
    if (!g || g.length < 2) continue;
    for (const c of [g[0]!, g[g.length - 1]!]) seen.set(coordKey(c), c);
  }
  return [...seen.values()];
}

/**
 * Fills in slope from altitudes at each segment's two ends. Only where nothing
 * better exists: an OSM `incline` tag or a value you measured is never replaced.
 *
 * Skipped, so it stays "no data" rather than becoming a guess:
 *  - steps (their rise is not a slope),
 *  - segments shorter than the minimum baseline (altitude error over a few
 *    metres would give a wild slope),
 *  - ends with no altitude.
 */
export function applyElevations(
  segments: Segment[],
  altitudes: Record<string, number>,
  config: WalkwayConfig,
): Segment[] {
  const { minBaselineM } = config.autoData.slope;
  return segments.map((segment) => {
    const g = segment.geometry;
    if (!g || g.length < 2) return segment;
    if (segment.values.inclinePct !== undefined || segment.values.hasSteps) return segment;
    if (segment.lengthM === undefined || segment.lengthM < minBaselineM) return segment;
    const z1 = altitudes[coordKey(g[0]!)];
    const z2 = altitudes[coordKey(g[g.length - 1]!)];
    if (z1 === undefined || z2 === undefined) return segment;
    return {
      ...segment,
      values: { ...segment.values, inclinePct: ((z2 - z1) / segment.lengthM) * 100 },
      sources: { ...segment.sources, slope: "official" },
    };
  });
}
