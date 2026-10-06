import { describe, expect, it } from "vitest";
import { WALKWAY_CONFIG as config } from "../loadConfig.js";
import { dimensionScores } from "../dimensionScores.js";
import { scoreAllProfiles } from "../score.js";
import type { Segment, SegmentScore } from "../types.js";

const seg = (id: string, lengthM: number, values: Segment["values"]): Segment => ({ id, lengthM, values });
const scoresOf = (segments: Segment[]) =>
  Object.fromEntries(segments.map((s) => [s.id, scoreAllProfiles(s, config).blind!])) as Record<string, SegmentScore>;

describe("score per dimension", () => {
  it("is 1 minus the average obstacle of the dimension", () => {
    // width 1.35 m -> obstacle 0.5; noise 85 dB -> obstacle 1.
    const a = seg("a", 100, { widthM: 1.35, noiseDb: 85 });
    const d = dimensionScores([a], scoresOf([a]));
    expect(d.physical.score).toBeCloseTo(0.5, 6);
    expect(d.sensory.score).toBeCloseTo(0, 6);
  });

  it("weights segments by length and ignores those with no data for the dimension", () => {
    const a = seg("a", 300, { widthM: 1.8 }); // physical 1
    const b = seg("b", 100, { widthM: 0.9 }); // physical 0
    const c = seg("c", 500, { noiseDb: 55 }); // no physical data at all
    const d = dimensionScores([a, b, c], scoresOf([a, b, c]));
    expect(d.physical.score).toBeCloseTo(0.75, 6); // (300*1 + 100*0) / 400
    expect(d.physical.coverage).toBeCloseTo(400 / 900, 6);
  });

  it("is null, not 0, where nothing is known", () => {
    const a = seg("a", 100, { widthM: 1.8 });
    const d = dimensionScores([a], scoresOf([a]));
    expect(d.cognitive.score).toBeNull();
    expect(d.socio_cultural.score).toBeNull();
    expect(d.cognitive.coverage).toBe(0);
  });
});
