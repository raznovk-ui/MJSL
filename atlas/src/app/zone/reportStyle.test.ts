import { describe, expect, it } from "vitest";
import { REPORT_KINDS, REPORT_STYLE, SHAPE_PATH } from "./reportStyle.js";

describe("report symbols", () => {
  it("gives every kind its own shape, so the kind never depends on colour alone", () => {
    const shapes = REPORT_KINDS.map((k) => REPORT_STYLE[k].shape);
    expect(new Set(shapes).size).toBe(REPORT_KINDS.length);
    for (const shape of shapes) expect(SHAPE_PATH[shape]).toMatch(/^M/);
  });

  it("colours a kind by the dimension it feeds, and marks the unscored one", () => {
    expect(REPORT_STYLE.parking.colour).toBe(REPORT_STYLE.narrow.colour); // both physical
    expect(REPORT_STYLE.furniture.colour).not.toBe(REPORT_STYLE.parking.colour); // economic
    expect(REPORT_STYLE.other.feeds).toBeNull();
  });
});
