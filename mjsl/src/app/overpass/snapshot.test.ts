import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { decodeSnapshot, fetchSnapshot, gzipText, trimCollection } from "./snapshot.js";

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
});
