import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { decodeSnapshot, fetchSnapshot, fetchSnapshotManifest, gzipText, trimCollection } from "./snapshot.js";

const sample: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "way/1",
      properties: { osm_id: "way/1", highway: "footway", name: "Rue X", "addr:street": "ignored", note: "ignored", wheelchair: "" },
      geometry: { type: "LineString", coordinates: [[5.3512345678, 43.2812345678], [5.3522345678, 43.2822345678]] },
    },
  ],
};

describe("OSM snapshots", () => {
  it("keeps only the tags the app reads and rounds coordinates to about 10 cm", () => {
    const [f] = trimCollection(sample).features;
    expect(Object.keys(f!.properties!).sort()).toEqual(["highway", "name", "osm_id"]);
    expect((f!.geometry as { coordinates: number[][] }).coordinates[0]).toEqual([5.351235, 43.281235]);
  });

  it("round-trips through gzip", async () => {
    const bytes = await gzipText(JSON.stringify(sample));
    const back = await decodeSnapshot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(back?.features).toHaveLength(1);
  });

  it("reads a file the server already decompressed, and rejects HTML", async () => {
    const plain = new TextEncoder().encode(JSON.stringify(sample));
    expect((await decodeSnapshot(plain.buffer as ArrayBuffer))?.features).toHaveLength(1);
    const html = new TextEncoder().encode("<!doctype html><html></html>");
    expect(await decodeSnapshot(html.buffer as ArrayBuffer)).toBeNull();
  });

  it("returns null for a missing file or a network error, so the caller can fall back", async () => {
    expect(await fetchSnapshot("x", (() => Promise.resolve(new Response("", { status: 404 }))) as typeof fetch)).toBeNull();
    expect(await fetchSnapshot("x", (() => Promise.reject(new Error("offline"))) as typeof fetch)).toBeNull();
  });

  it("revalidates a snapshot when forceReload is set", async () => {
    let seen: RequestInit | undefined;
    const mock = ((_: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response(JSON.stringify(sample)));
    }) as unknown as typeof fetch;
    expect(await fetchSnapshot("reload-test", mock, { forceReload: true })).not.toBeNull();
    expect(seen?.cache).toBe("no-cache");
  });

  it("appends the global data version to a snapshot URL", async () => {
    let url = "";
    const mock = ((input: unknown) => {
      url = String(input);
      return Promise.resolve(new Response(JSON.stringify(sample)));
    }) as unknown as typeof fetch;
    expect(await fetchSnapshot("versioned-test", mock, { dataVersion: "v1" })).not.toBeNull();
    expect(url).toContain("?v=v1");
  });

  it("reads the snapshot manifest and rejects a missing or malformed one", async () => {
    const manifest = { generatedAt: "2026-11-22T00:00:00.000Z", version: "v1", files: { r0c0: "abc" } };
    const ok = (() => Promise.resolve(new Response(JSON.stringify(manifest)))) as typeof fetch;
    expect(await fetchSnapshotManifest(ok)).toEqual(manifest);

    let seen: RequestInit | undefined;
    const revalidated = ((_: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response(JSON.stringify(manifest)));
    }) as unknown as typeof fetch;
    expect(await fetchSnapshotManifest(revalidated, { forceReload: true })).toEqual(manifest);
    expect(seen?.cache).toBe("no-cache");

    const missing = (() => Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
    expect(await fetchSnapshotManifest(missing)).toBeNull();

    const malformed = (() => Promise.resolve(new Response(JSON.stringify({ version: 1 })))) as typeof fetch;
    expect(await fetchSnapshotManifest(malformed)).toBeNull();
  });
});
