import { OVERPASS_BBOX } from "../studyArea.js";

export interface OverpassPreset {
  id: string;
  label: string;
  description: string;
  /** Overpass QL; must end with `out body geom` so ways come with their geometry. */
  query: string;
}

/**
 * The OSM layers drawn on the map as they are ("Indices OSM"), loaded at start-up and
 * listed in the "Couches OpenStreetMap" panel. A new entry here gets a source, a layer,
 * a panel entry and a snapshot file (npm run data:osm) with no other change. The data
 * behind the scores is NOT here: see zonePreset.ts.
 */
export const OVERPASS_PRESETS: OverpassPreset[] = [
  {
    id: "ruptures_physiques",
    label: "Ruptures physiques (OSM)",
    description:
      "Escaliers, ascenseurs, bordures et bandes podotactiles. Indices de continuite a verifier sur le terrain, pas des preuves.",
    query: `[out:json][timeout:30];
(
  node["highway"="steps"](${OVERPASS_BBOX});
  way["highway"="steps"](${OVERPASS_BBOX});
  node["highway"="elevator"](${OVERPASS_BBOX});
  node["kerb"](${OVERPASS_BBOX});
  node["tactile_paving"](${OVERPASS_BBOX});
  way["tactile_paving"](${OVERPASS_BBOX});
);
out body geom;`,
  },
];
