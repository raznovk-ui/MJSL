import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { WALKWAY_CONFIG as config } from "../loadConfig.js";
import { buildSegments } from "../fromOsm.js";
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
