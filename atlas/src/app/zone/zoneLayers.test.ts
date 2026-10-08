import { describe, expect, it } from "vitest";
import { ZONE_CONFIG as config, scoreZone, type Zone } from "../../domain/zone/index.js";
import { gradientColour, layerValue, zonesGeojson } from "./zoneLayers.js";

const zone = (id: string, values: Record<string, number>): Zone => ({
  id, name: id, zoneType: "habitat", arrondissement: "Marseille 1er Arrondissement",
  geometry: { type: "Polygon", coordinates: [[[5.35, 43.28], [5.36, 43.28], [5.36, 43.29], [5.35, 43.29], [5.35, 43.28]]] },
  areaKm2: 1, centroid: [5.355, 43.285], streetKm: 2, households: 0,
  values, sources: Object.fromEntries(Object.keys(values).map((k) => [k, "osm" as const])), counts: {},
});

describe("map layers", () => {
  const z = zone("a", { slope: 8, noise: 85, publicPrivate: 0 }); // physical obstacle 0.5, sensory 1, economic 0
  const score = scoreZone(z, "blind", config);

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
    expect(gradientColour(0.6)).toBe("#eab308");
    expect(gradientColour(0.5)).not.toBe(gradientColour(0.8));
  });

  it("classes and colours follow the chosen layer, and unknown stays grey", () => {
    const props = (layer: Parameters<typeof zonesGeojson>[3]) => zonesGeojson([z], { a: score }, config, layer).features[0]!.properties!;
    expect(props("sensory").cls).toBe("red"); // value 0 is outlined dashed
    expect(props("economic").cls).toBe("green");
    expect(props("political").cls).toBe("none");
    expect(props("political").colour).toBe(config.classes.colours.none);
    expect(props("physical").colour).not.toBe(props("economic").colour);
  });
});
