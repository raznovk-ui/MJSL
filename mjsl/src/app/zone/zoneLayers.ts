import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { ZONE_CONFIG, classify, dimensionScoreOf, reportKind, type Report, type ReportKind, type Zone, type ZoneConfig, type ZoneScore } from "../../domain/zone/index.js";
import { REPORT_KINDS, reportIcon } from "./reportStyle.js";
import type { MapLayer } from "./zoneStore.js";

const ZONE_SOURCE = "zones";
const REPORT_SOURCE = "reports";
const PENDING_SOURCE = "report-pending";

/** Tracks which map instance already has the static zone polygon geometries uploaded in ZONE_SOURCE. */
const uploadedZoneGeometryKey = new WeakMap<MapLibreMap, string>();

/**
 * One green-to-red scale for every layer: 0 = total obstacle (red), 1 = none (green).
 * The same scale is used for the combined score and for each dimension, so colours
 * mean the same thing everywhere.
 */
export const GRADIENT: [number, string][] = [
  [0.35, "#b91c1c"],
  [0.5, "#e8590c"],
  [0.6, "#eab308"],
  [0.75, "#15803d"],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function gradientColour(value: number): string {
  const first = GRADIENT[0]!;
  const last = GRADIENT[GRADIENT.length - 1]!;
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < GRADIENT.length; i += 1) {
    const [x1, c1] = GRADIENT[i]!;
    if (value <= x1) {
      const [x0, c0] = GRADIENT[i - 1]!;
      const t = (value - x0) / (x1 - x0);
      const a = hex(c0);
      const b = hex(c1);
      return "#" + a.map((n, k) => Math.round(n + (b[k]! - n) * t).toString(16).padStart(2, "0")).join("");
    }
  }
  return last[1];
}

/** The value drawn for a zone on a layer: its combined score, or its score for one dimension. */
export function layerValue(score: ZoneScore | undefined, layer: MapLayer): number | null {
  if (!score) return null;
  return layer === "combined" ? score.score : dimensionScoreOf(score, layer);
}

export function zonesGeojson(zones: Zone[], scores: Record<string, ZoneScore> | undefined, config: ZoneConfig, layer: MapLayer): FeatureCollection {
  const features: Feature[] = zones.map((zone) => {
    const value = layerValue(scores?.[zone.id], layer);
    const cls = classify(value, config);
    return {
      type: "Feature",
      id: zone.id,
      properties: {
        id: zone.id,
        name: zone.name,
        cls,
        colour: value === null ? config.classes.colours.none : gradientColour(value),
        value,
      },
      geometry: zone.geometry,
    };
  });
  return { type: "FeatureCollection", features };
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function reportsGeojson(reports: Report[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: reports.map((r) => ({ type: "Feature", properties: { type: r.type, kind: reportKind(r.type, ZONE_CONFIG) }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })),
  };
}

/** Idempotent: safe to call on every style load and every data change. */
export function ensureZoneLayers(instance: MapLibreMap) {
  if (!instance.getSource(ZONE_SOURCE)) {
    uploadedZoneGeometryKey.delete(instance);
  }
  for (const id of [ZONE_SOURCE, REPORT_SOURCE, PENDING_SOURCE]) if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: EMPTY });

  // The point being placed, until it is saved or cancelled: a white disc with a violet ring.
  if (!instance.getLayer("report-pending")) {
    instance.addLayer({
      id: "report-pending", type: "circle", source: PENDING_SOURCE,
      paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-stroke-color": "#6b00d7", "circle-stroke-width": 3 },
    });
  }
  if (!instance.getLayer("zone-fill")) {
    instance.addLayer({
      id: "zone-fill", type: "fill", source: ZONE_SOURCE,
      paint: { "fill-color": ["get", "colour"], "fill-opacity": ["case", ["==", ["get", "cls"], "none"], 0.2, 0.62] },
    });
  }
  if (!instance.getLayer("zone-outline")) {
    instance.addLayer({ id: "zone-outline", type: "line", source: ZONE_SOURCE, filter: ["!=", ["get", "cls"], "red"], paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.9 } });
  }
  // Red is dashed as well as red: colour is never the only cue. A separate layer, since
  // line-dasharray cannot be data-driven.
  if (!instance.getLayer("zone-outline-red")) {
    instance.addLayer({
      id: "zone-outline-red", type: "line", source: ZONE_SOURCE, filter: ["==", ["get", "cls"], "red"],
      paint: { "line-color": "#7f1d1d", "line-width": 2.5, "line-dasharray": [2, 1.5] },
    });
  }
  if (!instance.getLayer("zone-hover")) {
    instance.addLayer({
      id: "zone-hover", type: "line", source: ZONE_SOURCE, filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#4338ca", "line-width": 2.5 },
    });
  }
  if (!instance.getLayer("zone-selected")) {
    instance.addLayer({
      id: "zone-selected", type: "line", source: ZONE_SOURCE, filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#111827", "line-width": 4 },
    });
  }
  // One icon per kind of report, drawn once (and again after a basemap change, which drops them).
  for (const kind of REPORT_KINDS) {
    if (!instance.hasImage(`report-${kind}`)) instance.addImage(`report-${kind}`, reportIcon(kind), { pixelRatio: 2 });
  }
  if (!instance.getLayer("report-points")) {
    instance.addLayer({
      id: "report-points", type: "symbol", source: REPORT_SOURCE,
      layout: {
        "icon-image": ["concat", "report-", ["get", "kind"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.45, 14, 0.7, 17, 1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }
}

export function syncZoneData(
  instance: MapLibreMap,
  zones: Zone[],
  scores: Record<string, ZoneScore> | undefined,
  config: ZoneConfig,
  layer: MapLayer,
) {
  ensureZoneLayers(instance);
  const source = instance.getSource(ZONE_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;

  if (zones.length === 0) {
    uploadedZoneGeometryKey.delete(instance);
    source.setData(EMPTY);
    return;
  }

  const geomKey = `${zones.length}:${zones[0]?.id ?? ""}:${zones[zones.length - 1]?.id ?? ""}`;
  if (uploadedZoneGeometryKey.get(instance) !== geomKey) {
    // First upload for this map style: upload full polygon geometries once
    source.setData(zonesGeojson(zones, scores, config, layer));
    uploadedZoneGeometryKey.set(instance, geomKey);
  }

  // Fast GPU style/filter update (< 1 ms): updates zone colours and red dashed outlines
  // without re-transferring or re-tessellating 76,957 polygon vertices in WebGL.
  if (typeof instance.setPaintProperty === "function" && instance.getLayer("zone-fill")) {
    const colorPairs: string[] = [];
    const noneIds: string[] = [];
    const redIds: string[] = [];
    for (const zone of zones) {
      const value = layerValue(scores?.[zone.id], layer);
      const cls = classify(value, config);
      const colour = value === null ? config.classes.colours.none : gradientColour(value);
      colorPairs.push(zone.id, colour);
      if (cls === "none") noneIds.push(zone.id);
      else if (cls === "red") redIds.push(zone.id);
    }
    const fillColorExpr: ExpressionSpecification =
      colorPairs.length > 0
        ? (["match", ["get", "id"], ...colorPairs, config.classes.colours.none] as unknown as ExpressionSpecification)
        : (["get", "colour"] as unknown as ExpressionSpecification);
    const fillOpacityExpr: ExpressionSpecification = [
      "case",
      ["in", ["get", "id"], ["literal", noneIds]],
      0.2,
      0.62,
    ] as unknown as ExpressionSpecification;

    instance.setPaintProperty("zone-fill", "fill-color", fillColorExpr);
    instance.setPaintProperty("zone-fill", "fill-opacity", fillOpacityExpr);

    if (typeof instance.setFilter === "function") {
      if (instance.getLayer("zone-outline")) {
        instance.setFilter("zone-outline", ["!", ["in", ["get", "id"], ["literal", redIds]]] as FilterSpecification);
      }
      if (instance.getLayer("zone-outline-red")) {
        instance.setFilter("zone-outline-red", ["in", ["get", "id"], ["literal", redIds]] as FilterSpecification);
      }
    }
  }
}

export function syncReportsData(instance: MapLibreMap, reports: Report[], visible: boolean) {
  ensureZoneLayers(instance);
  (instance.getSource(REPORT_SOURCE) as GeoJSONSource | undefined)?.setData(
    visible ? reportsGeojson(reports) : EMPTY,
  );
}

export function syncPendingData(instance: MapLibreMap, pending: { lon: number; lat: number } | null) {
  ensureZoneLayers(instance);
  (instance.getSource(PENDING_SOURCE) as GeoJSONSource | undefined)?.setData(
    pending
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pending.lon, pending.lat] } }] }
      : EMPTY,
  );
}

export function syncHoveredZone(instance: MapLibreMap, hoveredZoneId: string | null) {
  if (instance.getLayer("zone-hover")) {
    instance.setFilter("zone-hover", ["==", ["get", "id"], hoveredZoneId ?? ""]);
  }
}

export function syncSelectedZone(instance: MapLibreMap, selectedZoneId: string | null) {
  if (instance.getLayer("zone-selected")) {
    instance.setFilter("zone-selected", ["==", ["get", "id"], selectedZoneId ?? ""]);
  }
}

export function syncReportFilter(instance: MapLibreMap, reportKinds: Record<ReportKind, boolean>) {
  if (instance.getLayer("report-points")) {
    instance.setFilter("report-points", ["in", ["get", "kind"], ["literal", REPORT_KINDS.filter((k) => reportKinds[k])]]);
  }
}

export function syncZoneVisibility(instance: MapLibreMap, visible: boolean, reportsVisible: boolean) {
  const visibility = visible ? "visible" : "none";
  for (const id of ["zone-fill", "zone-outline", "zone-outline-red", "zone-selected", "zone-hover"]) {
    if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", visibility);
  }
  if (instance.getLayer("report-points")) {
    instance.setLayoutProperty("report-points", "visibility", reportsVisible ? "visible" : "none");
  }
}

export interface ZoneView {
  zones: Zone[];
  scores: Record<string, ZoneScore> | undefined;
  visible: boolean;
  layer: MapLayer;
  selectedZoneId: string | null;
  reports: Report[];
  reportsVisible: boolean;
  reportKinds: Record<ReportKind, boolean>;
  pending: { lon: number; lat: number } | null;
}

export function syncZoneLayers(instance: MapLibreMap, view: ZoneView, config: ZoneConfig) {
  syncZoneData(instance, view.zones, view.scores, config, view.layer);
  syncReportsData(instance, view.reports, view.reportsVisible);
  syncPendingData(instance, view.pending);
  syncReportFilter(instance, view.reportKinds);
  syncSelectedZone(instance, view.selectedZoneId);
  syncZoneVisibility(instance, view.visible, view.reportsVisible);
}
