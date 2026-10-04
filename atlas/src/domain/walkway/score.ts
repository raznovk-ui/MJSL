import type { Dimension } from "../dimensions.js";
import { computeBarriers } from "./indicators.js";
import type { ProfileConfig, WalkwayConfig } from "./loadConfig.js";
import type { BarrierResult, ScoreClass, Segment, SegmentScore } from "./types.js";

/** Average barrier per dimension, over the indicators that have data only. */
export function dimensionBarriers(barriers: BarrierResult[]): Partial<Record<Dimension, number>> {
  const sums = new Map<Dimension, { total: number; n: number }>();
  for (const b of barriers) {
    if (b.barrier === null) continue;
    const entry = sums.get(b.dimension) ?? { total: 0, n: 0 };
    entry.total += b.barrier;
    entry.n += 1;
    sums.set(b.dimension, entry);
  }
  const out: Partial<Record<Dimension, number>> = {};
  for (const [dimension, { total, n }] of sums) out[dimension] = total / n;
  return out;
}

/**
 * Veto rules fire only on facts that are present. A missing tag never vetoes
 * (that would invent a problem), but a steps segment with no ramp does.
 */
export function vetoReasons(segment: Segment, profile: ProfileConfig): string[] {
  const reasons: string[] = [];
  const { values } = segment;
  const { vetoes } = profile;
  if (vetoes.stepsWithoutRamp && values.hasSteps === true && values.hasRamp !== true) {
    reasons.push("steps without a ramp");
  }
  // An estimated width is a guess for a whole kind of path, not a fact about this
  // segment, so it can lower a score but never veto one.
  if (
    typeof vetoes.widthBelowM === "number" &&
    typeof values.widthM === "number" &&
    segment.sources?.width !== "estimated" &&
    values.widthM < vetoes.widthBelowM
  ) {
    reasons.push(`width ${values.widthM} m is below ${vetoes.widthBelowM} m`);
  }
  if (vetoes.kerbRaised && values.kerbRaised === true) reasons.push("raised kerb");
  return reasons;
}

export function classify(score: number | null, config: WalkwayConfig): ScoreClass {
  if (score === null) return "none";
  if (score < config.classes.redBelow) return "red";
  if (score < config.classes.orangeBelow) return "orange";
  return "green";
}

/**
 * Final score for one segment and one profile.
 *
 *   0 if any veto applies, otherwise the PRODUCT over dimensions of
 *   (1 - barrier) ^ weight. Obstacles multiply: a good dimension cannot hide
 *   a bad one, which a weighted sum would let it do.
 *
 * Weights are rescaled over the dimensions that have data, so a missing
 * dimension is left out instead of silently counting as "no barrier". If none
 * of the profile's dimensions has data, the score is null ("no data"), not 1.
 */
export function scoreSegment(segment: Segment, profileId: string, config: WalkwayConfig): SegmentScore {
  const profile = config.profiles[profileId];
  if (!profile) throw new Error(`Unknown profile "${profileId}". Known: ${Object.keys(config.profiles).join(", ")}`);

  const barriers = computeBarriers(segment, config);
  const perDimension = dimensionBarriers(barriers);
  const reasons = vetoReasons(segment, profile);

  const weighted = (Object.entries(profile.weights) as [Dimension, number][]).filter(([, w]) => w > 0);
  const available = weighted.filter(([d]) => perDimension[d] !== undefined);
  const missing = weighted.filter(([d]) => perDimension[d] === undefined).map(([d]) => d);

  let score: number | null;
  if (reasons.length > 0) {
    score = 0;
  } else if (available.length === 0) {
    score = null;
  } else {
    const weightSum = available.reduce((sum, [, w]) => sum + w, 0);
    score = available.reduce((product, [d, w]) => product * Math.pow(1 - perDimension[d]!, w / weightSum), 1);
  }

  return {
    segmentId: segment.id,
    profileId,
    score,
    vetoed: reasons.length > 0,
    vetoReasons: reasons,
    barriers,
    dimensionBarriers: perDimension,
    dimensionsMissing: missing,
    cls: classify(score, config),
  };
}

export function scoreAllProfiles(segment: Segment, config: WalkwayConfig): Record<string, SegmentScore> {
  return Object.fromEntries(Object.keys(config.profiles).map((id) => [id, scoreSegment(segment, id, config)]));
}
