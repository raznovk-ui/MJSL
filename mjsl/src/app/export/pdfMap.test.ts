import { layerSubtitle, orderedLayers, PDF_TITLE, scaleDistance, timeoutWhileVisible } from "./pdfMap.js";

function fakeVisibility() {
  const listeners = new Set<() => void>();
  let hidden = false;
  return {
    get hidden() {
      return hidden;
    },
    addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) => listeners.delete(listener),
    setHidden: (next: boolean) => {
      hidden = next;
      for (const listener of listeners) listener();
    },
  };
}

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

  it("does not consume the rendering timeout while the browser tab is hidden", () => {
    vi.useFakeTimers();
    const visibility = fakeVisibility();
    const timedOut = vi.fn();
    const cancel = timeoutWhileVisible(timedOut, 8_000, visibility);

    vi.advanceTimersByTime(3_000);
    visibility.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(timedOut).not.toHaveBeenCalled();

    visibility.setHidden(false);
    vi.advanceTimersByTime(4_999);
    expect(timedOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(timedOut).toHaveBeenCalledOnce();
    cancel();
    vi.useRealTimers();
  });
});
