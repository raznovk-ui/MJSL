import type { Dimension } from "../dimensions.js";

export type LngLat = [number, number];

/**
 * Where a value came from. Measured (by you) always wins. "official" is open
 * government data (noise map, altitude); "estimated" is a rule of thumb.
 */
export type ValueSource = "measured" | "osm" | "official" | "estimated";

export type IndicatorKey = "width" | "noise" | "slope" | "surface" | "rest" | "economic"
  | "lighting" | "landmarks" | "activities" | "civic" | "publicPrivate";

/**
 * Raw facts about one walkway segment. Anything left undefined is "no data":
 * it is never treated as zero.
 */
export interface SegmentValues {
  widthM?: number;
  noiseDb?: number;
  /** Slope in percent; the sign is ignored. */
  inclinePct?: number;
  surface?: string;
  restDistanceM?: number;
  /** Share of the segment next to terraces or parking, 0..1. */
  privatizedShare?: number;
  /** Share of the segment with no street lighting nearby, 0..1. */
  unlitShare?: number;
  /** Share of private places (terraces, cafes) among free public and private places nearby, 0..1. */
  privateShare?: number;
  /** Shops, services and stops within reach: reference points for finding one's way. */
  landmarkCount?: number;
  /** Distance to the nearest place for activities (cafe, park, library, market...). */
  activityDistanceM?: number;
  /** Distance to the nearest place of local decision-making or civic life (town hall, community centre...). */
  civicDistanceM?: number;
  hasSteps?: boolean;
  hasRamp?: boolean;
  kerbRaised?: boolean;
}

export interface Segment {
  id: string;
  name?: string;
  /** Graph ends. Segments sharing a node id are connected. */
  from?: string;
  to?: string;
  lengthM?: number;
  geometry?: LngLat[];
  values: SegmentValues;
  /** Provenance per indicator; anything not listed counts as "measured". */
  sources?: Partial<Record<IndicatorKey, ValueSource>>;
}

export interface BarrierResult {
  indicator: IndicatorKey;
  dimension: Dimension;
  /** 0 (no problem) .. 1 (total obstacle); null = no data. */
  barrier: number | null;
  source: ValueSource | null;
}

export type ScoreClass = "red" | "orange" | "green" | "none";

export interface SegmentScore {
  segmentId: string;
  profileId: string;
  /** null = not enough data to score. 0 = vetoed (or fully blocked). */
  score: number | null;
  vetoed: boolean;
  vetoReasons: string[];
  barriers: BarrierResult[];
  /** Average barrier per dimension, over the indicators that have data. */
  dimensionBarriers: Partial<Record<Dimension, number>>;
  /** Dimensions the profile cares about but that have no data at all. */
  dimensionsMissing: Dimension[];
  cls: ScoreClass;
}

export interface RouteResult {
  profileId: string;
  /** false when the two points are not connected at all. */
  connected: boolean;
  /** true when the direct path has no vetoed segment. */
  possible: boolean;
  /** Weakest-link score of the path (0 if blocked); null if no data. */
  score: number | null;
  weakestSegmentId: string | null;
  path: { segmentIds: string[]; lengthM: number };
  /** Set only when the direct path is blocked and another path exists. */
  detour: null | {
    segmentIds: string[];
    lengthM: number;
    extraLengthM: number;
    score: number | null;
    weakestSegmentId: string | null;
  };
  /** Segments on the path with no score (so they could hide a weak link). */
  unscoredSegmentIds: string[];
}
