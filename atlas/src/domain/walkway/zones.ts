import { distanceM } from "./geo.js";
import type { WalkwayConfig } from "./loadConfig.js";
import type { IndicatorKey, LngLat, Segment, SegmentScore, ValueSource } from "./types.js";

export interface ZoneDriver {
  indicator: IndicatorKey;
  /** Length-weighted mean barrier (0..1) over the zone's segments that have data. */
  meanBarrier: number;
}

/** Share (0..1) of the zone's indicator values coming from each source, by length. */
export type ZoneBasis = Record<ValueSource, number>;

export interface Zone {
  id: string;
  profileId: string;
  /** 1 = most severe. */
  rank: number;
  segmentIds: string[];
  segmentCount: number;
  lengthM: number;
  /** Length-weighted mean score of the zone's segments. */
  meanScore: number;
  /** sum of length x (1 - score): long and bad ranks above short and bad. */
  severity: number;
  vetoedSegments: number;
  vetoReasons: string[];
  drivers: ZoneDriver[];
  basis: ZoneBasis;
  bbox: [number, number, number, number];
  lines: LngLat[][];
  summary: string;
}

const INDICATOR_LABEL: Record<IndicatorKey, string> = {
  width: "largeur",
  noise: "bruit",
  slope: "pente",
  surface: "revetement",
  rest: "absence de banc",
  economic: "privatisation (terrasses, parkings)",
};

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Ends of a segment, as [point, owner index], for proximity matching. */
function endpoints(candidates: Segment[]): { p: LngLat; owner: number }[] {
  const out: { p: LngLat; owner: number }[] = [];
  candidates.forEach((segment, owner) => {
    const g = segment.geometry;
    if (!g || g.length < 2) return;
    out.push({ p: g[0]!, owner }, { p: g[g.length - 1]!, owner });
  });
  return out;
}

/**
 * Priority zones for one profile, drawn with no one marking anything:
 * candidate segments (low score or vetoed) are joined when they share a junction or
 * their ends lie within `mergeGapM`, tiny clusters are dropped unless they hold a
 * hard block, and what remains is ranked by severity.
 *
 * Each zone says what drives it and how much of it rests on estimated values, so a
 * zone is never shown without its basis.
 */
export function detectZones(
  segments: Segment[],
  scores: Record<string, SegmentScore>,
  profileId: string,
  config: WalkwayConfig,
): Zone[] {
  const { scoreBelow, mergeGapM, minLengthM } = config.zones;
  const candidates = segments.filter((segment) => {
    const s = scores[segment.id];
    return !!s && s.score !== null && (s.vetoed || s.score < scoreBelow) && !!segment.geometry && segment.geometry.length >= 2;
  });
  if (candidates.length === 0) return [];

  const uf = new UnionFind(candidates.length);

  // 1. Shared junctions.
  const byNode = new Map<string, number>();
  candidates.forEach((segment, i) => {
    for (const node of [segment.from, segment.to]) {
      if (!node) continue;
      const seen = byNode.get(node);
      if (seen === undefined) byNode.set(node, i);
      else uf.union(seen, i);
    }
  });

  // 2. Ends that are close without sharing a node (a short gap in the data or the
  // street). A grid of mergeGapM-sized cells keeps this fast on thousands of segments.
  if (mergeGapM > 0) {
    const kx = 111_320 * Math.cos((43.28 * Math.PI) / 180);
    const ky = 110_540;
    const cell = (p: LngLat) => [Math.floor((p[0] * kx) / mergeGapM), Math.floor((p[1] * ky) / mergeGapM)] as const;
    const grid = new Map<string, { p: LngLat; owner: number }[]>();
    const ends = endpoints(candidates);
    for (const end of ends) {
      const [cx, cy] = cell(end.p);
      const key = `${cx},${cy}`;
      const list = grid.get(key);
      if (list) list.push(end);
      else grid.set(key, [end]);
    }
    for (const end of ends) {
      const [cx, cy] = cell(end.p);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other.owner !== end.owner && distanceM(end.p, other.p) <= mergeGapM) uf.union(end.owner, other.owner);
          }
        }
      }
    }
  }

  const groups = new Map<number, Segment[]>();
  candidates.forEach((segment, i) => {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(segment);
    else groups.set(root, [segment]);
  });

  const zones: Omit<Zone, "id" | "rank">[] = [];
  for (const members of groups.values()) {
    let lengthM = 0;
    let weightedScore = 0;
    let severity = 0;
    const vetoReasons = new Set<string>();
    let vetoed = 0;
    const barrierTotals = new Map<IndicatorKey, { sum: number; length: number }>();
    const basis: ZoneBasis = { measured: 0, osm: 0, official: 0, estimated: 0 };
    let basisTotal = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const segment of members) {
      const score = scores[segment.id]!;
      const length = segment.lengthM ?? 0;
      lengthM += length;
      weightedScore += length * score.score!;
      severity += length * (1 - score.score!);
      if (score.vetoed) {
        vetoed += 1;
        score.vetoReasons.forEach((reason) => vetoReasons.add(reason));
      }
      for (const b of score.barriers) {
        if (b.barrier === null || b.source === null) continue;
        const totals = barrierTotals.get(b.indicator) ?? { sum: 0, length: 0 };
        totals.sum += length * b.barrier;
        totals.length += length;
        barrierTotals.set(b.indicator, totals);
        basis[b.source] += length;
        basisTotal += length;
      }
      for (const [x, y] of segment.geometry!) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (lengthM < minLengthM && vetoed === 0) continue;

    const meanScore = lengthM > 0
      ? weightedScore / lengthM
      : members.reduce((sum, s) => sum + scores[s.id]!.score!, 0) / members.length;
    const drivers = [...barrierTotals.entries()]
      .filter(([, t]) => t.length > 0)
      .map(([indicator, t]) => ({ indicator, meanBarrier: t.sum / t.length }))
      .filter((d) => d.meanBarrier > 0)
      .sort((a, b) => b.meanBarrier - a.meanBarrier)
      .slice(0, 3);
    const shares: ZoneBasis = basisTotal > 0
      ? { measured: basis.measured / basisTotal, osm: basis.osm / basisTotal, official: basis.official / basisTotal, estimated: basis.estimated / basisTotal }
      : basis;

    zones.push({
      profileId,
      segmentIds: members.map((s) => s.id),
      segmentCount: members.length,
      lengthM,
      meanScore,
      severity,
      vetoedSegments: vetoed,
      vetoReasons: [...vetoReasons].slice(0, 3),
      drivers,
      basis: shares,
      bbox: [minX, minY, maxX, maxY],
      lines: members.map((s) => s.geometry!),
      summary: summarise(members.length, lengthM, meanScore, drivers, vetoed, [...vetoReasons], shares),
    });
  }

  return zones
    .sort((a, b) => b.severity - a.severity)
    .map((zone, index) => ({ ...zone, rank: index + 1, id: `${profileId}_zone_${index + 1}` }));
}

function summarise(
  count: number,
  lengthM: number,
  meanScore: number,
  drivers: ZoneDriver[],
  vetoed: number,
  reasons: string[],
  basis: ZoneBasis,
): string {
  const parts = [`${count} troncon(s), ${Math.round(lengthM)} m, score moyen ${meanScore.toFixed(2)}.`];
  if (vetoed > 0) parts.push(`${vetoed} blocage(s) eliminatoire(s) : ${reasons.slice(0, 2).join(" ; ")}.`);
  const top = drivers[0];
  if (top) parts.push(`Cause principale : ${INDICATOR_LABEL[top.indicator]} (obstacle moyen ${top.meanBarrier.toFixed(2)}).`);
  if (basis.estimated > 0.5) {
    parts.push(`${Math.round(basis.estimated * 100)} % des valeurs sont estimees : a confirmer sur le terrain.`);
  }
  return parts.join(" ");
}
