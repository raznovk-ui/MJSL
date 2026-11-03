import { layerSubtitle, orderedLayers, PDF_TITLE, scaleDistance } from "./pdfMap.js";

describe("PDF map export helpers", () => {
  it("uses the approved study title and labels both combined and dimension maps", () => {
    expect(PDF_TITLE).toBe("Matrice de justice spatiale : Cas littoral marseillais");
    expect(layerSubtitle("combined", "Mobilite reduite")).toBe("Score combine · Profil : Mobilite reduite");
    expect(layerSubtitle("physical", "unused")).toBe("D1 · Physique et continuite");
  });

  it("puts selected pages into their stable combined, D1 to D6 order", () => {
    expect(orderedLayers(["political", "physical", "combined"])).toEqual(["combined", "physical", "political"]);
  });

  it("chooses a readable scale-bar distance within a quarter of the map", () => {
    expect(scaleDistance(5300)).toBe(1000);
    expect(scaleDistance(900)).toBe(200);
  });
});
