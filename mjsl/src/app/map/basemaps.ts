import type { StyleSpecification } from "maplibre-gl";

export interface Basemap {
  id: string;
  label: string;
  description: string;
  /** Plain-text attribution for PDF and other non-HTML exports. */
  attribution: string;
  style: StyleSpecification | string;
}

function rasterStyle(id: string, tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { [id]: { type: "raster", tiles, tileSize: 256, attribution } },
    layers: [{ id, type: "raster", source: id }],
  };
}

const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim();
const positronStyle = mapTilerKey
  ? `https://api.maptiler.com/maps/positron/style.json?key=${encodeURIComponent(mapTilerKey)}`
  : null;

/** Attribution travels with the source so MapLibre renders it automatically. */
export const BASEMAPS: Basemap[] = [
  ...(positronStyle
    ? [{
        id: "positron",
        label: "Positron",
        description: "Fond clair et discret, concu pour faire ressortir les donnees MJSL.",
        attribution: "© contributeurs OpenStreetMap, © MapTiler, © Stamen Design",
        style: positronStyle,
      }]
    : []),
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Fond standard, lisible pour le reperage.",
    attribution: "© contributeurs OpenStreetMap",
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
    attribution: "© contributeurs OpenStreetMap, © CARTO",
    style: rasterStyle(
      "carto-light",
      ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    ),
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0]!.id;
