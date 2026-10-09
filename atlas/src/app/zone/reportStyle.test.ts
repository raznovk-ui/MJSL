import { describe, expect, it } from "vitest";
import { REPORT_KINDS, REPORT_STYLE, SHAPE_PATH } from "./reportStyle.js";

describe("report symbols", () => {
  it("gives every kind its own shape, so the kind never depends on colour alone", () => {
    const shapes = REPORT_KINDS.map((k) => REPORT_STYLE[k].shape);
    expect(new Set(shapes).size).toBe(REPORT_KINDS.length);
    for (const shape of shapes) expect(SHAPE_PATH[shape]).toMatch(/^M/);
  });

  it("draws the reports in shades of the blue-to-purple palette, away from the green-to-red of the zones", () => {
    for (const kind of REPORT_KINDS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(REPORT_STYLE[kind].colour.slice(i, i + 2), 16)) as [number, number, number];
      expect(b).toBeGreaterThan(g); // never green
      expect(b).toBeGreaterThanOrEqual(r - 10); // blue or purple, never a warm colour
    }
    expect(new Set(REPORT_KINDS.map((k) => REPORT_STYLE[k].colour)).size).toBe(REPORT_KINDS.length);
  });

  it("marks the kind that is counted but not scored", () => {
    expect(REPORT_STYLE.other.feeds).toBeNull();
    expect(REPORT_STYLE.parking.feeds).not.toBeNull();
  });
});

import { REPORT_TYPE_OPTIONS } from "./reportStyle.js";
import { ZONE_CONFIG, reportKind } from "../../domain/zone/index.js";

describe("the types a person can choose", () => {
  it("are counted in the kind the data already uses for them", () => {
    expect(reportKind("Stationnement gênant fréquent", ZONE_CONFIG)).toBe("parking");
    expect(reportKind("Trottoir étroit ou absent", ZONE_CONFIG)).toBe("narrow");
    expect(reportKind("Chantier/péril", ZONE_CONFIG)).toBe("works");
    expect(reportKind("Encombrants fréquents", ZONE_CONFIG)).toBe("works");
    expect(reportKind("Terrasses, mobilier", ZONE_CONFIG)).toBe("furniture");
    expect(reportKind("Autre", ZONE_CONFIG)).toBe("other");
  });

  it("offer every kind of report at least once", () => {
    const kinds = new Set(REPORT_TYPE_OPTIONS.map((t) => reportKind(t, ZONE_CONFIG)));
    expect([...kinds].sort()).toEqual(["furniture", "narrow", "other", "parking", "works"]);
  });
});
