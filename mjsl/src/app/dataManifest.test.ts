import { describe, expect, it } from "vitest";
import { fetchDataManifest, versionedUrl } from "./dataManifest.js";

describe("global data manifest", () => {
  it("appends the version without breaking an existing query string", () => {
    expect(versionedUrl("http://x/data.json", "abc")).toBe("http://x/data.json?v=abc");
    expect(versionedUrl("http://x/data.json?keep=1", "abc")).toBe("http://x/data.json?keep=1&v=abc");
    expect(versionedUrl("http://x/data.json", undefined)).toBe("http://x/data.json");
  });

  it("reads a valid manifest", async () => {
    const manifest = { generatedAt: "2026-11-23T00:00:00.000Z", version: "v1", files: { "amp/rent.json": "hash" } };
    const mock = (() => Promise.resolve(new Response(JSON.stringify(manifest)))) as typeof fetch;
    expect(await fetchDataManifest(mock)).toEqual(manifest);
  });

  it("returns null when the manifest is missing or malformed", async () => {
    const missing = (() => Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
    expect(await fetchDataManifest(missing)).toBeNull();

    const malformed = (() => Promise.resolve(new Response(JSON.stringify({ version: 1 })))) as typeof fetch;
    expect(await fetchDataManifest(malformed)).toBeNull();
  });
});
