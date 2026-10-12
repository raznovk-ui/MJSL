import type { FeatureCollection } from "geojson";
import { PolygonIndex } from "./spatial.js";
import type { LngLat } from "./types.js";

/**
 * Open data of the Aix-Marseille-Provence Metropole portal (see scripts/fetchAmp.mjs):
 * what OpenStreetMap does not hold. Every part is optional: without it the indicators
 * that need it simply stay "no data".
 */
export interface AmpData {
  /** Public transport stops and stations, with their mode. */
  transit?: { lon: number; lat: number; mode: "bus" | "tram" | "metro" }[];
  /** Tourist offices (information centres). */
  tourism?: { lon: number; lat: number }[];
  /** Priority neighbourhoods (QPV). */
  qpv?: FeatureCollection;
  /** Perimeters of urban projects (ZAC, projet urbain partenarial, NPRU). */
  projects?: FeatureCollection;
}

export interface AmpIndex {
  transit: { p: LngLat; mode: string }[];
  tourism: LngLat[];
  /** Priority neighbourhoods and urban-project perimeters: places with a formal co-participation device. */
  participation: PolygonIndex;
}

export function buildAmpIndex(data: AmpData): AmpIndex {
  return {
    transit: (data.transit ?? []).map((s) => ({ p: [s.lon, s.lat] as LngLat, mode: s.mode })),
    tourism: (data.tourism ?? []).map((t) => [t.lon, t.lat] as LngLat),
    participation: new PolygonIndex({
      type: "FeatureCollection",
      features: [...(data.qpv?.features ?? []), ...(data.projects?.features ?? [])],
    }),
  };
}
