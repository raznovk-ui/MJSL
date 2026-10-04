import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { BASEMAPS } from "./basemaps.js";
import { STUDY_AREA } from "../studyArea.js";
import { OVERPASS_PRESETS } from "../overpass/presets.js";
import { useAppStore } from "../state.js";
import type { FeatureCollection } from "geojson";
import { WALKWAY_CONFIG } from "../../domain/walkway/index.js";
import { syncWalkwayLayers } from "../walkway/walkwayLayers.js";
import { useWalkwayStore } from "../walkway/walkwayStore.js";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const basemap = useAppStore((s) => s.basemap);
  const presets = useAppStore((s) => s.presets);
  // Sources may only be added once the style is fully parsed. Adding them on a
  // "styledata" event that fires mid-parse leaves them registered but never
  // wired up, so nothing ever renders.
  const [styleReady, setStyleReady] = useState(false);
  const routePicking = useWalkwayStore((s) => s.routePicking);
  const walkSegments = useWalkwayStore((s) => s.segments);
  const walkScores = useWalkwayStore((s) => s.scores);
  const walkProfile = useWalkwayStore((s) => s.profileId);
  const walkVisible = useWalkwayStore((s) => s.visible);
  const walkRoutes = useWalkwayStore((s) => s.routes);
  const walkFrom = useWalkwayStore((s) => s.routeFrom);
  const walkTo = useWalkwayStore((s) => s.routeTo);
  const zones = useWalkwayStore((s) => s.zones);
  const zonesVisible = useWalkwayStore((s) => s.zonesVisible);
  const selectedZoneId = useWalkwayStore((s) => s.selectedZoneId);

  useEffect(() => {
    if (!container.current || map.current) return;
    const style = BASEMAPS.find((b) => b.id === basemap)?.style ?? BASEMAPS[0]!.style;

    const instance = new maplibregl.Map({
      container: container.current,
      style,
      center: STUDY_AREA.centre,
      zoom: STUDY_AREA.zoom,
      attributionControl: {
        compact: false,
        // Stated explicitly rather than relying on tile metadata: every source
        // the app touches has to be credited, Overpass included.
        customAttribution: [
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          'Donnees interrogees via <a href="https://overpass-api.de/">Overpass API</a>',
          'Bruit : <a href="https://www.data.gouv.fr/datasets/bruit-routier-zones-exposees-sur-24h-indicateur-lden">Metropole Aix-Marseille-Provence</a> (Licence Ouverte 2.0)',
          'Altitudes : <a href="https://geoservices.ign.fr/rgealti">IGN RGE ALTI</a>',
        ],
      },
    });
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = instance;
    // Dev-only handle, so the rendered state can be inspected from the console.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = instance;

    instance.on("load", () => setStyleReady(true));
    instance.on("click", (event) => {
      // The only interaction left is choosing the two ends of a route.
      if (useWalkwayStore.getState().routePicking) {
        useWalkwayStore.getState().pickPoint(event.lngLat.lng, event.lngLat.lat);
      }
    });
    return () => {
      instance.remove();
      map.current = null;
    };
    // Basemap changes are handled by the effect below, not by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swapping the style drops custom sources, so they are re-added afterwards.
  // Tracked by value rather than a "first run" flag: StrictMode invokes effects
  // twice, and a one-shot flag let the second pass call setStyle mid-load, which
  // rebuilt the style from scratch and stranded every source empty.
  const appliedBasemap = useRef(basemap);
  useEffect(() => {
    const instance = map.current;
    if (!instance || appliedBasemap.current === basemap) return;

    const style = BASEMAPS.find((b) => b.id === basemap)?.style;
    if (!style) return;
    appliedBasemap.current = basemap;
    setStyleReady(false);
    instance.setStyle(style);
    instance.once("idle", () => setStyleReady(true));
  }, [basemap]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.getCanvas().style.cursor = routePicking ? "crosshair" : "";
  }, [routePicking]);

  // Walkway segments coloured by the selected profile, plus the chosen route.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    syncWalkwayLayers(instance, {
      segments: walkSegments,
      scores: walkScores[walkProfile],
      visible: walkVisible,
      route: walkRoutes.find((r) => r.profileId === walkProfile),
      from: walkFrom,
      to: walkTo,
      zones,
      zonesVisible,
      selectedZoneId,
    }, WALKWAY_CONFIG);
  }, [styleReady, walkSegments, walkScores, walkProfile, walkVisible, walkRoutes, walkFrom, walkTo, zones, zonesVisible, selectedZoneId]);

  // Choosing a zone in the list frames it on the map.
  useEffect(() => {
    const instance = map.current;
    const zone = zones.find((z) => z.id === selectedZoneId);
    if (!instance || !zone) return;
    const [w, s, e, n] = zone.bbox;
    instance.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 17, animate: !prefersReducedMotion() });
  }, [selectedZoneId, zones]);

  // Re-runs whenever the data changes or the style becomes ready again, so the
  // two can arrive in either order.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    syncPresetLayers(instance);
  }, [presets, styleReady]);

  return (
    <div
      ref={container}
      className="h-full w-full"
      // The map is decorative to a screen reader; the table view carries the data.
      role="application"
      aria-label="Carte du littoral marseillais. Les memes donnees sont disponibles en tableau."
    />
  );
}

function sourceId(presetId: string) {
  return `preset-${presetId}`;
}

function layerIds(presetId: string) {
  return [`preset-${presetId}-line`, `preset-${presetId}-point`];
}

function syncPresetLayers(instance: MapLibreMap) {
  const { presets } = useAppStore.getState();

  for (const preset of OVERPASS_PRESETS) {
    const id = sourceId(preset.id);
    const layer = presets[preset.id];
    const data = layer?.geojson ?? EMPTY;

    const existing = instance.getSource(id) as GeoJSONSource | undefined;
    if (existing) existing.setData(data);
    else instance.addSource(id, { type: "geojson", data });

    const [lineId, pointId] = layerIds(preset.id);
    const visibility = layer?.visible ? "visible" : "none";

    if (!instance.getLayer(lineId!)) {
      instance.addLayer({
        id: lineId!,
        type: "line",
        source: id,
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { visibility, "line-cap": "round" },
        paint: { "line-color": "#9e2f2f", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 14, 5, 17, 8], "line-opacity": 0.85 },
      });
    }
    if (!instance.getLayer(pointId!)) {
      instance.addLayer({
        id: pointId!,
        type: "circle",
        source: id,
        filter: ["==", ["geometry-type"], "Point"],
        layout: { visibility },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 14, 7, 17, 10],
          "circle-color": "#9e2f2f",
          // Shape and outline carry meaning too, never colour alone.
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
    }

    for (const layerId of layerIds(preset.id)) {
      if (instance.getLayer(layerId)) instance.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}
