import type { Map as MapLibreMap } from "maplibre-gl";
import type { Basemap } from "../map/basemaps.js";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension, type Zone, type ZoneScore } from "../../domain/zone/index.js";
import { BASEMAPS } from "../map/basemaps.js";
import { GRADIENT, zonesGeojson } from "../zone/zoneLayers.js";
import type { MapBounds, MapLayer } from "../zone/zoneStore.js";

export const PDF_TITLE = "Matrice de justice spatiale : Cas littoral marseillais";

const MAP_WIDTH_PX = 1600;
const MAP_HEIGHT_PX = 1110;
// North Arrow N by Jean-Marc Viglino (Font-GIS), CC BY 4.0.
const NORTH_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#0f172a" fill-rule="evenodd" d="M42.066 0v20h3.752V6.957L53.881 20h4.053V0h-3.752v13.355L45.996 0Zm5.57 26.688l-25.77 69.949c-.823 2.238 1.658 4.248 3.677 2.978L50 84.195l24.455 15.42c2.02 1.273 4.504-.738 3.68-2.978l-25.79-70c-.472-1.096-1.283-1.632-2.384-1.635s-2.017.856-2.324 1.686m-.136 14.83V79.86L29.1 91.463Z"/></svg>`;

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

interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

/**
 * Browsers pause WebGL and tile work for a background tab. A normal timeout
 * would reject a healthy export while that pause is in progress, so only count
 * time during which the document is actually visible.
 */
export function timeoutWhileVisible(
  onTimeout: () => void,
  durationMs: number,
  visibility: VisibilitySource = document,
): () => void {
  let remaining = durationMs;
  let startedAt: number | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let active = true;

  const clear = () => {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
  };
  const schedule = () => {
    if (!active || visibility.hidden) return;
    startedAt = Date.now();
    timeout = setTimeout(() => {
      timeout = undefined;
      active = false;
      visibility.removeEventListener("visibilitychange", changed);
      onTimeout();
    }, remaining);
  };
  const changed = () => {
    if (visibility.hidden) {
      if (startedAt !== undefined) remaining = Math.max(0, remaining - (Date.now() - startedAt));
      startedAt = undefined;
      clear();
    } else {
      schedule();
    }
  };

  visibility.addEventListener("visibilitychange", changed);
  schedule();
  return () => {
    active = false;
    clear();
    visibility.removeEventListener("visibilitychange", changed);
  };
}

export async function buildMapPdf(input: PdfMapExportInput, onProgress?: (message: string) => void): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const basemap = BASEMAPS.find((entry) => entry.id === input.basemapId) ?? BASEMAPS[0]!;
  const profileLabel = ZONE_CONFIG.profiles[input.profileId]?.label ?? input.profileId;
  const layers = orderedLayers(input.layers);
  const northArrowImage = await renderNorthArrow();

  for (const [index, layer] of layers.entries()) {
    onProgress?.(`Preparation de la carte ${index + 1} sur ${layers.length}...`);
    const rendered = await renderMap(layer, input, basemap.style);
    if (index > 0) pdf.addPage("a4", "landscape");
    drawPage(pdf, rendered.image, northArrowImage, layer, rendered.bounds, profileLabel, basemap.attribution);
  }

  return pdf.output("blob");
}

function renderNorthArrow(): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([NORTH_ARROW_SVG], { type: "image/svg+xml" }));
    image.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("L'indicateur nord n'a pas pu etre prepare."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("L'indicateur nord n'a pas pu etre prepare."));
    };
    image.src = url;
  });
}

async function renderMap(
  layer: MapLayer,
  input: PdfMapExportInput,
  style: Basemap["style"],
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

async function createMap(style: Basemap["style"], host: HTMLDivElement): Promise<MapLibreMap> {
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
    const cancelTimeout = timeoutWhileVisible(failed, 8000);
    function finish(error?: Error) {
      cancelTimeout();
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
    const cancelTimeout = timeoutWhileVisible(() => finish(new Error("Le fond de carte est encore en cours de chargement.")), 8000);
    function finish(error?: Error) {
      cancelTimeout();
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

function drawPage(pdf: Pdf, image: string, northArrowImage: string, layer: MapLayer, bounds: MapBounds, profileLabel: string, basemapAttribution: string) {
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
  drawNorthArrow(pdf, northArrowImage, mapX + 7, mapY + 7);
  drawScaleBar(pdf, mapX + 8, mapY + mapHeight - 9, mapWidth, bounds);
  drawLegend(pdf, legendX, 36);

  pdf.setFontSize(7);
  pdf.setTextColor("#475569");
  pdf.text(`Fond de carte : ${basemapAttribution}. Donnees et scores MJSL, ${new Date().toLocaleDateString("fr-FR")}.`, 12, 187);
  pdf.text("Indicateur nord : Font-GIS, Jean-Marc Viglino (CC BY 4.0).", 12, 190);
  pdf.text("Les couleurs indiquent un niveau relatif d'obstacles ; une zone sans donnees n'est pas une zone sans obstacle.", 12, 195);
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
  pdf.setTextColor("#ffffff");
  pdf.setFontSize(6);
  pdf.text("0", x + 2, y + 13.5, { align: "center" });
  pdf.text("1", x + 46, y + 13.5, { align: "center" });
  pdf.setTextColor("#334155");
  pdf.setFontSize(7);
  pdf.text("inaccessible", x, y + 20);
  pdf.text("capacitant", x + 48, y + 20, { align: "right" });

  pdf.setFillColor(ZONE_CONFIG.classes.colours.none);
  pdf.rect(x, y + 27, 8, 5, "F");
  pdf.setDrawColor("#64748b");
  pdf.setLineDashPattern([1, 1], 0);
  pdf.rect(x, y + 27, 8, 5, "S");
  pdf.setLineDashPattern([], 0);
  pdf.setTextColor("#334155");
  pdf.setFontSize(8);
  pdf.text("Pas assez de donnees", x + 11, y + 31);
}

function drawNorthArrow(pdf: Pdf, image: string, x: number, y: number) {
  pdf.addImage(image, "PNG", x, y, 8, 8);
}

function drawScaleBar(pdf: Pdf, x: number, y: number, mapWidthMm: number, bounds: MapBounds) {
  const meanLatitude = (bounds[1] + bounds[3]) / 2;
  const metersAcross = Math.abs(bounds[2] - bounds[0]) * 111_320 * Math.cos((meanLatitude * Math.PI) / 180);
  const meters = scaleDistance(metersAcross);
  const width = (meters / metersAcross) * mapWidthMm;
  pdf.setDrawColor("#0f172a");
  pdf.line(x, y, x + width, y);
  pdf.line(x, y - 2.5, x, y + 2.5);
  pdf.line(x + width, y - 2.5, x + width, y + 2.5);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor("#0f172a");
  pdf.text(formatDistance(meters), x + width / 2, y - 3.5, { align: "center" });
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}
