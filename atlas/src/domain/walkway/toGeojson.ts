import type { Feature, FeatureCollection } from "geojson";
import type { WalkwayConfig } from "./loadConfig.js";
import { scoreAllProfiles } from "./score.js";
import type { Segment } from "./types.js";

/**
 * Segments as GeoJSON with their scores, for QGIS or the project export.
 * Each profile gets score_/class_/veto_ fields; every indicator gets its
 * barrier and where the value came from, so no score is shown without its basis.
 */
export function segmentsToGeojson(segments: Segment[], config: WalkwayConfig): FeatureCollection {
  const features: Feature[] = segments
    .filter((s) => s.geometry && s.geometry.length >= 2)
    .map((segment) => {
      const scores = scoreAllProfiles(segment, config);
      const properties: Record<string, unknown> = {
        id: segment.id,
        name: segment.name ?? "",
        length_m: segment.lengthM === undefined ? null : Math.round(segment.lengthM),
      };
      for (const [profileId, s] of Object.entries(scores)) {
        properties[`score_${profileId}`] = s.score === null ? null : Number(s.score.toFixed(3));
        properties[`class_${profileId}`] = s.cls;
        properties[`veto_${profileId}`] = s.vetoReasons.join("; ");
      }
      const first = Object.values(scores)[0];
      for (const b of first?.barriers ?? []) {
        properties[`barrier_${b.indicator}`] = b.barrier === null ? null : Number(b.barrier.toFixed(3));
        properties[`source_${b.indicator}`] = b.source ?? "no data";
      }
      return {
        type: "Feature" as const,
        id: segment.id,
        properties,
        geometry: { type: "LineString" as const, coordinates: segment.geometry! },
      };
    });
  return { type: "FeatureCollection", features };
}
