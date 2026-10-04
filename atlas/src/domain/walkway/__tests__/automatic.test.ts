import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import rawConfig from "../walkway.config.json";
import { WALKWAY_CONFIG as config, validateWalkwayConfig } from "../loadConfig.js";
import { applyElevations, endpointCoordinates } from "../elevation.js";
import { buildSegments } from "../fromOsm.js";
import { bandAt, buildNoiseIndex, segmentNoiseDb } from "../noiseMap.js";
import { scoreSegment } from "../score.js";
import { coordKey, polylineLengthM } from "../geo.js";
import type { LngLat, Segment } from "../types.js";
import { fetchAltitudes } from "../../../app/walkway/elevationClient.js";

const square = (x0: number, y0: number, x1: number, y1: number): LngLat[] => [
  [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
];
const band = (isophone: number, ...rings: LngLat[][]) => ({
  type: "Feature" as const,
  properties: { isophone },
  geometry: { type: "Polygon" as const, coordinates: rings },
});
const collection = (features: unknown[]) => ({ type: "FeatureCollection", features }) as FeatureCollection;

describe("official noise map lookup", () => {
  // A 65 dB zone with a hole in the middle, and a 75 dB zone inside the hole.
  const index = buildNoiseIndex(
    collection([
      band(55, square(0, 0, 10, 10)),
      band(65, square(2, 2, 8, 8), square(4, 4, 6, 6)),
      band(75, square(4.5, 4.5, 5.5, 5.5)),
    ]),
  );

  it("returns the highest band that contains the point", () => {
    expect(bandAt(index, [1, 1])).toBe(55);
    expect(bandAt(index, [3, 3])).toBe(65);
    expect(bandAt(index, [5, 5])).toBe(75);
  });

  it("respects holes: the hole of the 65 band falls back to the band below", () => {
    expect(bandAt(index, [4.2, 4.2])).toBe(55);
  });

  it("is null outside every band (below the map's 55 dB threshold)", () => {
    expect(bandAt(index, [50, 50])).toBeNull();
  });

  it("ignores features without a numeric band", () => {
    expect(buildNoiseIndex(collection([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [square(0, 0, 1, 1)] } }])).polygons).toHaveLength(0);
  });

  // The same bands at street scale, so segment lengths and geometry agree.
  const street = buildNoiseIndex(collection([band(65, square(5.350, 43.280, 5.351, 43.281))]));
  const lengthOf = (c: LngLat[]) => polylineLengthM(c);

  it("segment noise: the middle of the band, or the below-threshold value outside", () => {
    const inside: LngLat[] = [[5.3502, 43.2805], [5.3508, 43.2805]];
    expect(segmentNoiseDb(inside, lengthOf(inside), street, config)).toBeCloseTo(65 + config.autoData.noiseMap.bandMidpointOffsetDb, 6);
    const outside: LngLat[] = [[5.360, 43.290], [5.361, 43.290]];
    expect(segmentNoiseDb(outside, lengthOf(outside), street, config)).toBe(config.autoData.noiseMap.belowThresholdDb);
  });

  it("segment noise: averages along a segment that is half inside a band", () => {
    // Starts in the band and runs out of it.
    const coords: LngLat[] = [[5.3505, 43.2805], [5.3515, 43.2805]];
    const db = segmentNoiseDb(coords, lengthOf(coords), street, config);
    const inBand = 65 + config.autoData.noiseMap.bandMidpointOffsetDb;
    expect(db).toBeLessThan(inBand);
    expect(db).toBeGreaterThan(config.autoData.noiseMap.belowThresholdDb);
  });
});

describe("slope from altitudes", () => {
  const seg = (extra: Partial<Segment> = {}): Segment => ({
    id: "s", from: "a", to: "b", lengthM: 100,
    geometry: [[5.35, 43.28], [5.351, 43.28]], values: { widthM: 2 }, ...extra,
  });
  const alt = (z1: number, z2: number) => ({ [coordKey([5.35, 43.28])]: z1, [coordKey([5.351, 43.28])]: z2 });

  it("computes percent from the rise over the length and labels it official", () => {
    const [out] = applyElevations([seg()], alt(10, 16), config);
    expect(out!.values.inclinePct).toBeCloseTo(6, 6);
    expect(out!.sources!.slope).toBe("official");
  });

  it("a downhill segment gets a negative slope that scores like the same uphill", () => {
    const [down] = applyElevations([seg()], alt(16, 10), config);
    const [up] = applyElevations([seg()], alt(10, 16), config);
    expect(down!.values.inclinePct).toBeCloseTo(-6, 6);
    expect(scoreSegment(down!, "blind", config).score).toBe(scoreSegment(up!, "blind", config).score);
  });

  it("never replaces an OSM tag or a measured value", () => {
    const [out] = applyElevations([seg({ values: { inclinePct: 2 }, sources: { slope: "osm" } })], alt(10, 30), config);
    expect(out!.values.inclinePct).toBe(2);
    expect(out!.sources!.slope).toBe("osm");
  });

  it("leaves short segments as no data (altitude error would give a wild slope)", () => {
    const [out] = applyElevations([seg({ lengthM: config.autoData.slope.minBaselineM - 1 })], alt(10, 12), config);
    expect(out!.values.inclinePct).toBeUndefined();
  });

  it("skips steps, and ends with no altitude", () => {
    expect(applyElevations([seg({ values: { hasSteps: true } })], alt(0, 20), config)[0]!.values.inclinePct).toBeUndefined();
    expect(applyElevations([seg()], { [coordKey([5.35, 43.28])]: 10 }, config)[0]!.values.inclinePct).toBeUndefined();
  });

  it("lists each segment end once", () => {
    const a = seg({ id: "a" });
    const b = seg({ id: "b" });
    expect(endpointCoordinates([a, b])).toHaveLength(2);
  });
});

describe("filling in segments from OSM automatically", () => {
  const way = (id: string, tags: Record<string, unknown> = {}) => ({
    type: "Feature" as const,
    properties: { osm_id: id, osm_nodes: [1, 2], highway: "footway", ...tags },
    geometry: { type: "LineString" as const, coordinates: [[5.35, 43.28], [5.351, 43.28]] },
  });

  it("uses a typical width, labelled estimated, when OSM has none", () => {
    const [s] = buildSegments(collection([way("w")]), config);
    expect(s!.values.widthM).toBe(config.autoData.widthDefaults.footway);
    expect(s!.sources!.width).toBe("estimated");
  });

  it("an OSM width tag wins over the default", () => {
    const [s] = buildSegments(collection([way("w", { width: "2.4" })]), config);
    expect(s!.values.widthM).toBe(2.4);
    expect(s!.sources!.width).toBe("osm");
  });

  it("a kind of path without a default stays no data", () => {
    const cfg = validateWalkwayConfig({ ...JSON.parse(JSON.stringify(rawConfig)), autoData: { ...rawConfig.autoData, widthDefaults: {} } });
    const [s] = buildSegments(collection([way("w")]), cfg);
    expect(s!.values.widthM).toBeUndefined();
  });

  it("an estimated width lowers the score but can never trigger the width veto", () => {
    const cfg = JSON.parse(JSON.stringify(rawConfig));
    cfg.autoData.widthDefaults.footway = 0.5; // well under the 0.90 m veto
    const valid = validateWalkwayConfig(cfg);
    const [estimated] = buildSegments(collection([way("w")]), valid);
    const wheelchair = scoreSegment(estimated!, "wheelchair", valid);
    expect(wheelchair.vetoed).toBe(false);
    expect(wheelchair.vetoReasons).toEqual([]);
    // (The score itself is 0 because that width is a total obstacle in the product,
    // but the segment is not removed from routes: only a real veto does that.)
    // The same 0.5 m as a real OSM tag does veto.
    const [tagged] = buildSegments(collection([way("w", { width: "0.5" })]), valid);
    expect(scoreSegment(tagged!, "wheelchair", valid).vetoed).toBe(true);
  });

  it("official noise replaces the road estimate when the map is available", () => {
    const roads = [{
      type: "Feature" as const,
      properties: { highway: "primary", osm_id: "r" },
      geometry: { type: "LineString" as const, coordinates: [[5.349, 43.2801], [5.352, 43.2801]] },
    }];
    const index = buildNoiseIndex(collection([band(70, square(5.34, 43.27, 5.36, 43.29))]));
    const [official] = buildSegments(collection([way("w"), ...roads]), config, { noiseIndex: index });
    expect(official!.sources!.noise).toBe("official");
    expect(official!.values.noiseDb).toBeCloseTo(70 + config.autoData.noiseMap.bandMidpointOffsetDb, 6);
    const [fallback] = buildSegments(collection([way("w"), ...roads]), config);
    expect(fallback!.sources!.noise).toBe("estimated");
  });
});

describe("IGN altitude client", () => {
  const points = (n: number): LngLat[] => Array.from({ length: n }, (_, i) => [5.34 + i * 0.0001, 43.27] as LngLat);
  const fakeFetch = (calls: string[], answer: (n: number) => number[], ok = true) =>
    (async (url: string) => {
      calls.push(url);
      const n = new URL(url).searchParams.get("lon")!.split("|").length;
      return { ok, status: ok ? 200 : 500, json: async () => ({ elevations: answer(n) }) } as Response;
    }) as unknown as typeof fetch;

  it("splits the points into batches and keys altitudes by coordinate", async () => {
    const calls: string[] = [];
    const out = await fetchAltitudes(points(450), { fetchImpl: fakeFetch(calls, (n) => Array(n).fill(12.5)), batchSize: 200, delayMs: 0 });
    expect(calls).toHaveLength(3);
    expect(Object.keys(out)).toHaveLength(450);
    expect(out[coordKey([5.34, 43.27])]).toBe(12.5);
  });

  it("asks for each distinct point once", async () => {
    const calls: string[] = [];
    await fetchAltitudes([...points(10), ...points(10)], { fetchImpl: fakeFetch(calls, (n) => Array(n).fill(1)), delayMs: 0 });
    expect(new URL(calls[0]!).searchParams.get("lon")!.split("|")).toHaveLength(10);
  });

  it("drops the service's no-data marker instead of using it as an altitude", async () => {
    const out = await fetchAltitudes(points(3), { fetchImpl: fakeFetch([], () => [10, -99999, 12]), delayMs: 0 });
    expect(Object.values(out).sort()).toEqual([10, 12]);
  });

  it("reports progress", async () => {
    const seen: number[] = [];
    await fetchAltitudes(points(5), { fetchImpl: fakeFetch([], (n) => Array(n).fill(1)), batchSize: 2, delayMs: 0, onProgress: (d) => seen.push(d) });
    expect(seen).toEqual([2, 4, 5]);
  });

  it("fails loudly on an HTTP error or a malformed answer", async () => {
    await expect(fetchAltitudes(points(2), { fetchImpl: fakeFetch([], () => [], false), delayMs: 0 })).rejects.toThrow(/HTTP 500/);
    await expect(fetchAltitudes(points(3), { fetchImpl: fakeFetch([], () => [1]), delayMs: 0 })).rejects.toThrow(/unexpected/);
  });

  it("keeps what it already fetched when a later batch fails", async () => {
    const into: Record<string, number> = {};
    let n = 0;
    const flaky = (async (url: string) => {
      n += 1;
      const size = new URL(url).searchParams.get("lon")!.split("|").length;
      return n === 1
        ? ({ ok: true, status: 200, json: async () => ({ elevations: Array(size).fill(7) }) } as Response)
        : ({ ok: false, status: 429, json: async () => ({}) } as Response);
    }) as unknown as typeof fetch;
    await expect(fetchAltitudes(points(5), { fetchImpl: flaky, batchSize: 2, delayMs: 0 }, into)).rejects.toThrow(/429/);
    expect(Object.keys(into)).toHaveLength(2);
  });
});

describe("autoData config validation", () => {
  it("rejects a bad width default, noise setting or slope baseline in plain words", () => {
    const c = JSON.parse(JSON.stringify(rawConfig));
    c.autoData.widthDefaults.footway = -1;
    c.autoData.noiseMap.sampleSpacingM = 0;
    c.autoData.slope.minBaselineM = "twenty";
    let message = "";
    try { validateWalkwayConfig(c); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/widthDefaults.footway" must be a width in metres/);
    expect(message).toMatch(/sampleSpacingM" must be a number above 0/);
    expect(message).toMatch(/minBaselineM" must be a number above 0/);
  });
});

describe("official noise map gaps next to a major road", () => {
  const way = (id: string, coords: [number, number][]) => ({
    type: "Feature" as const,
    properties: { osm_id: id, osm_nodes: [1, 2], highway: "footway" },
    geometry: { type: "LineString" as const, coordinates: coords },
  });
  const road = (lat: number) => ({
    type: "Feature" as const,
    properties: { highway: "primary", osm_id: "r" },
    geometry: { type: "LineString" as const, coordinates: [[5.349, lat], [5.353, lat]] },
  });
  // The map only covers a patch far away from the test segments: a gap everywhere here.
  const farAway = buildNoiseIndex(collection([band(70, square(5.40, 43.30, 5.41, 43.31))]));
  const nearRoadWalk = way("near", [[5.3505, 43.2800], [5.3510, 43.2800]]); // ~11 m from the road
  const farFromRoadWalk = way("far", [[5.3505, 43.2900], [5.3510, 43.2900]]); // over 1 km away

  it("a gap right next to a major road uses the road estimate, labelled estimated", () => {
    const [s] = buildSegments(collection([nearRoadWalk, road(43.2801)]), config, { noiseIndex: farAway });
    expect(s!.sources!.noise).toBe("estimated");
    expect(s!.values.noiseDb).toBeGreaterThan(65); // a primary road close by is loud
  });

  it("a gap far from any road is below the map's threshold, as official", () => {
    const [s] = buildSegments(collection([farFromRoadWalk, road(43.2801)]), config, { noiseIndex: farAway });
    expect(s!.sources!.noise).toBe("official");
    expect(s!.values.noiseDb).toBe(config.autoData.noiseMap.belowThresholdDb);
  });

  it("where the map has a band, it wins even right next to a road", () => {
    const covering = buildNoiseIndex(collection([band(60, square(5.349, 43.279, 5.353, 43.281))]));
    const [s] = buildSegments(collection([nearRoadWalk, road(43.2801)]), config, { noiseIndex: covering });
    expect(s!.sources!.noise).toBe("official");
    expect(s!.values.noiseDb).toBeCloseTo(60 + config.autoData.noiseMap.bandMidpointOffsetDb, 6);
  });

  it("with no map at all, the estimate is the fallback; with neither, noise stays no data", () => {
    const [withRoad] = buildSegments(collection([nearRoadWalk, road(43.2801)]), config);
    expect(withRoad!.sources!.noise).toBe("estimated");
    const [none] = buildSegments(collection([nearRoadWalk]), config);
    expect(none!.values.noiseDb).toBeUndefined();
  });
});
