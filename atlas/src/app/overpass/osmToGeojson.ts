import type { Feature, FeatureCollection, Geometry } from "geojson";

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  /** Way only: ids of its nodes, aligned with `geometry`. */
  nodes?: number[];
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

/** Human-readable label for an OSM feature, used in the table and popups. */
export function osmLabel(tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  if (tags.highway === "steps") return "Escalier";
  if (tags.highway === "elevator") return "Ascenseur";
  if (tags.tactile_paving) return `Bande podotactile (${tags.tactile_paving})`;
  if (tags.kerb) return `Bordure (${tags.kerb})`;
  return "Objet OSM";
}

export function osmToGeojson(payload: { elements?: OsmElement[] }): FeatureCollection {
  const features: Feature[] = [];
  for (const element of payload.elements ?? []) {
    const geometry = geometryFor(element);
    if (!geometry) continue;
    const tags = element.tags ?? {};
    features.push({
      type: "Feature",
      id: `${element.type}/${element.id}`,
      properties: {
        osm_id: `${element.type}/${element.id}`,
        label: osmLabel(tags),
        wheelchair: tags.wheelchair ?? "",
        // Kept for ways: the ids of their nodes.
        ...(element.nodes ? { osm_nodes: element.nodes } : {}),
        ...tags,
      },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
