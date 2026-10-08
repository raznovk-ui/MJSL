import type { Dimension } from "../dimensions.js";
import type { ZoneConfig } from "./loadConfig.js";
import type { Zone, ZoneScore } from "./types.js";

export interface RankedZone {
  zone: Zone;
  /** 1 = the worst zone for the profile. */
  rank: number;
  score: number;
  /** The indicators that weigh most on the score, worst barrier first. */
  drivers: { indicator: string; label: string; barrier: number }[];
  /** Share of the zone's values that come from each source (by number of indicators). */
  basis: Record<string, number>;
  summary: string;
}

/**
 * The priority zones for one profile: the zones with the lowest score, worst first,
 * each with what drives it and how much of it rests on citizens' reports. A zone with
 * no score (no data at all) is never ranked.
 */
export function rankZones(zones: Zone[], scores: Record<string, ZoneScore>, config: ZoneConfig): RankedZone[] {
  const scored = zones
    .map((zone) => ({ zone, s: scores[zone.id] }))
    .filter((x): x is { zone: Zone; s: ZoneScore & { score: number } } => x.s?.score !== null && x.s?.score !== undefined)
    .sort((a, b) => a.s.score - b.s.score || b.zone.areaKm2 - a.zone.areaKm2);

  return scored.map(({ zone, s }, index) => {
    const drivers = s.barriers
      .filter((b) => b.barrier !== null && b.barrier > 0)
      .sort((a, b) => b.barrier! - a.barrier!)
      .slice(0, 3)
      .map((b) => ({ indicator: b.indicator, label: config.indicators[b.indicator]?.label ?? b.indicator, barrier: b.barrier! }));
    const basis: Record<string, number> = {};
    const known = s.barriers.filter((b) => b.barrier !== null);
    for (const b of known) basis[b.source ?? "osm"] = (basis[b.source ?? "osm"] ?? 0) + 1 / known.length;
    const top = drivers[0];
    const parts = [`Score ${s.score.toFixed(2)} sur ${zone.streetKm.toFixed(1)} km de rue.`];
    if (top) parts.push(`Cause principale : ${top.label.toLowerCase()} (obstacle ${top.barrier.toFixed(2)}).`);
    const weakest = weakestDimension(s.dimensionBarriers);
    if (weakest) parts.push(`Dimension la plus touchee : ${weakest}.`);
    return { zone, rank: index + 1, score: s.score, drivers, basis, summary: parts.join(" ") };
  });
}

const DIM_LABEL: Record<Dimension, string> = {
  physical: "physique", sensory: "sensorielle", cognitive: "cognitive", economic: "economique", socio_cultural: "sociale", political: "politique",
};

function weakestDimension(barriers: Partial<Record<Dimension, number>>): string | undefined {
  const worst = (Object.entries(barriers) as [Dimension, number][]).sort((a, b) => b[1] - a[1])[0];
  return worst && worst[1] > 0 ? DIM_LABEL[worst[0]] : undefined;
}
