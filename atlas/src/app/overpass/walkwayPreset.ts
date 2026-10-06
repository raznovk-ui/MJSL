import { cityTiles, type Tile } from "../studyArea.js";
import type { OverpassPreset } from "./presets.js";

/**
 * Everything the walkway scoring reads: walkways, walkable streets, benches, major
 * roads (for the estimated noise), terraces and parking, raised kerbs, and the places
 * (shops, stops, lamps, cafes, parks, town halls...) behind the cognitive and social
 * indicators.
 *
 * Streets are included because most pavements are not mapped as their own line:
 * without them whole districts would have no segments at all. A street segment
 * stands for its pavement, so its width is always an estimate.
 *
 * Deliberately NOT in OVERPASS_PRESETS: that list is loaded on start-up and
 * drawn as generic red points and lines, which would paint every road red.
 */
export function walkwayPresetFor(tile: Tile): OverpassPreset {
  const b = tile.bbox;
  return {
    id: `walkways_mjsl5_${tile.id}`,
    label: `Troncons pietons (OSM) ${tile.id}`,
    description: "Cheminements, rues, bancs, grands axes, terrasses, parkings et bordures pour le score par profil.",
    dimensions: ["physical", "sensory", "economic"],
    query: `[out:json][timeout:120];
(
  way["highway"~"^(footway|path|pedestrian|steps)$"](${b});
  way["highway"~"^(residential|living_street|tertiary|unclassified)$"]["foot"!="no"]["access"!="no"](${b});
  node["amenity"](${b});
  node["shop"](${b});
  node["tourism"](${b});
  node["historic"](${b});
  node["highway"~"^(bus_stop|street_lamp)$"](${b});
  way["amenity"~"^(school|townhall|community_centre|social_centre|social_facility|courthouse|library|marketplace|place_of_worship|arts_centre|theatre|cinema)$"](${b});
  way["leisure"~"^(park|playground|garden|sports_centre)$"](${b});
  nwr["office"="government"](${b});
  way["highway"~"^(trunk|primary|secondary)$"](${b});
  node["outdoor_seating"="yes"](${b});
  way["outdoor_seating"="yes"](${b});
  way["amenity"="parking"](${b});
  node["kerb"="raised"](${b});
);
out body geom;`,
  };
}

export const WALKWAY_TILES: OverpassPreset[] = cityTiles().map(walkwayPresetFor);

/**
 * The few things only the social dimension needs (cameras, gates, shelters, covered
 * ways, entrances). Kept apart from the main query: these are small, so they use
 * bigger tiles, and they are optional: if they cannot be loaded the social indicators
 * built on them simply stay "no data".
 */
export function socialPresetFor(tile: Tile): OverpassPreset {
  const b = tile.bbox;
  return {
    id: `social_mjsl2_${tile.id}`,
    label: `Controle, abris et seuils (OSM) ${tile.id}`,
    description: "Cameras, portails, abris et passages couverts pour la dimension sociale.",
    dimensions: ["socio_cultural"],
    query: `[out:json][timeout:90];
(
  node["man_made"="surveillance"](${b});
  node["highway"="crossing"](${b});
  node["tourism"="information"](${b});
  node["barrier"~"^(gate|lift_gate|turnstile)$"](${b});
  node["highway"="bus_stop"]["shelter"="yes"](${b});
  node["shelter"="yes"](${b});
  way["amenity"="shelter"](${b});
  way["covered"="yes"]["highway"](${b});
  way["building:part"="arcade"](${b});
);
out body geom;`,
  };
}

export const SOCIAL_TILES: OverpassPreset[] = cityTiles(3, 4).map(socialPresetFor);
