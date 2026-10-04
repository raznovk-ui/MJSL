import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { BASEMAPS } from "./basemaps.js";
import { STUDY_AREA } from "../studyArea.js";
import { OVERPASS_PRESETS } from "../overpass/presets.js";
import { useAppStore } from "../state.js";
import { CLASS_COLOURS, observationClass } from "../observationStyle.js";
import { RUPTURE_COLOURS } from "../ruptureStyle.js";
import { cellsToGeojson, redZonesToGeojson } from "../analysis/cells.js";
import { INSUFFICIENT_FILL, INSUFFICIENT_LINE } from "../analysis/palette.js";
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
  const observations = useAppStore((s) => s.observations);
  const addPointMode = useAppStore((s) => s.addPointMode);
  const placingPhotoId = useAppStore((s) => s.placingPhotoId);
  const addRuptureMode = useAppStore((s) => s.addRuptureMode);
  const ruptures = useAppStore((s) => s.ruptures);
  const routePicking = useWalkwayStore((s) => s.routePicking);
  const walkSegments = useWalkwayStore((s) => s.segments);
  const walkScores = useWalkwayStore((s) => s.scores);
  const walkProfile = useWalkwayStore((s) => s.profileId);
  const walkVisible = useWalkwayStore((s) => s.visible);
  const walkRoutes = useWalkwayStore((s) => s.routes);
  const walkFrom = useWalkwayStore((s) => s.routeFrom);
  const walkTo = useWalkwayStore((s) => s.routeTo);
  const activeLayer = useAppStore((s) => s.activeLayer);
  const globalMode = useAppStore((s) => s.globalMode);
  const showCells = useAppStore((s) => s.showCells);
  const showEvidence = useAppStore((s) => s.showEvidence);
  const cellOpacity = useAppStore((s) => s.cellOpacity);
  // Computed by useScoring() at the app level, not here: the dashboard and the
  // Analyse tab need these numbers whether or not the map has ever finished
  // loading, so nothing about deriving them may depend on styleReady.
  const cellScores = useAppStore((s) => s.cellScores);
  const redZones = useAppStore((s) => s.redZones);

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
      // Read the flags at click time: registering this once avoids rebinding on
      // every state change, and the store is the source of truth anyway.
      const state = useAppStore.getState();
      if (useWalkwayStore.getState().routePicking) {
        useWalkwayStore.getState().pickPoint(event.lngLat.lng, event.lngLat.lat);
        return;
      }
      if (state.placingPhotoId) {
        void state.placePhotoAt(event.lngLat.lng, event.lngLat.lat);
        return;
      }
      if (state.addRuptureMode) {
        void state.addRuptureAt(event.lngLat.lng, event.lngLat.lat);
        return;
      }
      if (state.addPointMode) {
        void state.addPointAt(event.lngLat.lng, event.lngLat.lat);
        return;
      }
      // No capture armed: a click inspects the cell under the cursor.
      const hit = instance.queryRenderedFeatures(event.point, {
        layers: ["cells-fill", "cells-insufficient"].filter((id) => instance.getLayer(id)),
      });
      state.selectCell(hit.length ? String(hit[0]!.properties?.cell ?? "") : null);
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
    instance.getCanvas().style.cursor = addPointMode || placingPhotoId || addRuptureMode || routePicking ? "crosshair" : "";
  }, [addPointMode, placingPhotoId, addRuptureMode, routePicking]);

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
    }, WALKWAY_CONFIG);
  }, [styleReady, walkSegments, walkScores, walkProfile, walkVisible, walkRoutes, walkFrom, walkTo]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    const source = instance.getSource(OBSERVATION_SOURCE) as GeoJSONSource | undefined;
    if (source) source.setData(observationsToGeojson(observations));
    const ruptureSource = instance.getSource(RUPTURE_SOURCE) as GeoJSONSource | undefined;
    if (ruptureSource) ruptureSource.setData(rupturesToGeojson(ruptures));
  }, [observations, ruptures, styleReady]);

  // Only pushes already-computed scores into the map's sources; does not
  // compute them. Scoring itself runs at the app level (useScoring), so the
  // dashboard and the Analyse tab have real numbers even before the map has
  // finished loading, or if it never does.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;

    const config = useAppStore.getState().scoringConfig();
    ensureAnalysisLayers(instance);
    (instance.getSource(CELL_SOURCE) as GeoJSONSource).setData(cellsToGeojson(cellScores, activeLayer, config));
    (instance.getSource(REDZONE_SOURCE) as GeoJSONSource).setData(redZonesToGeojson(redZones));
  }, [cellScores, redZones, activeLayer, styleReady]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    const visibility = showCells ? "visible" : "none";
    for (const id of ["cells-fill", "cells-insufficient", "cells-outline", "cells-outline-insufficient", "redzones-outline"]) {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", visibility);
    }
    if (instance.getLayer("cells-fill")) instance.setPaintProperty("cells-fill", "fill-opacity", cellOpacity);
  }, [showCells, cellOpacity, styleReady]);

  // Re-runs whenever the data changes or the style becomes ready again, so the
  // two can arrive in either order.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    syncPresetLayers(instance);
  }, [presets, styleReady]);

  // Declared after the effect that creates the layers, so it also re-applies after a
  // basemap swap re-creates them.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady) return;
    for (const id of ["observations-line", "observations-point", "ruptures-halo", "ruptures-label"]) {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", showEvidence ? "visible" : "none");
    }
  }, [showEvidence, styleReady, observations, ruptures]);

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

/**
 * Idempotent: creates sources and layers if they are missing, and always pushes
 * the current data and visibility. Safe to call on style load and on every data
 * change, in either order.
 */
export const OBSERVATION_SOURCE = "observations";
export const RUPTURE_SOURCE = "ruptures";

/**
 * Creates the analysis sources and layers if they are missing. Called from both
 * the layer sync and the scoring effect, because React runs effects in
 * declaration order and whichever fires first must not find the source absent:
 * a setData on a missing source silently does nothing and never retries.
 */
function ensureAnalysisLayers(instance: MapLibreMap) {
  // Added before the evidence layers so the choropleth sits beneath them.
  if (!instance.getSource(CELL_SOURCE)) {
    instance.addSource(CELL_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!instance.getSource(REDZONE_SOURCE)) {
    instance.addSource(REDZONE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!instance.getLayer("cells-fill")) {
    instance.addLayer({
      id: "cells-fill",
      type: "fill",
      source: CELL_SOURCE,
      filter: ["get", "sufficient"],
      paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.65 },
    });
  }
  if (!instance.getLayer("cells-insufficient")) {
    // Too little evidence is drawn as a flat grey with a dashed edge, so it
    // reads as "not surveyed" rather than as a low score.
    instance.addLayer({
      id: "cells-insufficient",
      type: "fill",
      source: CELL_SOURCE,
      filter: ["!", ["get", "sufficient"]],
      paint: { "fill-color": INSUFFICIENT_FILL, "fill-opacity": 0.35 },
    });
  }
  // Two outline layers rather than one with a data-driven dash: line-dasharray
  // is a constant property in MapLibre, so a "case" expression there is not
  // reliably honoured and the dashed edge could silently disappear.
  if (!instance.getLayer("cells-outline")) {
    instance.addLayer({
      id: "cells-outline",
      type: "line",
      source: CELL_SOURCE,
      filter: ["get", "sufficient"],
      paint: { "line-color": "#ffffff", "line-width": 0.6 },
    });
  }
  if (!instance.getLayer("cells-outline-insufficient")) {
    instance.addLayer({
      id: "cells-outline-insufficient",
      type: "line",
      source: CELL_SOURCE,
      filter: ["!", ["get", "sufficient"]],
      paint: { "line-color": INSUFFICIENT_LINE, "line-width": 0.8, "line-dasharray": [2, 2] },
    });
  }
  if (!instance.getLayer("redzones-outline")) {
    instance.addLayer({
      id: "redzones-outline",
      type: "line",
      source: REDZONE_SOURCE,
      paint: { "line-color": "#7f1d1d", "line-width": 3 },
    });
  }

}

export const CELL_SOURCE = "cells";
export const REDZONE_SOURCE = "redzones";

function rupturesToGeojson(ruptures: ReturnType<typeof useAppStore.getState>["ruptures"]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ruptures.map((rupture) => ({
      type: "Feature",
      id: rupture.id,
      properties: {
        id: rupture.id,
        severity: rupture.severity,
        blocking: rupture.blocking,
        colour: rupture.blocking ? RUPTURE_COLOURS.blocking : RUPTURE_COLOURS.friction,
        // Rendered as a numeral on the map so severity is readable without
        // relying on colour, and distinguishable in greyscale print.
        label: String(rupture.severity),
      },
      geometry: rupture.geometry,
    })),
  };
}

function observationsToGeojson(observations: ReturnType<typeof useAppStore.getState>["observations"]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: observations.map((observation) => ({
      type: "Feature",
      id: observation.id,
      properties: {
        id: observation.id,
        title: observation.title,
        colour: CLASS_COLOURS[observationClass(observation)],
      },
      geometry: observation.geometry,
    })),
  };
}

function syncPresetLayers(instance: MapLibreMap) {
  const { presets, observations, ruptures } = useAppStore.getState();

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
        paint: { "line-color": "#9e2f2f", "line-width": 4, "line-opacity": 0.85 },
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
          "circle-radius": 5,
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

  ensureAnalysisLayers(instance);

  // User observations sit above the OSM indices: they are the evidence, the OSM
  // layer is only context.
  const data = observationsToGeojson(observations);
  const existingObs = instance.getSource(OBSERVATION_SOURCE) as GeoJSONSource | undefined;
  if (existingObs) existingObs.setData(data);
  else instance.addSource(OBSERVATION_SOURCE, { type: "geojson", data });

  if (!instance.getLayer("observations-line")) {
    instance.addLayer({
      id: "observations-line",
      type: "line",
      source: OBSERVATION_SOURCE,
      filter: ["!=", ["geometry-type"], "Point"],
      paint: { "line-color": ["get", "colour"], "line-width": 5, "line-opacity": 0.9 },
    });
  }
  const ruptureData = rupturesToGeojson(ruptures);
  const existingRup = instance.getSource(RUPTURE_SOURCE) as GeoJSONSource | undefined;
  if (existingRup) existingRup.setData(ruptureData);
  else instance.addSource(RUPTURE_SOURCE, { type: "geojson", data: ruptureData });

  if (!instance.getLayer("observations-point")) {
    instance.addLayer({
      id: "observations-point",
      type: "circle",
      source: OBSERVATION_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": ["get", "colour"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  // Ruptures sit above everything: they are what the diagnosis is looking for.
  if (!instance.getLayer("ruptures-halo")) {
    instance.addLayer({
      id: "ruptures-halo",
      type: "circle",
      source: RUPTURE_SOURCE,
      paint: {
        // A blocking rupture is drawn larger and ringed in black, so it is
        // distinguishable from friction by shape as well as by colour.
        "circle-radius": ["case", ["get", "blocking"], 13, 10],
        "circle-color": ["get", "colour"],
        "circle-stroke-color": ["case", ["get", "blocking"], "#000000", "#ffffff"],
        "circle-stroke-width": ["case", ["get", "blocking"], 3, 2],
      },
    });
  }
  if (!instance.getLayer("ruptures-label")) {
    instance.addLayer({
      id: "ruptures-label",
      type: "symbol",
      source: RUPTURE_SOURCE,
      layout: { "text-field": ["get", "label"], "text-size": 12, "text-allow-overlap": true },
      paint: { "text-color": "#ffffff" },
    });
  }
}
