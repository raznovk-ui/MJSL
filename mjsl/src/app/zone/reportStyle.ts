import type { ReportKind } from "../../domain/zone/index.js";

type ReportShape = "square" | "triangle" | "diamond" | "circle" | "cross";

/** SVG path data, in a 20 x 20 box: the same outline is drawn on the map and in the legend. */
export const SHAPE_PATH: Record<ReportShape, string> = {
  square: "M4 4h12v12H4z",
  triangle: "M10 2.5L17.5 16.5H2.5z",
  diamond: "M10 1.5L18.5 10L10 18.5L1.5 10z",
  circle: "M10 3a7 7 0 1 0 0.001 0z",
  cross: "M8 3h4v5h5v4h-5v5H8v-5H3V8h5z",
};

interface ReportStyle {
  label: string;
  shape: ReportShape;
  /** A shade of the blue-to-purple palette: it stands apart from the green-to-red of the zones underneath. */
  colour: string;
  /** The dimension it feeds, in words; null for reports that are counted but not scored. */
  feeds: string | null;
}

/** One symbol per kind of report: the shape tells the kind, never the colour alone. */
export const REPORT_STYLE: Record<ReportKind, ReportStyle> = {
  parking: { label: "Stationnement genant", shape: "square", colour: "#6b00d7", feeds: "D1 Physique" },
  narrow: { label: "Trottoir etroit ou absent", shape: "triangle", colour: "#3e00b3", feeds: "D1 Physique" },
  works: { label: "Chantier, peril, encombrants", shape: "diamond", colour: "#a230ed", feeds: "D1 Physique" },
  furniture: { label: "Terrasses, mobilier", shape: "circle", colour: "#4a90d9", feeds: "D4 Economique" },
  other: { label: "Autre / sans type", shape: "cross", colour: "#d391fa", feeds: null },
};

export const REPORT_KINDS = Object.keys(REPORT_STYLE) as ReportKind[];

/** Draws a kind's symbol into an RGBA image for MapLibre (white halo and dark edge, so it reads on any zone colour). */
export function reportIcon(kind: ReportKind, size = 40): { width: number; height: number; data: Uint8ClampedArray } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(size / 20, size / 20);
  const path = new Path2D(SHAPE_PATH[REPORT_STYLE[kind].shape]);
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke(path);
  ctx.fillStyle = REPORT_STYLE[kind].colour;
  ctx.fill(path);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = "#111827";
  ctx.stroke(path);
  const image = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}

/**
 * The types a person can choose, in the data's own wording, so a new report is counted
 * exactly like the existing ones (reportKind matches them by their words).
 */
export const REPORT_TYPE_OPTIONS: string[] = [
  "Stationnement gênant fréquent",
  "Trottoir étroit ou absent",
  "Chantier/péril",
  "Encombrants fréquents",
  "Terrasses, mobilier",
  "Autre",
];
