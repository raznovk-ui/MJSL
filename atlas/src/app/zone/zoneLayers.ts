import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { ZONE_CONFIG, dimensionScoreOf, reportKind, type Report, type ReportKind, type Zone, type ZoneConfig, type ZoneScore } from "../../domain/zone/index.js";
import { REPORT_KINDS, reportIcon } from "./reportStyle.js";
import type { MapLayer } from "./zoneStore.js";

export const ZONE_SOURCE = "zones";
export const REPORT_SOURCE = "reports";

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
    const cls = value === null ? "none" : value < config.classes.redBelow ? "red" : value < config.classes.orangeBelow ? "orange" : "green";
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
export function ensureZoneLayers(instance: MapLayerHost) {
  for (const id of [ZONE_SOURCE, REPORT_SOURCE]) if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: EMPTY });

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

export interface ZoneView {
  zones: Zone[];
  scores: Record<string, ZoneScore> | undefined;
  visible: boolean;
  layer: MapLayer;
  selectedZoneId: string | null;
  reports: Report[];
  reportsVisible: boolean;
  reportKinds: Record<ReportKind, boolean>;
}

type MapLayerHost = MapLibreMap;

export function syncZoneLayers(instance: MapLibreMap, view: ZoneView, config: ZoneConfig) {
  ensureZoneLayers(instance);
  const set = (id: string, data: FeatureCollection) => (instance.getSource(id) as GeoJSONSource).setData(data);
  set(ZONE_SOURCE, zonesGeojson(view.zones, view.scores, config, view.layer));
  set(REPORT_SOURCE, view.reportsVisible ? reportsGeojson(view.reports) : EMPTY);
  instance.setFilter("report-points", ["in", ["get", "kind"], ["literal", REPORT_KINDS.filter((k) => view.reportKinds[k])]]);
  instance.setFilter("zone-selected", ["==", ["get", "id"], view.selectedZoneId ?? ""]);
  const visibility = view.visible ? "visible" : "none";
  for (const id of ["zone-fill", "zone-outline", "zone-outline-red", "zone-selected"]) {
    if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", visibility);
  }
  if (instance.getLayer("report-points")) instance.setLayoutProperty("report-points", "visibility", view.reportsVisible ? "visible" : "none");
}
