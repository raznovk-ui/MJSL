import { describe, expect, it } from "vitest";
import { labelFromAddress, reversePlace } from "./nominatimClient.js";

const reply = (address: Record<string, string>) =>
  Promise.resolve(new Response(JSON.stringify({ address }), { status: 200 }));

describe("nominatim client", () => {
  it("builds a short French place label", () => {
    expect(labelFromAddress({ neighbourhood: "Endoume", city_district: "7e Arrondissement" })).toBe("Endoume, 7e Arrondissement");
    expect(labelFromAddress({ road: "Corniche Kennedy" })).toBe("Corniche Kennedy");
    expect(labelFromAddress(undefined)).toBeNull();
  });

  it("spaces requests at least one second apart, one at a time", async () => {
    let clock = 10_000;
    const sleeps: number[] = [];
    const calls: number[] = [];
    const fetchImpl = ((url: URL) => {
      calls.push(clock);
      expect(url.hostname).toBe("nominatim.openstreetmap.org");
      expect(url.searchParams.get("zoom")).toBe("16");
      return reply({ suburb: "Vieux-Port" });
    }) as unknown as typeof fetch;
    const sleep = async (ms: number) => { sleeps.push(ms); clock += ms; };
    const now = () => clock;
    // Different 100 m cells so the cache cannot answer the second call.
    await Promise.all([
      reversePlace(43.28, 5.35, fetchImpl, now, sleep),
      reversePlace(43.29, 5.36, fetchImpl, now, sleep),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(1000);
  });
});
