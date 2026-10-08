/** The whole commune of Marseille. Single source of truth for the zone scoring. */
export const STUDY_AREA = {
  name: "Marseille",
  bbox: { south: 43.17, west: 5.22, north: 43.39, east: 5.54 },
  centre: [5.38, 43.29] as [number, number],
  zoom: 11.6,
} as const;

/**
 * The coastal corridor (Vieux-Port to Statue de David). Only the OSM "hints" layer
 * is limited to it: those objects are drawn as plain markers and a whole-city load
 * would bury the map.
 */
export const CORRIDOR_BBOX = { south: 43.255, west: 5.335, north: 43.305, east: 5.385 } as const;

export const OVERPASS_BBOX = `${CORRIDOR_BBOX.south},${CORRIDOR_BBOX.west},${CORRIDOR_BBOX.north},${CORRIDOR_BBOX.east}`;

export interface Tile { id: string; bbox: string }

/**
 * The city is fetched in tiles: one request for all of Marseille would exceed
 * Overpass's time and size limits, and a failed tile can be retried on its own.
 */
export function cityTiles(rows = 6, cols = 8): Tile[] {
  const { south, west, north, east } = STUDY_AREA.bbox;
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const s = south + ((north - south) * r) / rows;
      const n = south + ((north - south) * (r + 1)) / rows;
      const w = west + ((east - west) * c) / cols;
      const e = west + ((east - west) * (c + 1)) / cols;
      tiles.push({ id: `r${r}c${c}`, bbox: [s, w, n, e].map((v) => v.toFixed(5)).join(",") });
    }
  }
  return tiles;
}
