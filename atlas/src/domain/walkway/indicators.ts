import type { WalkwayConfig } from "./loadConfig.js";
import type { BarrierResult, IndicatorKey, Segment, ValueSource } from "./types.js";

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Straight-line barrier: 0 at `noProblemAt`, 1 at `totalObstacleAt`, clamped.
 * Works in both directions, so width ((1.80 - w) / 0.90) and noise
 * ((dB - 55) / 30) share one formula.
 */
export function linearBarrier(value: number, noProblemAt: number, totalObstacleAt: number): number {
  return clamp01((value - noProblemAt) / (totalObstacleAt - noProblemAt));
}

const isNum = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * One barrier per indicator. A missing value gives `barrier: null` ("no data"),
 * which every later step leaves out. It is never turned into 0.
 */
export function computeBarriers(segment: Segment, config: WalkwayConfig): BarrierResult[] {
  const { values, sources } = segment;
  const { indicators } = config;
  const source = (key: IndicatorKey): ValueSource => sources?.[key] ?? "measured";

  const result = (
    indicator: IndicatorKey,
    dimension: BarrierResult["dimension"],
    barrier: number | null,
  ): BarrierResult => ({ indicator, dimension, barrier, source: barrier === null ? null : source(indicator === "coPresence" ? "width" : indicator) });

  const surfaceKey = values.surface?.trim().toLowerCase();
  const surfaceScore = surfaceKey === undefined ? undefined : indicators.surface.scores[surfaceKey];

  return [
    result("width", indicators.width.dimension, isNum(values.widthM)
      ? linearBarrier(values.widthM, indicators.width.noProblemAt, indicators.width.totalObstacleAt)
      : null),
    result("noise", indicators.noise.dimension, isNum(values.noiseDb)
      ? linearBarrier(values.noiseDb, indicators.noise.noProblemAt, indicators.noise.totalObstacleAt)
      : null),
    result("slope", indicators.slope.dimension, isNum(values.inclinePct)
      ? linearBarrier(Math.abs(values.inclinePct), indicators.slope.noProblemAt, indicators.slope.totalObstacleAt)
      : null),
    result("surface", indicators.surface.dimension, isNum(surfaceScore) ? clamp01(surfaceScore) : null),
    result("rest", indicators.rest.dimension, isNum(values.restDistanceM)
      ? linearBarrier(values.restDistanceM, indicators.rest.noProblemAt, indicators.rest.totalObstacleAt)
      : null),
    result("economic", indicators.economic.dimension, isNum(values.privatizedShare)
      ? clamp01(values.privatizedShare)
      : null),
    result("thresholds", indicators.thresholds.dimension, isNum(values.thresholdSteps)
      ? linearBarrier(values.thresholdSteps, indicators.thresholds.noProblemAt, indicators.thresholds.totalObstacleAt)
      : null),
    result("surveillance", indicators.surveillance.dimension, isNum(values.controlDevices)
      ? linearBarrier(values.controlDevices, indicators.surveillance.noProblemAt, indicators.surveillance.totalObstacleAt)
      : null),
    // Co-presence reads the width, but never the estimated default: a guess about
    // how wide pavements usually are cannot say whether two people fit side by side.
    result("coPresence", indicators.coPresence.dimension, isNum(values.widthM) && sources?.width !== "estimated"
      ? linearBarrier(values.widthM, indicators.coPresence.noProblemAt, indicators.coPresence.totalObstacleAt)
      : null),
    result("shelter", indicators.shelter.dimension, isNum(values.shelterCount)
      ? linearBarrier(values.shelterCount, indicators.shelter.noProblemAt, indicators.shelter.totalObstacleAt)
      : null),
    result("publicPrivate", indicators.publicPrivate.dimension, isNum(values.privateShare) ? clamp01(values.privateShare) : null),
    result("lighting", indicators.lighting.dimension, isNum(values.unlitShare) ? clamp01(values.unlitShare) : null),
    result("landmarks", indicators.landmarks.dimension, isNum(values.landmarkCount)
      ? linearBarrier(values.landmarkCount, indicators.landmarks.noProblemAt, indicators.landmarks.totalObstacleAt)
      : null),
    result("activities", indicators.activities.dimension, isNum(values.activityDistanceM)
      ? linearBarrier(values.activityDistanceM, indicators.activities.noProblemAt, indicators.activities.totalObstacleAt)
      : null),
    result("civic", indicators.civic.dimension, isNum(values.civicDistanceM)
      ? linearBarrier(values.civicDistanceM, indicators.civic.noProblemAt, indicators.civic.totalObstacleAt)
      : null),
  ];
}

/**
 * Noise estimate from the nearest major road, used only when nothing better is
 * known. Level at the reference distance = road base level + speed correction;
 * it then drops by `dbDropPerDoubling` for every doubling of distance, never
 * below the floor.
 */
export function estimateNoiseDb(
  roadClass: string,
  speedKmh: number | undefined,
  distanceToRoadM: number,
  config: WalkwayConfig,
): number | undefined {
  const n = config.noiseEstimate;
  const base = n.roadBaseDb[roadClass];
  if (!isNum(base)) return undefined;
  const speed = isNum(speedKmh) ? speedKmh : n.defaultSpeedKmh;
  const atReference = base + ((speed - n.referenceSpeedKmh) / 10) * n.dbPer10KmhAboveReference;
  const doublings = Math.log2(Math.max(distanceToRoadM, n.referenceDistanceM) / n.referenceDistanceM);
  return Math.max(n.floorDb, atReference - n.dbDropPerDoubling * doublings);
}
