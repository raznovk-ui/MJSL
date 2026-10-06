import type { Dimension } from "../dimensions.js";
import type { Segment, SegmentScore } from "./types.js";

/** The six dimensions of the MJSL, in the order of the memoire (D1 to D6). */
export const SCORED_DIMENSIONS = ["physical", "sensory", "cognitive", "economic", "socio_cultural", "political"] as const satisfies readonly Dimension[];
export type ScoredDimension = (typeof SCORED_DIMENSIONS)[number];

export interface DimensionScore {
  /** 0 = total obstacle, 1 = no obstacle; null when no segment has data for it. */
  score: number | null;
  /** Share (0..1) of the length that has data for this dimension. */
  coverage: number;
}

export type DimensionScores = Record<ScoredDimension, DimensionScore>;

/** Score of one segment for one dimension: 1 minus its average obstacle. */
export const dimensionScoreOf = (score: SegmentScore | undefined, dimension: Dimension): number | null => {
  const barrier = score?.dimensionBarriers[dimension];
  return barrier === undefined ? null : 1 - barrier;
};

/**
 * One score per dimension over a set of segments, weighted by length, counting only
 * the segments that have data for that dimension. A dimension nobody has data for
 * is null, never 0. Independent of the profile: the profile only decides how much each
 * dimension weighs in the final score.
 */
export function dimensionScores(segments: Segment[], scores: Record<string, SegmentScore>): DimensionScores {
  const out = {} as DimensionScores;
  const totalLength = segments.reduce((sum, s) => sum + (s.lengthM ?? 0), 0);
  for (const dimension of SCORED_DIMENSIONS) {
    let weighted = 0;
    let known = 0;
    for (const segment of segments) {
      const value = dimensionScoreOf(scores[segment.id], dimension);
      if (value === null) continue;
      const length = segment.lengthM ?? 0;
      weighted += value * length;
      known += length;
    }
    out[dimension] = { score: known > 0 ? weighted / known : null, coverage: totalLength > 0 ? known / totalLength : 0 };
  }
  return out;
}
