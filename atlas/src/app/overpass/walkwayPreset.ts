import { OVERPASS_BBOX } from "../studyArea.js";
import type { OverpassPreset } from "./presets.js";

/**
 * Everything the walkway scoring reads: walkways, benches, major roads (for the
 * estimated noise), terraces and parking, and raised kerbs.
 *
 * Deliberately NOT in OVERPASS_PRESETS: that list is loaded on start-up and
 * drawn as generic red points and lines, which would paint every road red. This
 * one is loaded on demand by the walkway panel and drawn by its own layers.
 */
export const WALKWAY_PRESET: OverpassPreset = {
  id: "walkways_mjsl",
  label: "Troncons pietons (OSM)",
  description: "Cheminements, bancs, grands axes, terrasses, parkings et bordures pour le score par profil.",
  dimensions: ["physical", "sensory", "economic"],
  query: `[out:json][timeout:60];
(
  way["highway"~"^(footway|path|pedestrian|steps)$"](${OVERPASS_BBOX});
  node["amenity"="bench"](${OVERPASS_BBOX});
  way["highway"~"^(trunk|primary|secondary)$"](${OVERPASS_BBOX});
  node["outdoor_seating"="yes"](${OVERPASS_BBOX});
  way["outdoor_seating"="yes"](${OVERPASS_BBOX});
  node["amenity"="parking"](${OVERPASS_BBOX});
  way["amenity"="parking"](${OVERPASS_BBOX});
  node["kerb"="raised"](${OVERPASS_BBOX});
);
out body geom;`,
};
