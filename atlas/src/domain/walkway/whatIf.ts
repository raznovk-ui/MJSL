import type { WalkwayConfig } from "./loadConfig.js";
import { findRoute } from "./route.js";
import { scoreSegment } from "./score.js";
import type { IndicatorKey, RouteResult, Segment, SegmentValues } from "./types.js";

/**
 * One change to try, for example:
 *   { segmentId: "A", set: { noiseDb: 65 } }       // noise on A drops to 65 dB
 *   { segmentId: "B", set: { hasRamp: true } }     // add a ramp on B
 */
export interface Change {
  segmentId: string;
  set: Partial<SegmentValues>;
}

const FIELD_TO_INDICATOR: Partial<Record<keyof SegmentValues, IndicatorKey>> = {
  widthM: "width",
  noiseDb: "noise",
  inclinePct: "slope",
  surface: "surface",
  restDistanceM: "rest",
  privatizedShare: "economic",
};

/** Copies of the segments with the changes applied; the originals are untouched. */
export function applyChanges(segments: Segment[], changes: Change[]): Segment[] {
  const known = new Set(segments.map((s) => s.id));
  for (const change of changes) {
    if (!known.has(change.segmentId)) throw new Error(`What-if: no segment with id "${change.segmentId}".`);
  }
  return segments.map((segment) => {
    const mine = changes.filter((c) => c.segmentId === segment.id);
    if (mine.length === 0) return segment;
    const values: SegmentValues = { ...segment.values };
    const sources = { ...segment.sources };
    for (const change of mine) {
      Object.assign(values, change.set);
      for (const field of Object.keys(change.set) as (keyof SegmentValues)[]) {
        const indicator = FIELD_TO_INDICATOR[field];
        // A value you set by hand is a stated fact, not an OSM guess.
        if (indicator) sources[indicator] = "measured";
      }
    }
    return { ...segment, values, sources };
  });
}

export interface WhatIfResult {
  /** Before/after for each changed segment and each profile. */
  segments: { segmentId: string; profileId: string; before: number | null; after: number | null }[];
  /** Before/after route results, when a route was given. */
  routes?: { profileId: string; before: RouteResult; after: RouteResult }[];
}

export function whatIf(
  segments: Segment[],
  changes: Change[],
  config: WalkwayConfig,
  route?: { from: string; to: string },
): WhatIfResult {
  const after = applyChanges(segments, changes);
  const changedIds = [...new Set(changes.map((c) => c.segmentId))];
  const profileIds = Object.keys(config.profiles);
  const beforeById = new Map(segments.map((s) => [s.id, s]));
  const afterById = new Map(after.map((s) => [s.id, s]));

  const result: WhatIfResult = {
    segments: changedIds.flatMap((segmentId) =>
      profileIds.map((profileId) => ({
        segmentId,
        profileId,
        before: scoreSegment(beforeById.get(segmentId)!, profileId, config).score,
        after: scoreSegment(afterById.get(segmentId)!, profileId, config).score,
      })),
    ),
  };

  if (route) {
    result.routes = profileIds.map((profileId) => ({
      profileId,
      before: findRoute(segments, route.from, route.to, profileId, config),
      after: findRoute(after, route.from, route.to, profileId, config),
    }));
  }
  return result;
}
