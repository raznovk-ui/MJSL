import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension, type Zone, type ZoneScore } from "../../domain/zone/index.js";
import { BASEMAPS } from "../map/basemaps.js";
import { GRADIENT, zonesGeojson } from "../zone/zoneLayers.js";
import type { MapBounds, MapLayer } from "../zone/zoneStore.js";

export const PDF_TITLE = "Matrice de justice spatiale : Cas littoral marseillais";

const MAP_WIDTH_PX = 1600;
const MAP_HEIGHT_PX = 1110;

export interface PdfMapExportInput {
  layers: MapLayer[];
  bounds: MapBounds;
  basemapId: string;
  profileId: string;
  zones: Zone[];
  scores: Record<string, ZoneScore>;
}

export function layerSubtitle(layer: MapLayer, profileLabel: string): string {
  if (layer === "combined") return `Score combine · Profil : ${profileLabel}`;
  const meta = dimension(layer);
  return `${meta.mjslCode} · ${meta.label}`;
}

export function orderedLayers(layers: Iterable<MapLayer>): MapLayer[] {
  const selected = new Set(layers);
  return (["combined", ...DIMENSION_KEYS] as MapLayer[]).filter((layer) => selected.has(layer));
}

/** A 1/2/5 scale bar that occupies no more than a quarter of the printed map. */
export function scaleDistance(metersAcross: number): number {
  const target = metersAcross / 4;
  if (!Number.isFinite(target) || target <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const factor of [5, 2, 1]) {
    const candidate = factor * magnitude;
    if (candidate <= target) return candidate;
  }
  return magnitude / 10;
}

export async function buildMapPdf(input: PdfMapExportInput, onProgress?: (message: string) => void): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const basemap = BASEMAPS.find((entry) => entry.id === input.basemapId) ?? BASEMAPS[0]!;
  const profileLabel = ZONE_CONFIG.profiles[input.profileId]?.label ?? input.profileId;
  const layers = orderedLayers(input.layers);

  for (const [index, layer] of layers.entries()) {
    onProgress?.(`Preparation de la carte ${index + 1} sur ${layers.length}...`);
    const rendered = await renderMap(layer, input, basemap.style);
    if (index > 0) pdf.addPage("a4", "landscape");
    drawPage(pdf, rendered.image, layer, rendered.bounds, profileLabel, basemap.attribution);
  }

  return pdf.output("blob");
}

async function renderMap(
  layer: MapLayer,
  input: PdfMapExportInput,
  style: StyleSpecification,
): Promise<{ image: string; bounds: MapBounds }> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${MAP_WIDTH_PX}px;height:${MAP_HEIGHT_PX}px;pointer-events:none;`;
  document.body.append(host);

  let map: MapLibreMap | undefined;
  try {
    map = await createMap(style, host);
    await waitForLoad(map);
    const collection = zonesGeojson(input.zones, input.scores, ZONE_CONFIG, layer);
    map.addSource("pdf-zones", { type: "geojson", data: collection });
    map.addLayer({
      id: "pdf-zones-fill",
      type: "fill",
      source: "pdf-zones",
      paint: { "fill-color": ["get", "colour"], "fill-opacity": ["case", ["==", ["get", "cls"], "none"], 0.2, 0.62] },
    });
    map.addLayer({
      id: "pdf-zones-outline",
      type: "line",
      source: "pdf-zones",
      filter: ["!=", ["get", "cls"], "red"],
      paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "pdf-zones-outline-red",
      type: "line",
      source: "pdf-zones",
      filter: ["==", ["get", "cls"], "red"],
      paint: { "line-color": "#7f1d1d", "line-width": 2.5, "line-dasharray": [2, 1.5] },
    });
    map.fitBounds(
      [[input.bounds[0], input.bounds[1]], [input.bounds[2], input.bounds[3]]],
      { animate: false, padding: 0 },
    );
    await waitForIdle(map);
    const renderedBounds = map.getBounds();
    return {
      image: map.getCanvas().toDataURL("image/png"),
      // fitBounds expands an axis to fit the page aspect ratio, so use the
      // actual bounds rather than the requested viewport for the scale bar.
      bounds: [renderedBounds.getWest(), renderedBounds.getSouth(), renderedBounds.getEast(), renderedBounds.getNorth()],
    };
  } finally {
    map?.remove();
    host.remove();
  }
}

async function createMap(style: StyleSpecification, host: HTMLDivElement): Promise<MapLibreMap> {
  const maplibregl = await import("maplibre-gl");
  return new maplibregl.Map({
    container: host,
    style,
    attributionControl: false,
    interactive: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
}

function waitForLoad(map: MapLibreMap): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const loaded = () => finish();
    const failed = () => finish(new Error("Le fond de carte n'a pas pu etre charge."));
    const timeout = window.setTimeout(failed, 8000);
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      map.off("load", loaded);
      map.off("error", failed);
      if (error) reject(error);
      else resolve();
    }
    map.once("load", loaded);
    map.once("error", failed);
  });
}

function waitForIdle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const idle = () => finish();
    const timeout = window.setTimeout(() => finish(new Error("Le fond de carte est encore en cours de chargement.")), 8000);
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      map.off("idle", idle);
      if (error) reject(error);
      else resolve();
    }
    map.once("idle", idle);
  });
}

type Pdf = {
  addImage: (image: string, format: "PNG", x: number, y: number, width: number, height: number) => void;
  addPage: (format: "a4", orientation: "landscape") => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  output: (type: "blob") => Blob;
  rect: (x: number, y: number, width: number, height: number, style?: "F" | "S" | "FD" | "DF") => void;
  setDrawColor: (colour: string) => void;
  setFillColor: (colour: string) => void;
  setFont: (font: string, style?: "normal" | "bold") => void;
  setFontSize: (size: number) => void;
  setLineDashPattern: (dashArray: number[], dashPhase: number) => void;
  setTextColor: (colour: string) => void;
  text: (text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }) => void;
  triangle: (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: "F" | "S" | "FD" | "DF") => void;
};

function drawPage(pdf: Pdf, image: string, layer: MapLayer, bounds: MapBounds, profileLabel: string, basemapAttribution: string) {
  const mapX = 76;
  const mapY = 30;
  const mapWidth = 209;
  const mapHeight = 145;
  const legendX = 12;

  pdf.setTextColor("#0f172a");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(PDF_TITLE, 12, 14);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor("#334155");
  pdf.text(layerSubtitle(layer, profileLabel), 12, 21);
  pdf.addImage(image, "PNG", mapX, mapY, mapWidth, mapHeight);
  drawNorthArrow(pdf, mapX + 12, mapY + 12);
  drawScaleBar(pdf, mapX + 8, mapY + mapHeight - 9, mapWidth, bounds);
  drawLegend(pdf, legendX, 36);

  pdf.setFontSize(7);
  pdf.setTextColor("#475569");
  pdf.text(`Fond de carte : ${basemapAttribution}. Donnees et scores MJSL, ${new Date().toLocaleDateString("fr-FR")}.`, 12, 187);
  pdf.text("Les couleurs indiquent un niveau relatif d'obstacles ; une zone sans donnees n'est pas une zone sans obstacle.", 12, 192);
}

function drawLegend(pdf: Pdf, x: number, y: number) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor("#0f172a");
  pdf.text("Legende", x, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor("#334155");
  pdf.text("Score d'accessibilite", x, y + 7);

  const width = 48 / GRADIENT.length;
  for (const [index, [, colour]] of GRADIENT.entries()) {
    pdf.setFillColor(colour);
    pdf.rect(x + index * width, y + 10, width + 0.1, 5, "F");
  }
  pdf.setFontSize(7);
  pdf.text("obstacles eleves", x, y + 20);
  pdf.text("peu d'obstacles", x + 48, y + 20, { align: "right" });

  pdf.setFillColor(ZONE_CONFIG.classes.colours.none);
  pdf.rect(x, y + 27, 8, 5, "F");
  pdf.setDrawColor("#64748b");
  pdf.setLineDashPattern([1, 1], 0);
  pdf.rect(x, y + 27, 8, 5, "S");
  pdf.setLineDashPattern([], 0);
  pdf.setTextColor("#334155");
  pdf.setFontSize(8);
  pdf.text("Pas assez de donnees", x + 11, y + 31);
  pdf.setFontSize(7);
  pdf.text("0 = obstacle total", x, y + 40);
  pdf.text("1 = aucun obstacle", x, y + 45);
}

function drawNorthArrow(pdf: Pdf, x: number, y: number) {
  // A modest white panel keeps the arrow legible on both a pale street map and
  // a dark score polygon without competing with the mapped result.
  pdf.setFillColor("#ffffff");
  pdf.setDrawColor("#0f172a");
  pdf.rect(x - 5, y - 7, 10, 14, "FD");
  pdf.setTextColor("#0f172a");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("N", x, y - 2.5, { align: "center" });
  pdf.setFillColor("#0f172a");
  pdf.setDrawColor("#0f172a");
  pdf.triangle(x, y, x - 2.75, y + 6, x + 2.75, y + 6, "F");
}

function drawScaleBar(pdf: Pdf, x: number, y: number, mapWidthMm: number, bounds: MapBounds) {
  const meanLatitude = (bounds[1] + bounds[3]) / 2;
  const metersAcross = Math.abs(bounds[2] - bounds[0]) * 111_320 * Math.cos((meanLatitude * Math.PI) / 180);
  const meters = scaleDistance(metersAcross);
  const width = (meters / metersAcross) * mapWidthMm;
  pdf.setDrawColor("#0f172a");
  pdf.setFillColor("#ffffff");
  pdf.rect(x, y - 3, width, 3, "FD");
  pdf.setFillColor("#0f172a");
  pdf.rect(x, y - 3, width / 2, 3, "F");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor("#0f172a");
  pdf.text("0", x, y + 4);
  pdf.text(formatDistance(meters), x + width, y + 4, { align: "right" });
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}
