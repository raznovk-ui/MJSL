import { describe, expect, it } from "vitest";
import { locateWithGoogle, roundForPrivacy } from "./locate.js";

const reply = (body: unknown, status = 200) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

describe("locating a person", () => {
  it("rounds positions to about 10 m before they are used", () => {
    expect(roundForPrivacy(43.2965123)).toBe(43.2965);
    expect(roundForPrivacy(5.3698777)).toBe(5.3699);
  });

  it("reads Google's answer, rounded, with its accuracy", async () => {
    const found = await locateWithGoogle("key", reply({ location: { lat: 43.29651, lng: 5.36988 }, accuracy: 48.7 }));
    expect(found).toEqual({ lat: 43.2965, lon: 5.3699, accuracyM: 49, source: "google" });
  });

  it("fails in plain words when Google gives no position or an error", async () => {
    await expect(locateWithGoogle("key", reply({}))).rejects.toThrow(/pas renvoye de position/);
    await expect(locateWithGoogle("key", reply({ error: {} }, 403))).rejects.toThrow(/erreur 403/);
  });
});
