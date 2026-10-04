import { distanceM } from "./geo.js";
import type { WalkwayConfig } from "./loadConfig.js";
import { scoreSegment } from "./score.js";
import type { LngLat, RouteResult, Segment, SegmentScore } from "./types.js";

interface Edge {
  segment: Segment;
  to: string;
  cost: number;
}

function buildAdjacency(segments: Segment[], allow: (s: Segment) => boolean): Map<string, Edge[]> {
  const adjacency = new Map<string, Edge[]>();
  const push = (node: string, edge: Edge) => {
    const list = adjacency.get(node);
    if (list) list.push(edge);
    else adjacency.set(node, [edge]);
  };
  for (const segment of segments) {
    if (!segment.from || !segment.to || !allow(segment)) continue;
    const cost = segment.lengthM ?? 1;
    push(segment.from, { segment, to: segment.to, cost });
    push(segment.to, { segment, to: segment.from, cost });
  }
  return adjacency;
}

/** Shortest path by length (Dijkstra, binary heap). Null when not connected. */
export function shortestPath(
  segments: Segment[],
  fromNode: string,
  toNode: string,
  allow: (s: Segment) => boolean = () => true,
): { segmentIds: string[]; lengthM: number } | null {
  if (fromNode === toNode) return { segmentIds: [], lengthM: 0 };
  const adjacency = buildAdjacency(segments, allow);
  const dist = new Map<string, number>([[fromNode, 0]]);
  const previous = new Map<string, { node: string; segmentId: string }>();
  const heap: [number, string][] = [[0, fromNode]];

  const pop = (): [number, string] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  const push = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };

  while (heap.length > 0) {
    const [d, node] = pop();
    if (d > (dist.get(node) ?? Infinity)) continue;
    if (node === toNode) break;
    for (const edge of adjacency.get(node) ?? []) {
      const nd = d + edge.cost;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        previous.set(edge.to, { node, segmentId: edge.segment.id });
        push([nd, edge.to]);
      }
    }
  }

  if (!dist.has(toNode)) return null;
  const segmentIds: string[] = [];
  for (let node = toNode; node !== fromNode; ) {
    const step = previous.get(node)!;
    segmentIds.unshift(step.segmentId);
    node = step.node;
  }
  return { segmentIds, lengthM: dist.get(toNode)! };
}

/** Weakest link along a list of segments: lowest score, and which segment it is. */
function weakestLink(segmentIds: string[], scores: Map<string, SegmentScore>) {
  let score: number | null = null;
  let weakest: string | null = null;
  const unscored: string[] = [];
  for (const id of segmentIds) {
    const s = scores.get(id)?.score ?? null;
    if (s === null) {
      unscored.push(id);
      continue;
    }
    if (score === null || s < score) {
      score = s;
      weakest = id;
    }
  }
  return { score, weakestSegmentId: weakest, unscored };
}

/**
 * Route result for one profile.
 *
 * The direct path is the shortest one over every segment. Its score is the
 * weakest segment on it. If it crosses a vetoed segment it is blocked
 * (score 0), the vetoed segments are removed from the graph, and the shortest
 * remaining path is reported as the detour with its extra length. If no such
 * path exists, no detour is returned: the trip is impossible for this profile.
 */
export function findRoute(
  segments: Segment[],
  fromNode: string,
  toNode: string,
  profileId: string,
  config: WalkwayConfig,
): RouteResult {
  const scores = new Map(segments.map((s) => [s.id, scoreSegment(s, profileId, config)]));
  const byId = new Map(segments.map((s) => [s.id, s]));
  const empty = { segmentIds: [] as string[], lengthM: 0 };

  const direct = shortestPath(segments, fromNode, toNode);
  if (!direct) {
    return {
      profileId, connected: false, possible: false, score: null, weakestSegmentId: null,
      path: empty, detour: null, unscoredSegmentIds: [],
    };
  }

  const blocked = direct.segmentIds.filter((id) => scores.get(id)?.vetoed);
  const directLink = weakestLink(direct.segmentIds, scores);

  if (blocked.length === 0) {
    return {
      profileId, connected: true, possible: true, score: directLink.score,
      weakestSegmentId: directLink.weakestSegmentId, path: direct, detour: null,
      unscoredSegmentIds: directLink.unscored,
    };
  }

  const detourPath = shortestPath(segments, fromNode, toNode, (s) => !scores.get(s.id)?.vetoed);
  const detourLink = detourPath ? weakestLink(detourPath.segmentIds, scores) : null;

  return {
    profileId, connected: true, possible: false,
    // Blocked: the direct path scores 0 and the veto itself is the weak link.
    score: 0, weakestSegmentId: byId.get(blocked[0]!)?.id ?? blocked[0]!,
    path: direct,
    detour: detourPath && detourLink
      ? {
          segmentIds: detourPath.segmentIds,
          lengthM: detourPath.lengthM,
          extraLengthM: detourPath.lengthM - direct.lengthM,
          score: detourLink.score,
          weakestSegmentId: detourLink.weakestSegmentId,
        }
      : null,
    unscoredSegmentIds: directLink.unscored,
  };
}

/** Graph node closest to a clicked point (uses each segment's end coordinates). */
export function nearestGraphNode(segments: Segment[], point: LngLat): { node: string; coord: LngLat; distanceM: number } | null {
  let best: { node: string; coord: LngLat; distanceM: number } | null = null;
  const consider = (node: string | undefined, coord: LngLat | undefined) => {
    if (!node || !coord) return;
    const d = distanceM(point, coord);
    if (!best || d < best.distanceM) best = { node, coord, distanceM: d };
  };
  for (const s of segments) {
    const g = s.geometry;
    if (!g || g.length === 0) continue;
    consider(s.from, g[0]);
    consider(s.to, g[g.length - 1]);
  }
  return best;
}
