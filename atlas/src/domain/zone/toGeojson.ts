import type { Feature, FeatureCollection } from "geojson";
import type { ZoneConfig } from "./loadConfig.js";
import { dimensionScoreOf, SCORED_DIMENSIONS } from "./dimensionScores.js";
import { scoreAllProfiles } from "./score.js";
import type { Zone } from "./types.js";

/** The zones as GeoJSON for export (QGIS): every indicator, and the score of every profile and dimension. */
export function zonesToGeojson(zones: Zone[], config: ZoneConfig): FeatureCollection {
  const features: Feature[] = zones.map((zone) => {
    const scores = scoreAllProfiles(zone, config);
    const properties: Record<string, unknown> = {
      id: zone.id,
      name: zone.name,
      arrondissement: zone.arrondissement,
      area_km2: Number(zone.areaKm2.toFixed(3)),
      street_km: Number(zone.streetKm.toFixed(2)),
    };
    for (const [profileId, s] of Object.entries(scores)) {
      properties[`score_${profileId}`] = s.score === null ? null : Number(s.score.toFixed(3));
      properties[`class_${profileId}`] = s.cls;
    }
    const first = Object.values(scores)[0];
    for (const d of SCORED_DIMENSIONS) {
      const v = dimensionScoreOf(first, d);
      properties[`dim_${d}`] = v === null ? null : Number(v.toFixed(3));
    }
    for (const [key, value] of Object.entries(zone.values)) {
      properties[`v_${key}`] = Number(value.toFixed(3));
      properties[`src_${key}`] = zone.sources[key];
    }
    for (const [key, value] of Object.entries(zone.counts)) properties[`n_${key}`] = value;
    return { type: "Feature", id: zone.id, properties, geometry: zone.geometry };
  });
  return { type: "FeatureCollection", features };
}
