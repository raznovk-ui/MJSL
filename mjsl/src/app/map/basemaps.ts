import type { StyleSpecification } from "maplibre-gl";

interface Basemap {
  id: string;
  label: string;
  description: string;
  style: StyleSpecification;
}

function rasterStyle(id: string, tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { [id]: { type: "raster", tiles, tileSize: 256, attribution } },
    layers: [{ id, type: "raster", source: id }],
  };
}

/**
 * Open tiles only, per the project's constraints. Attribution travels with the
 * source so MapLibre renders it without us having to remember.
 */
export const BASEMAPS: Basemap[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Fond standard, lisible pour le reperage.",
    style: rasterStyle(
      "osm",
      ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    ),
  },
  {
    id: "carto-light",
    label: "Clair (contraste eleve)",
    description: "Fond desature : les couches MJSL ressortent davantage.",
    style: rasterStyle(
      "carto-light",
      ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    ),
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0]!.id;
