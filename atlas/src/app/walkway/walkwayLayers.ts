import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import type { RouteResult, Segment, SegmentScore, WalkwayConfig, Zone } from "../../domain/walkway/index.js";
import type { RoutePoint } from "./walkwayStore.js";

export const WALKWAY_SOURCE = "walkway-segments";
export const WALKWAY_ROUTE_SOURCE = "walkway-route";
export const WALKWAY_POINTS_SOURCE = "walkway-route-points";
export const ZONE_SOURCE = "walkway-zones";
const ZONE_LAYERS = ["walkway-zone-halo", "walkway-zone-selected"];

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function segmentsGeojson(
  segments: Segment[],
  scores: Record<string, SegmentScore> | undefined,
  config: WalkwayConfig,
): FeatureCollection {
  const features: Feature[] = [];
  for (const segment of segments) {
    if (!segment.geometry || segment.geometry.length < 2) continue;
    const score = scores?.[segment.id];
    const cls = score?.cls ?? "none";
    features.push({
      type: "Feature",
      id: segment.id,
      properties: {
        id: segment.id,
        name: segment.name ?? "",
        cls,
        colour: config.classes.colours[cls],
        score: score?.score ?? null,
        vetoed: score?.vetoed ?? false,
      },
      geometry: { type: "LineString", coordinates: segment.geometry },
    });
  }
  return { type: "FeatureCollection", features };
}

function routeGeojson(segments: Segment[], route: RouteResult | undefined): FeatureCollection {
  if (!route) return EMPTY;
  const byId = new Map(segments.map((s) => [s.id, s]));
  const features: Feature[] = [];
  const add = (ids: string[], kind: "direct" | "detour") => {
    for (const id of ids) {
      const geometry = byId.get(id)?.geometry;
      if (geometry && geometry.length >= 2) {
        features.push({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: geometry } });
      }
    }
  };
  add(route.path.segmentIds, "direct");
  if (route.detour) add(route.detour.segmentIds, "detour");
  return { type: "FeatureCollection", features };
}

/** Zones as one MultiLineString each, so a zone is one feature with a rank. */
export function zonesGeojson(zones: Zone[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature",
      id: zone.rank,
      properties: { id: zone.id, rank: zone.rank, summary: zone.summary },
      geometry: { type: "MultiLineString", coordinates: zone.lines },
    })),
  };
}

function pointsGeojson(from: RoutePoint | null, to: RoutePoint | null): FeatureCollection {
  const features: Feature[] = [];
  if (from) features.push({ type: "Feature", properties: { role: "from" }, geometry: { type: "Point", coordinates: from.coord } });
  if (to) features.push({ type: "Feature", properties: { role: "to" }, geometry: { type: "Point", coordinates: to.coord } });
  return { type: "FeatureCollection", features };
}

/** Idempotent: safe to call on every style load and every data change. */
export function ensureWalkwayLayers(instance: MapLibreMap, config: WalkwayConfig) {
  for (const id of [WALKWAY_SOURCE, WALKWAY_ROUTE_SOURCE, WALKWAY_POINTS_SOURCE, ZONE_SOURCE]) {
    if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: EMPTY });
  }
  const before = undefined;

  // A wide pale halo under the lines: the zone is where the red lines cluster.
  if (!instance.getLayer("walkway-zone-halo")) {
    instance.addLayer({
      id: "walkway-zone-halo", type: "line", source: ZONE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#7f1d1d", "line-width": 14, "line-opacity": 0.22 },
    });
  }
  if (!instance.getLayer("walkway-zone-selected")) {
    instance.addLayer({
      id: "walkway-zone-selected", type: "line", source: ZONE_SOURCE,
      filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#111827", "line-width": 18, "line-opacity": 0.35 },
    });
  }

  if (!instance.getLayer("walkway-route-direct")) {
    instance.addLayer({
      id: "walkway-route-direct", type: "line", source: WALKWAY_ROUTE_SOURCE,
      filter: ["==", ["get", "kind"], "direct"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1d4ed8", "line-width": 12, "line-opacity": 0.35 },
    }, before);
  }
  if (!instance.getLayer("walkway-route-detour")) {
    instance.addLayer({
      id: "walkway-route-detour", type: "line", source: WALKWAY_ROUTE_SOURCE,
      filter: ["==", ["get", "kind"], "detour"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#6d28d9", "line-width": 12, "line-opacity": 0.35 },
    }, before);
  }
  if (!instance.getLayer("walkway-line")) {
    instance.addLayer({
      id: "walkway-line", type: "line", source: WALKWAY_SOURCE,
      filter: ["!=", ["get", "cls"], "red"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "colour"],
        "line-width": ["case", ["==", ["get", "cls"], "none"], 2, 4],
        "line-opacity": 0.95,
      },
    }, before);
  }
  // Red is dashed as well as red: a separate layer, since line-dasharray cannot
  // be data-driven.
  if (!instance.getLayer("walkway-line-red")) {
    instance.addLayer({
      id: "walkway-line-red", type: "line", source: WALKWAY_SOURCE,
      filter: ["==", ["get", "cls"], "red"],
      layout: { "line-join": "round" },
      paint: { "line-color": config.classes.colours.red, "line-width": 4, "line-dasharray": [2, 1.5] },
    }, before);
  }
  if (!instance.getLayer("walkway-route-points")) {
    instance.addLayer({
      id: "walkway-route-points", type: "circle", source: WALKWAY_POINTS_SOURCE,
      paint: {
        "circle-radius": 8,
        "circle-color": ["match", ["get", "role"], "from", "#0f766e", "#1d4ed8"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  }
}

export interface WalkwayView {
  segments: Segment[];
  scores: Record<string, SegmentScore> | undefined;
  visible: boolean;
  route: RouteResult | undefined;
  from: RoutePoint | null;
  to: RoutePoint | null;
  zones: Zone[];
  zonesVisible: boolean;
  selectedZoneId: string | null;
}

export function syncWalkwayLayers(instance: MapLibreMap, view: WalkwayView, config: WalkwayConfig) {
  ensureWalkwayLayers(instance, config);
  const set = (id: string, data: FeatureCollection) => (instance.getSource(id) as GeoJSONSource).setData(data);
  set(WALKWAY_SOURCE, segmentsGeojson(view.segments, view.scores, config));
  set(WALKWAY_ROUTE_SOURCE, routeGeojson(view.segments, view.route));
  set(WALKWAY_POINTS_SOURCE, pointsGeojson(view.from, view.to));
  set(ZONE_SOURCE, zonesGeojson(view.zones));
  if (instance.getLayer("walkway-zone-selected")) {
    instance.setFilter("walkway-zone-selected", ["==", ["get", "id"], view.selectedZoneId ?? ""]);
  }
  const zoneVisibility = view.zonesVisible ? "visible" : "none";
  for (const id of ZONE_LAYERS) if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", zoneVisibility);
  const visibility = view.visible ? "visible" : "none";
  for (const id of ["walkway-route-direct", "walkway-route-detour", "walkway-line", "walkway-line-red", "walkway-route-points"]) {
    if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", visibility);
  }
}
