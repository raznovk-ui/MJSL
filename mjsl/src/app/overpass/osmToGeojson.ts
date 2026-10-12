import type { Feature, FeatureCollection, Geometry } from "geojson";

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

function geometryFor(element: OsmElement): Geometry | null {
  if (element.type === "node" && element.lat !== undefined && element.lon !== undefined) {
    return { type: "Point", coordinates: [element.lon, element.lat] };
  }
  if (element.type === "way" && Array.isArray(element.geometry) && element.geometry.length > 1) {
    const coordinates = element.geometry.map((p) => [p.lon, p.lat]);
    const first = coordinates[0]!;
    const last = coordinates[coordinates.length - 1]!;
    const closed = first[0] === last[0] && first[1] === last[1];
    return closed
      ? { type: "Polygon", coordinates: [coordinates] }
      : { type: "LineString", coordinates };
  }
  return null;
}

/** An Overpass answer (`out body geom`) as GeoJSON: nodes become points, ways lines (or polygons when closed), tags become properties. */
export function osmToGeojson(payload: { elements?: OsmElement[] }): FeatureCollection {
  const features: Feature[] = [];
  for (const element of payload.elements ?? []) {
    const geometry = geometryFor(element);
    if (!geometry) continue;
    const tags = element.tags ?? {};
    features.push({
      type: "Feature",
      id: `${element.type}/${element.id}`,
      properties: { osm_id: `${element.type}/${element.id}`, ...tags },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
