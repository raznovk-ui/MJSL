import { DIMENSION_KEYS, type Dimension } from "../dimensions.js";
import type { Zone, ZoneScore } from "./types.js";

export interface DimensionScore {
  /** 0 = total obstacle, 1 = no obstacle; null when no zone has data for it. */
  score: number | null;
  /** Share (0..1) of the area that has data for this dimension. */
  coverage: number;
}

export type DimensionScores = Record<Dimension, DimensionScore>;

/** Score of one zone for one dimension: 1 minus its average obstacle. */
export const dimensionScoreOf = (score: ZoneScore | undefined, dimension: Dimension): number | null => {
  const barrier = score?.dimensionBarriers[dimension];
  return barrier === undefined ? null : 1 - barrier;
};

/**
 * One score per dimension over a set of zones, weighted by area, counting only the
 * zones that have data for that dimension. A dimension nobody has data for is null,
 * never 0. Independent of the profile: the profile only decides how much each
 * dimension weighs in the final score.
 */
export function dimensionScores(zones: Pick<Zone, "id" | "areaKm2">[], scores: Record<string, ZoneScore>): DimensionScores {
  const out = {} as DimensionScores;
  const totalArea = zones.reduce((sum, z) => sum + z.areaKm2, 0);
  for (const dimension of DIMENSION_KEYS) {
    let weighted = 0;
    let known = 0;
    for (const zone of zones) {
      const value = dimensionScoreOf(scores[zone.id], dimension);
      if (value === null) continue;
      weighted += value * zone.areaKm2;
      known += zone.areaKm2;
    }
    out[dimension] = { score: known > 0 ? weighted / known : null, coverage: totalArea > 0 ? known / totalArea : 0 };
  }
  return out;
}
