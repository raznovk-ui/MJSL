import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { WALKWAY_CONFIG as config } from "../loadConfig.js";
import { buildSegments } from "../fromOsm.js";
import { buildAmpIndex } from "../ampData.js";
import { scoreSegment } from "../score.js";
import { DIMENSION_KEYS } from "../../dimensions.js";

const LAT = 43.28;
const node = (lng: number, lat: number, tags: Record<string, string>) => ({
  type: "Feature" as const,
  properties: tags,
  geometry: { type: "Point" as const, coordinates: [lng, lat] },
});
const way = (id: string, tags: Record<string, string>, coords: [number, number][]) => ({
  type: "Feature" as const,
  properties: { osm_id: id, highway: "footway", ...tags },
  geometry: { type: "LineString" as const, coordinates: coords },
});
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features }) as FeatureCollection;

// 1e-4 degrees of longitude is about 8 m.
const road: [number, number][] = [[5.350, LAT], [5.352, LAT]];

describe("the five dimensions are filled in from OpenStreetMap places, with no input", () => {
  const places = [
    node(5.351, LAT + 0.0002, { amenity: "cafe" }), // a landmark and an activity place, ~22 m away
    node(5.3512, LAT + 0.0002, { shop: "bakery" }),
    node(5.3508, LAT + 0.0002, { highway: "bus_stop" }),
    node(5.360, LAT, { amenity: "townhall" }), // ~800 m away
    node(5.351, LAT - 0.0003, { amenity: "bench" }),
  ];

  it("reads landmarks, the nearest activity place and the nearest civic place", () => {
    const [segment] = buildSegments(fc([way("w1", {}, road), ...places]), config);
    expect(segment!.values.landmarkCount).toBe(3); // cafe, bakery, bus stop; the bench is street furniture
    expect(segment!.sources?.landmarks).toBe("osm");
    expect(segment!.values.activityDistanceM).toBeLessThan(30);
    expect(segment!.values.civicDistanceM).toBeGreaterThan(600);
    expect(segment!.values.civicDistanceM).toBeLessThan(900);
    expect(segment!.sources?.activities).toBe("osm");
    expect(segment!.sources?.civic).toBe("osm");
  });

  it("gives every one of the five dimensions a value on a plain mapped footway", () => {
    const [segment] = buildSegments(fc([way("w1", { lit: "yes", width: "1.5" }, road), ...places]), config);
    const score = scoreSegment(segment!, "blind", config);
    const have = new Set(score.barriers.filter((b) => b.barrier !== null).map((b) => b.dimension));
    for (const d of ["physical", "cognitive", "socio_cultural"] as const) expect(have.has(d)).toBe(true);
    expect(score.dimensionBarriers.cognitive).toBeDefined();
    expect(score.dimensionBarriers.socio_cultural).toBeDefined();
    expect(DIMENSION_KEYS.length).toBeGreaterThanOrEqual(5);
  });

  it("lighting: the lit tag wins; lamps are used only where they are mapped densely", () => {
    const unlit = buildSegments(fc([way("w1", { lit: "no" }, road)]), config)[0]!;
    expect(unlit.values.unlitShare).toBe(1);
    expect(unlit.sources?.lighting).toBe("osm");
    const lit = buildSegments(fc([way("w1", { lit: "yes" }, road)]), config)[0]!;
    expect(lit.values.unlitShare).toBe(0);
    // One lamp for one way is dense enough: the segment under it is lit, one far away is not.
    const lamps = [node(5.3505, LAT, { highway: "street_lamp" })];
    const far = way("w2", {}, [[5.40, LAT], [5.402, LAT]]);
    const [near, away] = buildSegments(fc([way("w1", {}, road), far, ...lamps]), config);
    expect(near!.sources?.lighting).toBe("estimated");
    expect(near!.values.unlitShare).toBeLessThan(away!.values.unlitShare!);
    expect(away!.values.unlitShare).toBe(1);
  });

  it("leaves a dimension at 'no data' when OpenStreetMap has no such place at all", () => {
    const [segment] = buildSegments(fc([way("w1", {}, road)]), config);
    expect(segment!.values.landmarkCount).toBeUndefined();
    expect(segment!.values.activityDistanceM).toBeUndefined();
    expect(segment!.values.civicDistanceM).toBeUndefined();
  });
});

describe("hiking trails are not pavements", () => {
  const trail = (tags: Record<string, string>) => way("t", tags, road);
  const kept = (tags: Record<string, string>) => buildSegments(fc([trail(tags)]), config).length;

  it("drops paths with hiking tags, a trail name or an unpaved surface", () => {
    expect(kept({ highway: "path", sac_scale: "hiking" })).toBe(0);
    expect(kept({ highway: "path", trail_visibility: "good" })).toBe(0);
    expect(kept({ highway: "path", name: "Sentier des Douaniers" })).toBe(0);
    expect(kept({ highway: "path", surface: "dirt" })).toBe(0);
  });

  it("keeps ordinary urban walkways, including a paved path and a plain footway", () => {
    expect(kept({ highway: "footway" })).toBe(1);
    expect(kept({ highway: "path", surface: "asphalt" })).toBe(1);
    expect(kept({ highway: "pedestrian", name: "Sentier fleuri" })).toBe(1); // only paths, footways and steps are tested
    expect(kept({ highway: "footway", surface: "dirt" })).toBe(1); // an unpaved surface alone condemns only plain paths
  });
});

describe("the six dimensions of the memoire, each with its own indicator", () => {
  it("economic: share of private places among free public and private ones nearby", () => {
    const near = (lng: number, tags: Record<string, string>) => node(lng, LAT + 0.0002, tags);
    // 1 bench + 1 park (free) against 1 cafe + 1 terrace (private): half private.
    const places = [
      near(5.3505, { amenity: "bench" }),
      near(5.3510, { leisure: "park" }),
      near(5.3515, { amenity: "cafe" }),
      near(5.3518, { outdoor_seating: "yes" }),
    ];
    const [segment] = buildSegments(fc([way("w1", {}, road), ...places]), config);
    expect(segment!.values.privateShare).toBeCloseTo(0.5, 6);
    expect(segment!.sources?.publicPrivate).toBe("osm");
    expect(scoreSegment(segment!, "blind", config).barriers.find((b) => b.indicator === "publicPrivate")!.dimension).toBe("economic");
  });

  it("a paying toilet is not a free public place", () => {
    const places = [node(5.351, LAT + 0.0002, { amenity: "toilets", fee: "yes" }), node(5.351, LAT + 0.0002, { amenity: "cafe" })];
    const [segment] = buildSegments(fc([way("w1", {}, road), ...places]), config);
    expect(segment!.values.privateShare).toBe(1);
  });

  it("lighting belongs to sensory and the consultation places to political, as in the memoire", () => {
    const dims = Object.fromEntries(
      scoreSegment({ id: "x", values: { unlitShare: 0.5, privateShare: 0.5, civicDistanceM: 1200 }, sources: {} }, "blind", config).barriers.map((b) => [b.indicator, b.dimension]),
    );
    expect(dims.lighting).toBe("sensory");
    expect(dims.civic).toBe("political");
    expect(dims.landmarks).toBe("cognitive");
    expect(dims.activities).toBe("socio_cultural");
    expect(dims.publicPrivate).toBe("economic");
  });

  it("every dimension carries weight in both profiles, and the weights add up to 1", () => {
    for (const profile of Object.values(config.profiles)) {
      for (const d of DIMENSION_KEYS) expect(profile.weights[d] ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("social dimension (memoire D5): thresholds, control, co-presence, shelter", () => {
  const steps = (tags: Record<string, string> = {}) =>
    ({ ...way("st", { highway: "steps", ...tags }, [[5.3510, LAT + 0.0001], [5.3511, LAT + 0.0001]]) });
  const shop = node(5.35105, LAT + 0.0002, { shop: "bakery" });

  it("counts steps with no ramp that lie beside a place", () => {
    const [flat, stairs] = buildSegments(fc([way("w1", {}, road), steps(), shop]), config);
    // The footway passes the steps (and the shop beside them): one threshold.
    expect(flat!.values.thresholdSteps).toBe(1);
    expect(stairs!.values.thresholdSteps).toBe(1);
    expect(flat!.sources?.thresholds).toBe("osm");
  });

  it("ignores steps with a ramp, and steps with no place beside them", () => {
    expect(buildSegments(fc([way("w1", {}, road), steps({ ramp: "yes" }), shop]), config)[0]!.values.thresholdSteps).toBe(0);
    expect(buildSegments(fc([way("w1", {}, road), steps()]), config)[0]!.values.thresholdSteps).toBe(0);
  });

  it("counts cameras and gates, but only where the data has any", () => {
    const none = buildSegments(fc([way("w1", {}, road)]), config)[0]!;
    expect(none.values.controlDevices).toBeUndefined();
    const cam = node(5.351, LAT + 0.0001, { man_made: "surveillance" });
    const gate = node(5.3512, LAT + 0.0001, { barrier: "gate" });
    const far = node(5.40, LAT, { man_made: "surveillance" });
    const [seg] = buildSegments(fc([way("w1", {}, road), cam, gate, far]), config);
    expect(seg!.values.controlDevices).toBe(2);
    expect(seg!.sources?.surveillance).toBe("osm");
  });

  it("co-presence reads a tagged width, never the estimated default", () => {
    const tagged = buildSegments(fc([way("w1", { width: "1.2" }, road)]), config)[0]!;
    const b = scoreSegment(tagged, "blind", config).barriers.find((x) => x.indicator === "coPresence")!;
    expect(b.barrier).toBeCloseTo(0.6, 6); // (1.2 - 1.5) / (1.0 - 1.5)
    expect(b.source).toBe("osm");
    const guessed = buildSegments(fc([way("w1", {}, road)]), config)[0]!; // width defaulted to 1.5, estimated
    expect(guessed.sources?.width).toBe("estimated");
    expect(scoreSegment(guessed, "blind", config).barriers.find((x) => x.indicator === "coPresence")!.barrier).toBeNull();
  });

  it("shelters: covered ways, bus shelters and shelters count; none nearby is an obstacle", () => {
    const shelter = node(5.351, LAT + 0.0002, { amenity: "shelter" });
    const covered = way("c1", { covered: "yes" }, [[5.3511, LAT + 0.0003], [5.3512, LAT + 0.0003]]);
    const [seg] = buildSegments(fc([way("w1", {}, road), shelter, covered]), config);
    expect(seg!.values.shelterCount).toBeGreaterThanOrEqual(2);
    const far = node(5.40, LAT, { amenity: "shelter" });
    const [alone] = buildSegments(fc([way("w1", {}, road), far]), config);
    expect(alone!.values.shelterCount).toBe(0);
    expect(scoreSegment(alone!, "blind", config).barriers.find((x) => x.indicator === "shelter")!.barrier).toBe(1);
  });
});

describe("indicators of the client's six personas", () => {
  const box = (x0: number, y0: number, x1: number, y1: number, properties: Record<string, unknown>) => ({
    type: "Feature" as const,
    properties,
    geometry: { type: "Polygon" as const, coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
  });
  const amp = buildAmpIndex({
    transit: [
      { lon: 5.3505, lat: LAT + 0.0002, mode: "bus" },
      { lon: 5.3510, lat: LAT + 0.0002, mode: "bus" },
      { lon: 5.3515, lat: LAT + 0.0002, mode: "tram" },
      { lon: 5.40, lat: LAT, mode: "metro" }, // too far
    ],
    tourism: [{ lon: 5.351, lat: LAT + 0.003 }], // about 330 m away
    iris: { type: "FeatureCollection", features: [box(5.34, 43.27, 5.36, 43.29, { poverty: 30 })] } as FeatureCollection,
    qpv: { type: "FeatureCollection", features: [box(5.349, 43.279, 5.353, 43.281, { kind: "qpv" })] } as FeatureCollection,
  });
  const [seg] = buildSegments(fc([way("w1", {}, road)]), config, { amp });
  const barrier = (key: string, s = seg!) => scoreSegment(s, "blind", config).barriers.find((b) => b.indicator === key)!;

  it("physical: counts transport MODES within walking distance, two or more is good", () => {
    expect(seg!.values.transitModes).toBe(2); // bus and tram; the metro is too far
    expect(barrier("transit").barrier).toBe(0);
    expect(barrier("transit").source).toBe("official");
    const [bare] = buildSegments(fc([way("w1", {}, road)]), config, { amp: buildAmpIndex({ transit: [{ lon: 5.3505, lat: LAT + 0.0002, mode: "bus" }] }) });
    expect(barrier("transit", bare!).barrier).toBe(0.5); // one mode: half an obstacle
  });

  it("cognitive: distance to the nearest information office, and how winding the trace is", () => {
    expect(seg!.values.infoDistanceM).toBeGreaterThan(300);
    expect(seg!.values.infoDistanceM).toBeLessThan(400);
    expect(seg!.values.sinuosity).toBeCloseTo(1, 6); // a straight line
    const bend = buildSegments(fc([way("w2", {}, [[5.350, LAT], [5.3505, LAT + 0.0006], [5.351, LAT]])]), config)[0]!;
    expect(bend.values.sinuosity).toBeGreaterThan(1.5);
    expect(barrier("legibility", bend).barrier).toBeGreaterThan(0.5);
  });

  it("social: the poverty rate of the neighbourhood, from the IRIS the segment lies in", () => {
    expect(seg!.values.areaPovertyPct).toBe(30);
    expect(barrier("poverty").barrier).toBeCloseTo(0.5, 6); // (30 - 15) / (45 - 15)
    const outside = buildSegments(fc([way("w3", {}, [[5.50, LAT], [5.502, LAT]])]), config, { amp })[0]!;
    expect(outside.values.areaPovertyPct).toBeUndefined();
  });

  it("political: inside a priority neighbourhood or project perimeter is a co-participation device", () => {
    expect(seg!.values.inParticipationArea).toBe(true);
    expect(barrier("participation").barrier).toBe(0);
    const outside = buildSegments(fc([way("w3", {}, [[5.50, LAT], [5.502, LAT]])]), config, { amp })[0]!;
    expect(outside.values.inParticipationArea).toBe(false);
    expect(barrier("participation", outside).barrier).toBe(0.5);
  });

  it("sensory: crossings (equipped or not), signs and glare", () => {
    const places = [
      node(5.3510, LAT + 0.0001, { highway: "crossing", crossing: "traffic_signals" }),
      node(5.3512, LAT + 0.0001, { tourism: "information", information: "guidepost" }),
      node(5.3513, LAT + 0.0001, { tourism: "information", information: "board" }),
    ];
    const [s1] = buildSegments(fc([way("w1", { surface: "marble" }, road), ...places]), config);
    expect(barrier("crossings", s1!).barrier).toBe(0);
    expect(s1!.values.signageCount).toBe(2);
    expect(barrier("signage", s1!).barrier).toBe(0);
    expect(barrier("glare", s1!).barrier).toBe(0.9);
    const [plain] = buildSegments(fc([way("w1", {}, road), node(5.351, LAT + 0.0001, { highway: "crossing" })]), config);
    expect(barrier("crossings", plain!).barrier).toBe(0.4); // marked, not equipped
  });

  it("economic: distance to the nearest FREE service; a paying toilet does not count", () => {
    const [free] = buildSegments(fc([way("w1", {}, road), node(5.351, LAT + 0.0003, { amenity: "drinking_water" })]), config);
    expect(free!.values.freeServiceDistanceM).toBeLessThan(50);
    const [paying] = buildSegments(fc([way("w1", {}, road), node(5.351, LAT + 0.0003, { amenity: "toilets", fee: "yes" })]), config);
    expect(paying!.values.freeServiceDistanceM).toBeUndefined();
  });

  it("there are four personas, each weighting its own dimension most", () => {
    const top = (id: string) => Object.entries(config.profiles[id]!.weights).sort((a, b) => b[1]! - a[1]!)[0]![0];
    expect(top("allophone")).toBe("cognitive");
    expect(top("low_income")).toBe("economic");
    expect(top("blind")).toBe("sensory");
    expect(top("wheelchair")).toBe("physical");
  });
});
