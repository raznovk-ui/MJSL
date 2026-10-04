import { describe, expect, it } from "vitest";
import rawConfig from "../walkway.config.json";
import { WALKWAY_CONFIG as config, WalkwayConfigError, validateWalkwayConfig } from "../loadConfig.js";
import { computeBarriers, estimateNoiseDb, linearBarrier } from "../indicators.js";
import { buildSegments, parseInclinePct, parseMetres, parseSpeedKmh } from "../fromOsm.js";
import { findRoute, nearestGraphNode, shortestPath } from "../route.js";
import { scoreSegment } from "../score.js";
import { segmentsToGeojson } from "../toGeojson.js";
import type { Segment } from "../types.js";
import type { FeatureCollection } from "geojson";

const seg = (id: string, from: string, to: string, lengthM: number, values: Segment["values"] = {}): Segment => ({
  id, from, to, lengthM, values,
});
const clone = () => JSON.parse(JSON.stringify(rawConfig));

describe("barrier formulas", () => {
  it("matches the stated formulas and clamps to 0..1", () => {
    expect(linearBarrier(1.2, 1.8, 0.9)).toBeCloseTo(0.6667, 3); // width
    expect(linearBarrier(80, 55, 85)).toBeCloseTo(0.8333, 3); // noise
    expect(linearBarrier(8, 4, 12)).toBeCloseTo(0.5, 6); // slope
    expect(linearBarrier(2.5, 1.8, 0.9)).toBe(0); // wider than fine: clamped
    expect(linearBarrier(50, 55, 85)).toBe(0); // quieter than fine: clamped
    expect(linearBarrier(0.5, 1.8, 0.9)).toBe(1);
  });

  it("surface uses the lookup table and ignores unknown surfaces", () => {
    const get = (surface: string) =>
      computeBarriers({ id: "x", values: { surface } }, config).find((b) => b.indicator === "surface")!.barrier;
    expect(get("asphalt")).toBe(0);
    expect(get("paving_stones")).toBe(0);
    expect(get("sett")).toBe(0.5);
    expect(get("gravel")).toBe(0.8);
    expect(get("sand")).toBe(0.8);
    expect(get("moon_dust")).toBeNull();
  });

  it("rest: 0 within 50 m, 1 beyond 200 m, linear between", () => {
    const get = (d: number) =>
      computeBarriers({ id: "x", values: { restDistanceM: d } }, config).find((b) => b.indicator === "rest")!.barrier;
    expect(get(30)).toBe(0);
    expect(get(125)).toBeCloseTo(0.5, 6);
    expect(get(260)).toBe(1);
  });

  it("slope ignores the sign", () => {
    const get = (p: number) =>
      computeBarriers({ id: "x", values: { inclinePct: p } }, config).find((b) => b.indicator === "slope")!.barrier;
    expect(get(-8)).toBe(get(8));
  });
});

describe("missing data is never counted as 0", () => {
  it("a missing value gives 'no data' (null), not 0", () => {
    const barriers = computeBarriers({ id: "x", values: {} }, config);
    expect(barriers.every((b) => b.barrier === null)).toBe(true);
  });

  it("a segment with nothing to score gets no score, not a perfect 1", () => {
    const s = scoreSegment({ id: "x", values: {} }, "blind", config);
    expect(s.score).toBeNull();
    expect(s.cls).toBe("none");
  });

  it("a dimension with no data is left out and the other weights are rescaled", () => {
    // Only width (physical) is known. The blind profile weights physical 0.3,
    // so after rescaling, physical carries the full weight: (1 - 2/3)^1.
    const s = scoreSegment({ id: "x", values: { widthM: 1.2 } }, "blind", config);
    expect(s.score).toBeCloseTo(1 / 3, 3);
    expect(s.dimensionsMissing.sort()).toEqual(["cognitive", "economic", "sensory", "socio_cultural"]);
  });

  it("a missing tag never triggers a veto", () => {
    expect(scoreSegment({ id: "x", values: { noiseDb: 60 } }, "wheelchair", config).vetoed).toBe(false);
  });
});

describe("vetoes", () => {
  it("wheelchair: width under 0.90 m", () => {
    const s = scoreSegment({ id: "x", values: { widthM: 0.8 } }, "wheelchair", config);
    expect(s.score).toBe(0);
    expect(s.vetoReasons[0]).toMatch(/width/);
  });
  it("wheelchair: raised kerb", () => {
    expect(scoreSegment({ id: "x", values: { widthM: 2, kerbRaised: true } }, "wheelchair", config).vetoed).toBe(true);
  });
  it("steps with a ramp are not vetoed", () => {
    expect(scoreSegment({ id: "x", values: { widthM: 2, hasSteps: true, hasRamp: true } }, "wheelchair", config).vetoed).toBe(false);
  });
  it("product, not sum: one terrible dimension drags a good segment down", () => {
    const good = scoreSegment({ id: "x", values: { widthM: 2, noiseDb: 40, privatizedShare: 0 } }, "blind", config).score!;
    const oneBad = scoreSegment({ id: "x", values: { widthM: 2, noiseDb: 85, privatizedShare: 0 } }, "blind", config).score!;
    expect(good).toBe(1);
    expect(oneBad).toBe(0); // noise barrier 1 zeroes the product; a weighted sum would still say 0.5
  });
});

describe("colour classes", () => {
  it("< 0.3 red, < 0.6 orange, otherwise green, and no data is its own class", () => {
    expect(scoreSegment({ id: "x", values: {} }, "blind", config).cls).toBe("none");
    expect(scoreSegment({ id: "x", values: { widthM: 1.0 } }, "blind", config).cls).toBe("red");
  });
  it("classifies on the configured thresholds", () => {
    // physical-only score = 1 - barrier
    const at = (barrier: number) => scoreSegment({ id: "x", values: { widthM: 1.8 - 0.9 * barrier } }, "blind", config).cls;
    expect(at(0.8)).toBe("red"); // 0.2
    expect(at(0.5)).toBe("orange"); // 0.5
    expect(at(0.2)).toBe("green"); // 0.8
  });
});

describe("routing", () => {
  // n1 -A- n2 -B(steps)- n3, plus a longer step-free detour n2 -C- n4 -D- n3.
  const graph: Segment[] = [
    seg("A", "n1", "n2", 100, { widthM: 2, noiseDb: 50 }),
    seg("B", "n2", "n3", 50, { widthM: 2, noiseDb: 50, hasSteps: true }),
    seg("C", "n2", "n4", 80, { widthM: 1.5, noiseDb: 50 }),
    seg("D", "n4", "n3", 90, { widthM: 2, noiseDb: 50 }),
  ];

  it("wheelchair: direct path is blocked, detour avoids the vetoed segment and reports extra length", () => {
    const r = findRoute(graph, "n1", "n3", "wheelchair", config);
    expect(r.possible).toBe(false);
    expect(r.score).toBe(0);
    expect(r.weakestSegmentId).toBe("B");
    expect(r.detour).not.toBeNull();
    expect(r.detour!.segmentIds).toEqual(["A", "C", "D"]);
    expect(r.detour!.extraLengthM).toBeCloseTo(120, 6); // 270 - 150
    expect(r.detour!.score).toBeGreaterThan(0);
    expect(r.detour!.weakestSegmentId).toBe("C"); // the narrowest of the detour
  });

  it("blind: stairs are not a veto, so the direct path stands", () => {
    const r = findRoute(graph, "n1", "n3", "blind", config);
    expect(r.possible).toBe(true);
    expect(r.path.segmentIds).toEqual(["A", "B"]);
    expect(r.detour).toBeNull();
  });

  it("reports an unconnected pair instead of a score", () => {
    const r = findRoute([...graph, seg("Z", "z1", "z2", 10, { widthM: 2 })], "n1", "z2", "blind", config);
    expect(r.connected).toBe(false);
    expect(r.score).toBeNull();
  });

  it("lists unscored segments so they cannot silently hide a weak link", () => {
    const r = findRoute([seg("A", "n1", "n2", 10, { widthM: 2 }), seg("U", "n2", "n3", 10, {})], "n1", "n3", "blind", config);
    expect(r.unscoredSegmentIds).toEqual(["U"]);
  });

  it("shortestPath finds the shorter of two routes and respects the filter", () => {
    expect(shortestPath(graph, "n1", "n3")!.segmentIds).toEqual(["A", "B"]);
    expect(shortestPath(graph, "n1", "n3", (s) => s.id !== "B")!.segmentIds).toEqual(["A", "C", "D"]);
    expect(shortestPath(graph, "n1", "n3", (s) => s.id !== "B" && s.id !== "D")).toBeNull();
  });

  it("nearestGraphNode snaps a point to the closest segment end", () => {
    const geo: Segment[] = [
      { ...seg("A", "n1", "n2", 100), geometry: [[5.35, 43.28], [5.351, 43.28]] },
      { ...seg("B", "n2", "n3", 100), geometry: [[5.351, 43.28], [5.352, 43.28]] },
    ];
    expect(nearestGraphNode(geo, [5.3519, 43.2801])!.node).toBe("n3");
  });
});

describe("noise estimate", () => {
  it("falls with distance, rises with speed, and never goes below the floor", () => {
    const near = estimateNoiseDb("primary", 50, 10, config)!;
    const far = estimateNoiseDb("primary", 50, 160, config)!;
    expect(far).toBeLessThan(near);
    expect(estimateNoiseDb("primary", 90, 10, config)!).toBeGreaterThan(near);
    expect(estimateNoiseDb("primary", 50, 1e9, config)).toBe(config.noiseEstimate.floorDb);
  });
  it("unknown road type gives no estimate", () => {
    expect(estimateNoiseDb("residential", 50, 10, config)).toBeUndefined();
  });
});

describe("OSM tag parsing", () => {
  it("parses widths, inclines and speeds in the common spellings", () => {
    expect(parseMetres("1,5 m")).toBe(1.5);
    expect(parseMetres("150 cm")).toBe(1.5);
    expect(parseMetres("wide")).toBeUndefined();
    expect(parseInclinePct("-6 %")).toBe(-6);
    expect(parseInclinePct("up")).toBeUndefined();
    expect(parseInclinePct("5°")).toBeCloseTo(8.75, 1);
    expect(parseSpeedKmh("50")).toBe(50);
    expect(parseSpeedKmh("30 mph")).toBeCloseTo(48.28, 1);
    expect(parseSpeedKmh("signals")).toBeUndefined();
  });
});

describe("building segments from loaded OSM features", () => {
  const way = (id: string, nodes: number[], coords: [number, number][], tags: Record<string, unknown> = {}) => ({
    type: "Feature" as const,
    properties: { osm_id: id, osm_nodes: nodes, highway: "footway", ...tags },
    geometry: { type: "LineString" as const, coordinates: coords },
  });
  const collection = (features: unknown[]) => ({ type: "FeatureCollection", features }) as FeatureCollection;

  it("cuts a way at a junction shared with another way, so routes connect there", () => {
    const fc = collection([
      way("w1", [1, 2, 3], [[5.35, 43.28], [5.351, 43.28], [5.352, 43.28]]),
      way("w2", [2, 4], [[5.351, 43.28], [5.351, 43.281]]),
    ]);
    const segments = buildSegments(fc, config);
    expect(segments.map((s) => s.id).sort()).toEqual(["w1#1", "w1#2", "w2"]);
    const route = findRoute(segments, "1", "4", "blind", config);
    expect(route.connected).toBe(true);
    expect(route.path.segmentIds).toEqual(["w1#1", "w2"]);
  });

  it("reads tags it has and leaves the rest as no data, with OSM provenance", () => {
    const [s] = buildSegments(
      collection([way("w", [1, 2], [[5.35, 43.28], [5.351, 43.28]], { width: "1.2", surface: "sett", highway: "steps", ramp: "yes" })]),
      config,
    );
    expect(s!.values.widthM).toBe(1.2);
    expect(s!.values.surface).toBe("sett");
    expect(s!.values.hasSteps).toBe(true);
    expect(s!.values.hasRamp).toBe(true);
    expect(s!.values.inclinePct).toBeUndefined();
    expect(s!.values.restDistanceM).toBeUndefined(); // no benches loaded
    expect(s!.values.noiseDb).toBeUndefined(); // no roads loaded
    expect(s!.sources).toMatchObject({ width: "osm", surface: "osm" });
  });

  it("computes rest, economic and estimated noise only when those features are loaded", () => {
    const line: [number, number][] = [[5.35, 43.28], [5.3505, 43.28]]; // ~40 m
    const fc = collection([
      way("w", [1, 2], line),
      { type: "Feature", properties: { amenity: "bench" }, geometry: { type: "Point", coordinates: [5.3502, 43.28005] } },
      { type: "Feature", properties: { outdoor_seating: "yes" }, geometry: { type: "Point", coordinates: [5.35, 43.28005] } },
      { type: "Feature", properties: { highway: "primary", maxspeed: "50", osm_id: "r" }, geometry: { type: "LineString", coordinates: [[5.349, 43.2805], [5.352, 43.2805]] } },
    ]);
    const [s] = buildSegments(fc, config);
    expect(s!.values.restDistanceM).toBeLessThan(50);
    expect(s!.values.privatizedShare).toBeGreaterThan(0);
    expect(s!.values.privatizedShare).toBeLessThan(1);
    expect(s!.values.noiseDb).toBeGreaterThan(config.noiseEstimate.floorDb - 1);
    expect(s!.sources!.noise).toBe("estimated");
    expect(s!.sources!.rest).toBe("osm");
  });

  it("flags a raised kerb next to the segment", () => {
    const fc = collection([
      way("w", [1, 2], [[5.35, 43.28], [5.351, 43.28]]),
      { type: "Feature", properties: { kerb: "raised" }, geometry: { type: "Point", coordinates: [5.3505, 43.28001] } },
    ]);
    expect(buildSegments(fc, config)[0]!.values.kerbRaised).toBe(true);
  });

  it("ignores roads, benches and other features as walkways", () => {
    const fc = collection([
      { type: "Feature", properties: { highway: "primary", osm_id: "r" }, geometry: { type: "LineString", coordinates: [[5.35, 43.28], [5.351, 43.28]] } },
    ]);
    expect(buildSegments(fc, config)).toHaveLength(0);
  });
});

describe("export", () => {
  it("writes score, class, veto and the source of every indicator", () => {
    const s: Segment = {
      id: "A", geometry: [[5.35, 43.28], [5.351, 43.28]], values: { widthM: 1.2, hasSteps: true },
      sources: { width: "osm" },
    };
    const props = segmentsToGeojson([s], config).features[0]!.properties!;
    expect(props.score_wheelchair).toBe(0);
    expect(props.veto_wheelchair).toMatch(/steps/);
    expect(props.source_width).toBe("osm");
    expect(props.source_noise).toBe("no data");
  });
});

describe("config validation (plain-language errors)", () => {
  it("accepts the shipped config", () => {
    expect(() => validateWalkwayConfig(rawConfig)).not.toThrow();
  });

  it("says when weights do not add up to 1", () => {
    const c = clone();
    c.profiles.blind.weights.physical = 0.5;
    expect(() => validateWalkwayConfig(c)).toThrow(/Profile "blind": the weights add up to 1.35, they must add up to 1/);
  });

  it("collects every problem at once", () => {
    const c = clone();
    c.profiles.blind.weights.physical = 0.5;
    c.indicators.width.noProblemAt = c.indicators.width.totalObstacleAt;
    c.classes.redBelow = 0.9;
    try {
      validateWalkwayConfig(c);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WalkwayConfigError);
      expect((e as WalkwayConfigError).problems.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects an unknown dimension, an unknown veto rule and a bad colour", () => {
    const c = clone();
    c.profiles.blind.weights = { physical: 0.5, mood: 0.5 };
    c.profiles.wheelchair.vetoes.teleport = true;
    c.classes.colours.red = "red";
    const message = (() => { try { validateWalkwayConfig(c); return ""; } catch (e) { return (e as Error).message; } })();
    expect(message).toMatch(/unknown dimension "mood"/);
    expect(message).toMatch(/unknown rule "teleport"/);
    expect(message).toMatch(/must look like #b91c1c/);
  });

  it("a new profile added to the config just works", () => {
    const c = clone();
    c.profiles.elderly = { label: "Elderly person", weights: { physical: 0.7, sensory: 0.3 }, vetoes: { widthBelowM: 0.8 } };
    const cfg = validateWalkwayConfig(c);
    expect(scoreSegment({ id: "x", values: { widthM: 1.2, noiseDb: 70 } }, "elderly", cfg).score).toBeGreaterThan(0);
  });
});
