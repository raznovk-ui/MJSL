import type { Map as MapLibreMap } from "maplibre-gl";
import { SHAPE_PATH, type ReportShape } from "../zone/reportStyle.js";

/**
 * The "Indices OSM" overlay: physical features that OpenStreetMap records. It is NOT the
 * citizens' reports, so it has its own look: hollow outlines (the reports are filled), and
 * shades of blue and purple (never the red of "bad" zones).
 */
export type OsmKind = "steps" | "elevator" | "kerb" | "tactile";

export const OSM_STYLE: Record<OsmKind, { label: string; colour: string; shape: ReportShape }> = {
  steps: { label: "Escaliers (OSM)", colour: "#1d4ed8", shape: "triangle" },
  elevator: { label: "Ascenseur (OSM)", colour: "#6d28d9", shape: "square" },
  kerb: { label: "Bordure (OSM)", colour: "#0e7490", shape: "diamond" },
  tactile: { label: "Bandes podotactiles (OSM)", colour: "#4338ca", shape: "circle" },
};

export const OSM_KINDS = Object.keys(OSM_STYLE) as OsmKind[];

/** The kind of an OSM feature, from its tags. */
export function osmKind(tags: Record<string, unknown>): OsmKind {
  if (tags.highway === "elevator") return "elevator";
  if (tags.highway === "steps") return "steps";
  if (tags.tactile_paving) return "tactile";
  return "kerb";
}

/** A hollow symbol in the kind's colour, with a white halo so it reads on any basemap. */
export function osmIcon(kind: OsmKind, size = 40): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(size / 20, size / 20);
  const path = new Path2D(SHAPE_PATH[OSM_STYLE[kind].shape]);
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke(path);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = OSM_STYLE[kind].colour;
  ctx.stroke(path);
  const image = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}

/** Adds the four symbols to the map (again after a basemap change, which drops them). */
export function ensureOsmIcons(instance: MapLibreMap): void {
  for (const kind of OSM_KINDS) {
    if (!instance.hasImage(`osm-${kind}`)) instance.addImage(`osm-${kind}`, osmIcon(kind), { pixelRatio: 2 });
  }
}
