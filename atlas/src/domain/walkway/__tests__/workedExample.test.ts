import { describe, expect, it } from "vitest";
import { WALKWAY_CONFIG as config } from "../loadConfig.js";
import { findRoute } from "../route.js";
import { scoreSegment } from "../score.js";
import type { Segment } from "../types.js";
import { whatIf } from "../whatIf.js";

/**
 * The worked example from the field measurements. The 1.20 m, 80 dB and 42 %
 * values are passed in directly as segment values, not read from OSM.
 */
const A: Segment = {
  id: "A",
  from: "n1",
  to: "n2",
  lengthM: 100,
  values: { widthM: 1.2, noiseDb: 80, privatizedShare: 0.42, hasSteps: false },
};
const B: Segment = {
  id: "B",
  from: "n2",
  to: "n3",
  lengthM: 60,
  values: { widthM: 1.45, noiseDb: 50, privatizedShare: 0.1, hasSteps: true, hasRamp: false },
};
const segments = [A, B];

describe("worked example: segment scores", () => {
  it("Segment A: wheelchair 0.37, blind 0.26", () => {
    expect(scoreSegment(A, "wheelchair", config).score).toBeCloseTo(0.37, 2);
    expect(scoreSegment(A, "blind", config).score).toBeCloseTo(0.26, 2);
  });

  it("Segment B: wheelchair 0 (veto on steps without a ramp), blind 0.84", () => {
    const wheelchair = scoreSegment(B, "wheelchair", config);
    expect(wheelchair.score).toBe(0);
    expect(wheelchair.vetoed).toBe(true);
    expect(wheelchair.vetoReasons).toEqual(["steps without a ramp"]);
    expect(scoreSegment(B, "blind", config).score).toBeCloseTo(0.84, 2);
  });

  it("stairs do not veto the blind profile", () => {
    expect(scoreSegment(B, "blind", config).vetoed).toBe(false);
  });
});

describe("worked example: route A to B", () => {
  it("wheelchair: score 0, blocked at B, no detour exists", () => {
    const route = findRoute(segments, "n1", "n3", "wheelchair", config);
    expect(route.score).toBe(0);
    expect(route.weakestSegmentId).toBe("B");
    expect(route.possible).toBe(false);
    expect(route.detour).toBeNull();
  });

  it("blind: score 0.26, weak link is A", () => {
    const route = findRoute(segments, "n1", "n3", "blind", config);
    expect(route.score).toBeCloseTo(0.26, 2);
    expect(route.weakestSegmentId).toBe("A");
    expect(route.possible).toBe(true);
  });
});

describe("worked example: what if", () => {
  it("noise on A lowered to 65 dB takes the blind score on A to 0.53", () => {
    const result = whatIf(segments, [{ segmentId: "A", set: { noiseDb: 65 } }], config);
    const blind = result.segments.find((s) => s.segmentId === "A" && s.profileId === "blind")!;
    expect(blind.before).toBeCloseTo(0.26, 2);
    expect(blind.after).toBeCloseTo(0.53, 2);
  });

  it("does not change the original segments", () => {
    whatIf(segments, [{ segmentId: "A", set: { noiseDb: 65 } }], config);
    expect(A.values.noiseDb).toBe(80);
  });

  it("adding a ramp on B unblocks the wheelchair route", () => {
    const result = whatIf(segments, [{ segmentId: "B", set: { hasRamp: true } }], config, { from: "n1", to: "n3" });
    const wheelchair = result.routes!.find((r) => r.profileId === "wheelchair")!;
    expect(wheelchair.before.possible).toBe(false);
    expect(wheelchair.after.possible).toBe(true);
    expect(wheelchair.after.score).toBeGreaterThan(0);
  });

  it("rejects a change for a segment that does not exist", () => {
    expect(() => whatIf(segments, [{ segmentId: "Z", set: {} }], config)).toThrow(/no segment/);
  });
});
