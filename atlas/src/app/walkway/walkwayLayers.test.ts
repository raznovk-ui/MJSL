import { describe, expect, it } from "vitest";
import { WALKWAY_CONFIG as config, scoreSegment, type Segment } from "../../domain/walkway/index.js";
import { gradientColour, layerValue, segmentsGeojson } from "./walkwayLayers.js";

const seg: Segment = {
  id: "a",
  geometry: [[5.35, 43.28], [5.351, 43.28]],
  values: { widthM: 1.35, noiseDb: 85, privateShare: 0 }, // physical obstacle 0.5, sensory obstacle 1, economic 0
};

describe("map layers", () => {
  const score = scoreSegment(seg, "blind", config);

  it("a dimension layer shows 1 minus that dimension's obstacle; combined shows the profile score", () => {
    expect(layerValue(score, "physical")).toBeCloseTo(0.5, 6);
    expect(layerValue(score, "sensory")).toBeCloseTo(0, 6);
    expect(layerValue(score, "economic")).toBeCloseTo(1, 6);
    expect(layerValue(score, "political")).toBeNull(); // nothing known: no value, never 0
    expect(layerValue(score, "combined")).toBe(score.score);
  });

  it("uses one green-to-red scale for every layer", () => {
    expect(gradientColour(0)).toBe("#b91c1c");
    expect(gradientColour(1)).toBe("#15803d");
    expect(gradientColour(-5)).toBe("#b91c1c");
    expect(gradientColour(0.6)).toBe("#eab308");
  });

  it("classes and colours follow the chosen layer, and unknown stays grey", () => {
    const props = (layer: Parameters<typeof segmentsGeojson>[3]) =>
      segmentsGeojson([seg], { a: score }, config, layer).features[0]!.properties!;
    expect(props("sensory").cls).toBe("red"); // value 0 is drawn dashed
    expect(props("economic").cls).toBe("green");
    expect(props("political").cls).toBe("none");
    expect(props("political").colour).toBe(config.classes.colours.none);
    expect(props("physical").colour).not.toBe(props("economic").colour);
  });
});
