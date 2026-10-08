import type { MultiPolygon, Polygon } from "geojson";
import type { Dimension } from "../dimensions.js";

export type LngLat = [number, number];

/**
 * Where a value came from. "official" is open government data (noise map, altitude,
 * statistics, transport), "osm" is OpenStreetMap, "reported" is the citizens'
 * reports ("Galere pietons"). Nothing is typed in by hand.
 */
export type ValueSource = "osm" | "official" | "reported";

/** Which kind of obstacle a citizen report describes (see `reports` in the config). */
export type ReportKind = "parking" | "narrow" | "works" | "furniture" | "other";

/** One citizen report: a point and the type the citizen chose. */
export interface Report {
  lon: number;
  lat: number;
  type: string;
}

/**
 * The unit of the whole scoring: an area of the city (an IRIS), with the indicators
 * worked out for it from every dataset. `values` holds one number per indicator
 * (anything left out is "no data", never 0); `sources` says where each came from.
 */
export interface Zone {
  id: string;
  name: string;
  /** Arrondissement, as written by the statistics office, e.g. "Marseille 6e Arrondissement". */
  arrondissement: string;
  geometry: Polygon | MultiPolygon;
  areaKm2: number;
  centroid: LngLat;
  /** Length of the street network in the zone, in kilometres (trails excluded). */
  streetKm: number;
  households: number;
  values: Record<string, number>;
  sources: Record<string, ValueSource>;
  /** Raw counts behind the values (reports by kind, benches, crossings...), for display. */
  counts: Record<string, number>;
}

export interface BarrierResult {
  indicator: string;
  dimension: Dimension;
  /** 0 (no problem) .. 1 (total obstacle); null = no data. */
  barrier: number | null;
  source: ValueSource | null;
}

export type ScoreClass = "red" | "orange" | "green" | "none";

export interface ZoneScore {
  zoneId: string;
  profileId: string;
  /** null = no dimension has any data. */
  score: number | null;
  barriers: BarrierResult[];
  /** Average barrier per dimension, over the indicators that have data. */
  dimensionBarriers: Partial<Record<Dimension, number>>;
  /** Dimensions the profile weights but that have no data at all. */
  dimensionsMissing: Dimension[];
  cls: ScoreClass;
}
