import type { Dimension } from "../dimensions.js";
import type { ZoneConfig } from "./loadConfig.js";
import type { BarrierResult, ScoreClass, Zone, ZoneScore } from "./types.js";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const isNum = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Straight-line barrier: 0 at `noProblemAt`, 1 at `totalObstacleAt`, clamped. Works in both directions. */
export function linearBarrier(value: number, noProblemAt: number, totalObstacleAt: number): number {
  return clamp01((value - noProblemAt) / (totalObstacleAt - noProblemAt));
}

/**
 * One barrier per configured indicator. A missing value gives `barrier: null` ("no
 * data"), which every later step leaves out. It is never turned into 0.
 */
export function computeBarriers(zone: Pick<Zone, "values" | "sources">, config: ZoneConfig): BarrierResult[] {
  return Object.entries(config.indicators).map(([indicator, c]) => {
    const value = zone.values[indicator];
    let barrier: number | null = null;
    if (isNum(value)) {
      barrier = c.kind === "share" ? clamp01(value) : linearBarrier(value, c.noProblemAt!, c.totalObstacleAt!);
    }
    return { indicator, dimension: c.dimension, barrier, source: barrier === null ? null : (zone.sources[indicator] ?? null) };
  });
}

/** Average barrier per dimension, over the indicators that have data. A dimension with none is absent. */
export function dimensionBarriers(barriers: BarrierResult[]): Partial<Record<Dimension, number>> {
  const sums = new Map<Dimension, { sum: number; n: number }>();
  for (const b of barriers) {
    if (b.barrier === null) continue;
    const s = sums.get(b.dimension) ?? { sum: 0, n: 0 };
    s.sum += b.barrier;
    s.n += 1;
    sums.set(b.dimension, s);
  }
  return Object.fromEntries([...sums].map(([d, s]) => [d, s.sum / s.n]));
}

export function classify(score: number | null, config: ZoneConfig): ScoreClass {
  if (score === null) return "none";
  if (score < config.classes.redBelow) return "red";
  if (score < config.classes.orangeBelow) return "orange";
  return "green";
}

/**
 * The score of a zone for a profile: the product over dimensions of (1 - barrier) raised
 * to the dimension's weight, with weights rescaled over the dimensions that have data.
 * Barriers compound, as the memoire says ("ne s'additionnent pas : elles composent un
 * systeme"): one very bad dimension drags the whole score down, and a missing one is
 * left out, never counted as 0.
 */
export function scoreZone(zone: Pick<Zone, "id" | "values" | "sources">, profileId: string, config: ZoneConfig): ZoneScore {
  const profile = config.profiles[profileId];
  if (!profile) throw new Error(`Unknown profile "${profileId}". Known: ${Object.keys(config.profiles).join(", ")}`);

  const barriers = computeBarriers(zone, config);
  const perDimension = dimensionBarriers(barriers);
  const weighted = (Object.entries(profile.weights) as [Dimension, number][]).filter(([, w]) => w > 0);
  const available = weighted.filter(([d]) => perDimension[d] !== undefined);
  const missing = weighted.filter(([d]) => perDimension[d] === undefined).map(([d]) => d);

  let score: number | null = null;
  if (available.length > 0) {
    const weightSum = available.reduce((sum, [, w]) => sum + w, 0);
    const cap = config.scoring.dimensionBarrierCap;
    score = available.reduce((product, [d, w]) => product * Math.pow(1 - Math.min(perDimension[d]!, cap), w / weightSum), 1);
  }
  return { zoneId: zone.id, profileId, score, barriers, dimensionBarriers: perDimension, dimensionsMissing: missing, cls: classify(score, config) };
}

export function scoreAllProfiles(zone: Pick<Zone, "id" | "values" | "sources">, config: ZoneConfig): Record<string, ZoneScore> {
  return Object.fromEntries(Object.keys(config.profiles).map((id) => [id, scoreZone(zone, id, config)]));
}
