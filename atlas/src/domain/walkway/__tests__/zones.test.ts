import { describe, expect, it } from "vitest";
import rawConfig from "../walkway.config.json";
import { WALKWAY_CONFIG as config, validateWalkwayConfig } from "../loadConfig.js";
import { scoreAllProfiles } from "../score.js";
import { polylineLengthM } from "../geo.js";
import type { LngLat, Segment, SegmentScore, ValueSource } from "../types.js";
import { detectZones } from "../zones.js";

const LAT = 43.28;
/** A segment running east from (lng0, LAT); 1e-4 degrees of longitude is about 8 m. */
function seg(
  id: string,
  from: string,
  to: string,
  lng0: number,
  lng1: number,
  values: Segment["values"],
  sources: Segment["sources"] = {},
  lat = LAT,
): Segment {
  const geometry: LngLat[] = [[lng0, lat], [lng1, lat]];
  return { id, from, to, geometry, lengthM: polylineLengthM(geometry), values, sources };
}

const scoresFor = (segments: Segment[], profile: string) =>
  Object.fromEntries(segments.map((s) => [s.id, scoreAllProfiles(s, config)[profile]!])) as Record<string, SegmentScore>;

// Bad: a 0.9 m wide stretch with loud noise is a total obstacle (score 0) without any veto.
const BAD = { widthM: 0.95, noiseDb: 85, privatizedShare: 0.9 };
const GOOD = { widthM: 2.2, noiseDb: 45, privatizedShare: 0 };
const run = (segments: Segment[], profile = "blind", cfg = config) => detectZones(segments, scoresFor(segments, profile), profile, cfg);

describe("zone detection", () => {
  it("joins connected bad segments into one zone and leaves good ones out", () => {
    const segments = [
      seg("a", "n1", "n2", 5.350, 5.351, BAD),
      seg("b", "n2", "n3", 5.351, 5.352, BAD),
      seg("c", "n3", "n4", 5.352, 5.353, BAD),
      seg("ok", "n4", "n5", 5.353, 5.354, GOOD),
    ];
    const zones = run(segments);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.segmentIds.sort()).toEqual(["a", "b", "c"]);
    expect(zones[0]!.segmentCount).toBe(3);
  });

  it("drops a short cluster, as noise", () => {
    const stub = seg("stub", "x1", "x2", 5.350, 5.3503, BAD); // about 24 m, under the 50 m minimum
    expect(run([stub])).toHaveLength(0);
  });

  it("keeps even a very short zone when it holds a vetoed segment: a hard block always counts", () => {
    const steps = seg("steps", "x1", "x2", 5.350, 5.3502, { widthM: 2, hasSteps: true, hasRamp: false });
    const zones = run([steps], "wheelchair");
    expect(zones).toHaveLength(1);
    expect(zones[0]!.vetoedSegments).toBe(1);
    expect(zones[0]!.vetoReasons).toEqual(["steps without a ramp"]);
    expect(zones[0]!.summary).toMatch(/blocage/);
  });

  it("merges clusters whose ends are within the merge gap, and not beyond it", () => {
    // Two 3-segment bad runs; the gap between them has no shared node and no segment.
    const make = (gapLng: number) => [
      seg("a", "n1", "n2", 5.350, 5.351, BAD),
      seg("b", "n2", "n3", 5.351, 5.352, BAD),
      seg("c", "m1", "m2", 5.352 + gapLng, 5.353 + gapLng, BAD),
      seg("d", "m2", "m3", 5.353 + gapLng, 5.354 + gapLng, BAD),
    ];
    expect(run(make(0.0001))).toHaveLength(1); // about 8 m apart: merged
    expect(run(make(0.001))).toHaveLength(2); // about 80 m apart: separate
  });

  it("ranks by severity, so a long bad stretch outranks a short one", () => {
    const long = [seg("l1", "a1", "a2", 5.350, 5.352, BAD), seg("l2", "a2", "a3", 5.352, 5.354, BAD)];
    const short = [seg("s1", "b1", "b2", 5.370, 5.3712, BAD)];
    const zones = run([...short, ...long]);
    expect(zones.map((z) => z.rank)).toEqual([1, 2]);
    expect(zones[0]!.segmentIds.sort()).toEqual(["l1", "l2"]);
    expect(zones[0]!.severity).toBeGreaterThan(zones[1]!.severity);
    expect(zones[0]!.id).toBe("blind_zone_1");
  });

  it("scores zones per profile: the same street is a zone for one profile and not the other", () => {
    // Steps with no ramp: a hard block for a wheelchair, not for a blind person.
    const segments = [seg("st", "n1", "n2", 5.350, 5.3503, { widthM: 2.5, noiseDb: 45, privatizedShare: 0, hasSteps: true })];
    expect(run(segments, "wheelchair")).toHaveLength(1);
    expect(run(segments, "blind")).toHaveLength(0);
  });

  it("names what drives the zone, worst barrier first", () => {
    const segments = [seg("a", "n1", "n2", 5.350, 5.352, { widthM: 2.2, noiseDb: 85, privatizedShare: 0.2 })];
    const [zone] = run(segments);
    expect(zone!.drivers[0]!.indicator).toBe("noise");
    expect(zone!.drivers[0]!.meanBarrier).toBeCloseTo(1, 6);
    expect(zone!.summary).toMatch(/Cause principale : bruit/);
  });

  it("states how much of a zone rests on estimated values, by length", () => {
    const sources = (s: ValueSource) => ({ width: s, noise: s, economic: s });
    const segments = [
      seg("a", "n1", "n2", 5.350, 5.352, BAD, sources("estimated")),
      seg("b", "n2", "n3", 5.352, 5.354, BAD, sources("official")),
    ];
    const [zone] = run(segments);
    expect(zone!.basis.estimated).toBeCloseTo(0.5, 2);
    expect(zone!.basis.official).toBeCloseTo(0.5, 2);
    expect(zone!.basis.estimated + zone!.basis.official + zone!.basis.osm + zone!.basis.measured).toBeCloseTo(1, 6);
  });

  it("warns on the zone itself when most of it is estimated", () => {
    const [zone] = run([seg("a", "n1", "n2", 5.350, 5.352, BAD, { width: "estimated", noise: "estimated", economic: "estimated" })]);
    expect(zone!.summary).toMatch(/estimees : a confirmer sur le terrain/);
  });

  it("ignores segments with no score and returns nothing when nothing is bad", () => {
    expect(run([seg("n", "n1", "n2", 5.350, 5.352, {})])).toHaveLength(0);
    expect(run([seg("g", "n1", "n2", 5.350, 5.352, GOOD)])).toHaveLength(0);
    expect(run([])).toHaveLength(0);
  });

  it("gives each zone a bounding box and its member lines for drawing", () => {
    const [zone] = run([seg("a", "n1", "n2", 5.350, 5.352, BAD), seg("b", "n2", "n3", 5.352, 5.354, BAD)]);
    expect(zone!.lines).toHaveLength(2);
    expect(zone!.bbox).toEqual([5.35, LAT, 5.354, LAT]);
  });

  it("follows the config: a stricter threshold finds fewer zones", () => {
    const loose = JSON.parse(JSON.stringify(rawConfig));
    loose.zones.scoreBelow = 1;
    loose.zones.minLengthM = 0;
    const strict = JSON.parse(JSON.stringify(rawConfig));
    strict.zones.scoreBelow = 0.05;
    const half = seg("h", "n1", "n2", 5.350, 5.352, { widthM: 1.35, noiseDb: 55, privatizedShare: 0 }); // barrier 0.5 -> score 0.5
    expect(run([half], "blind", validateWalkwayConfig(loose))).toHaveLength(1);
    expect(run([half], "blind", validateWalkwayConfig(strict))).toHaveLength(0);
  });
});

describe("zones config validation", () => {
  it("rejects a bad threshold or length in plain words", () => {
    const c = JSON.parse(JSON.stringify(rawConfig));
    c.zones.scoreBelow = 0;
    c.zones.mergeGapM = -5;
    c.zones.minLengthM = "fifty";
    let message = "";
    try { validateWalkwayConfig(c); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/zones.scoreBelow" must be a number above 0/);
    expect(message).toMatch(/zones.mergeGapM" must be a number of metres/);
    expect(message).toMatch(/zones.minLengthM" must be a number of metres/);
  });
});
