import { SpatialGrid } from "./spatial.js";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { estimateNoiseDb } from "./indicators.js";
import { coordKey, distanceM, pointAlong, pointToPolylineM, polylineLengthM } from "./geo.js";
import { segmentNoiseReading, type NoiseIndex } from "./noiseMap.js";
import type { WalkwayConfig } from "./loadConfig.js";
import type { IndicatorKey, LngLat, Segment, ValueSource } from "./types.js";

type Tags = Record<string, unknown>;

const WALKWAY_HIGHWAYS = new Set(["footway", "path", "pedestrian", "steps", "residential", "living_street", "tertiary", "unclassified"]);
/** Amenities that are street furniture or services of no use as a landmark. */
const NOT_LANDMARKS = new Set(["bench", "parking", "parking_space", "bicycle_parking", "motorcycle_parking", "waste_basket", "recycling", "post_box", "vending_machine", "bicycle_rental", "charging_station", "fountain", "drinking_water"]);
const MAJOR_ROADS = new Set(["trunk", "primary", "secondary"]);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** "1.5", "1,5 m", "150 cm" -> metres. */
export function parseMetres(value: unknown): number | undefined {
  const s = str(value)?.toLowerCase().replace(",", ".");
  if (!s) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return undefined;
  return s.includes("cm") ? n / 100 : n;
}

/** "10%", "-6 %", "5°" -> percent. "up"/"down" carry no number, so no data. */
export function parseInclinePct(value: unknown): number | undefined {
  const s = str(value)?.toLowerCase().replace(",", ".");
  if (!s) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return undefined;
  if (s.includes("°")) return Math.tan((n * Math.PI) / 180) * 100;
  return n;
}

/** "50", "30 mph" -> km/h. Anything else ("signals", "FR:urban") is no data. */
export function parseSpeedKmh(value: unknown): number | undefined {
  const s = str(value)?.toLowerCase();
  if (!s) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || !/^\d/.test(s)) return undefined;
  return s.includes("mph") ? n * 1.609344 : n;
}

function coordsOf(geometry: Geometry | null): LngLat[] | null {
  if (!geometry) return null;
  if (geometry.type === "LineString") return geometry.coordinates as LngLat[];
  return null;
}

/** Every vertex of a point/line/polygon, as points. */
function pointsOf(geometry: Geometry | null): LngLat[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates as LngLat];
    case "LineString":
      return geometry.coordinates as LngLat[];
    case "Polygon":
      return geometry.coordinates.flat() as LngLat[];
    default:
      return [];
  }
}

interface WayPart {
  osmId: string;
  name?: string;
  tags: Tags;
  coords: LngLat[];
  nodeIds: string[];
}

/**
 * Turns loaded OSM features (as produced by osmToGeojson) into walkway
 * segments: ways are cut at junctions so that segments connect only where the
 * real paths do, then each segment gets its indicators with their provenance.
 *
 * Nothing is invented. A tag that is absent leaves the indicator at "no data";
 * benches, terraces/parking and major roads must actually be present in the
 * loaded data for rest, economic and estimated-noise to be computed at all,
 * because an empty list cannot tell "none exist" from "not loaded".
 */
export function buildSegments(
  collection: FeatureCollection,
  config: WalkwayConfig,
  options: { noiseIndex?: NoiseIndex } = {},
): Segment[] {
  const features = collection.features as Feature[];
  const walkways: WayPart[] = [];
  const benches: LngLat[] = [];
  const roads: { coords: LngLat[]; roadClass: string; speed?: number }[] = [];
  const privatizers: LngLat[] = [];
  const raisedKerbs: LngLat[] = [];
  const lamps: LngLat[] = [];
  const landmarks: LngLat[] = [];
  const activityPlaces: LngLat[] = [];
  const civicPlaces: LngLat[] = [];
  const { activityAmenities, activityLeisure, civicAmenities } = config.autoData.places;

  for (const feature of features) {
    const tags = (feature.properties ?? {}) as Tags;
    const geometry = feature.geometry;
    const highway = str(tags.highway);

    if (geometry?.type === "LineString" && highway && WALKWAY_HIGHWAYS.has(highway)) {
      const coords = coordsOf(geometry)!;
      const ids = Array.isArray(tags.osm_nodes) && tags.osm_nodes.length === coords.length
        ? (tags.osm_nodes as unknown[]).map(String)
        : coords.map(coordKey); // No node ids: connect by identical coordinates.
      walkways.push({ osmId: String(tags.osm_id ?? feature.id ?? `way${walkways.length}`), name: str(tags.name), tags, coords, nodeIds: ids });
    }
    if (geometry?.type === "Point" && str(tags.amenity) === "bench") benches.push(geometry.coordinates as LngLat);
    if (geometry?.type === "LineString" && highway && MAJOR_ROADS.has(highway)) {
      roads.push({ coords: coordsOf(geometry)!, roadClass: highway, speed: parseSpeedKmh(tags.maxspeed) });
    }
    if (str(tags.outdoor_seating) === "yes" || str(tags.amenity) === "parking") privatizers.push(...pointsOf(geometry));
    if (geometry?.type === "Point" && str(tags.kerb) === "raised") raisedKerbs.push(geometry.coordinates as LngLat);

    // Places for the cognitive and social indicators.
    const amenity = str(tags.amenity);
    if (geometry?.type === "Point") {
      const here = geometry.coordinates as LngLat;
      if (highway === "street_lamp") lamps.push(here);
      if ((amenity && !NOT_LANDMARKS.has(amenity)) || str(tags.shop) || str(tags.tourism) || str(tags.historic) || highway === "bus_stop") {
        landmarks.push(here);
      }
    }
    if ((amenity && activityAmenities.includes(amenity)) || (str(tags.leisure) && activityLeisure.includes(str(tags.leisure)!))) {
      activityPlaces.push(...pointsOf(geometry));
    }
    if ((amenity && civicAmenities.includes(amenity)) || str(tags.office) === "government") civicPlaces.push(...pointsOf(geometry));
  }

  const index = {
    benches: new SpatialGrid<LngLat>(),
    roads: new SpatialGrid<Road>(),
    privatizers: new SpatialGrid<LngLat>(),
    raisedKerbs: new SpatialGrid<LngLat>(),
    hasBenches: benches.length > 0,
    hasPrivatizers: privatizers.length > 0,
    lamps: new SpatialGrid<LngLat>(),
    // Lamp data is patchy in OSM: an absent lamp only means "unlit" where lamps are mapped at all.
    lampsUsable: lamps.length >= walkways.length * 0.1,
    landmarks: new SpatialGrid<LngLat>(),
    activities: new SpatialGrid<LngLat>(500),
    civic: new SpatialGrid<LngLat>(500),
    hasLandmarks: landmarks.length > 0,
    hasActivities: activityPlaces.length > 0,
    hasCivic: civicPlaces.length > 0,
  };
  for (const l of lamps) index.lamps.addPoint(l, l);
  for (const l of landmarks) index.landmarks.addPoint(l, l);
  for (const a of activityPlaces) index.activities.addPoint(a, a);
  for (const c of civicPlaces) index.civic.addPoint(c, c);
  for (const b of benches) index.benches.addPoint(b, b);
  for (const k of raisedKerbs) index.raisedKerbs.addPoint(k, k);
  for (const q of privatizers) index.privatizers.addPoint(q, q);
  for (const road of roads) {
    const xs = road.coords.map((c) => c[0]);
    const ys = road.coords.map((c) => c[1]);
    index.roads.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), road);
  }

  // Cut ways at nodes that more than one way uses, so junctions become graph nodes.
  const usage = new Map<string, number>();
  for (const way of walkways) for (const id of new Set(way.nodeIds)) usage.set(id, (usage.get(id) ?? 0) + 1);

  const segments: Segment[] = [];
  for (const way of walkways) {
    const cuts = [0];
    for (let i = 1; i < way.nodeIds.length - 1; i += 1) if ((usage.get(way.nodeIds[i]!) ?? 0) > 1) cuts.push(i);
    cuts.push(way.nodeIds.length - 1);

    for (let k = 0; k < cuts.length - 1; k += 1) {
      const start = cuts[k]!;
      const end = cuts[k + 1]!;
      const coords = way.coords.slice(start, end + 1);
      if (coords.length < 2) continue;
      const id = cuts.length > 2 ? `${way.osmId}#${k + 1}` : way.osmId;
      segments.push(describeSegment(id, way, coords, way.nodeIds[start]!, way.nodeIds[end]!, { ...index, noiseIndex: options.noiseIndex }, config));
    }
  }
  return segments;
}

/** How far to look for a bench or a major road before calling it absent (metres). */
const MAX_SEARCH_M = 1000;

interface Road { coords: LngLat[]; roadClass: string; speed?: number }

interface Context {
  benches: SpatialGrid<LngLat>;
  roads: SpatialGrid<Road>;
  privatizers: SpatialGrid<LngLat>;
  raisedKerbs: SpatialGrid<LngLat>;
  hasBenches: boolean;
  hasPrivatizers: boolean;
  lamps: SpatialGrid<LngLat>;
  lampsUsable: boolean;
  landmarks: SpatialGrid<LngLat>;
  activities: SpatialGrid<LngLat>;
  civic: SpatialGrid<LngLat>;
  hasLandmarks: boolean;
  hasActivities: boolean;
  hasCivic: boolean;
  noiseIndex?: NoiseIndex;
}

function describeSegment(
  id: string,
  way: WayPart,
  coords: LngLat[],
  from: string,
  to: string,
  ctx: Context,
  config: WalkwayConfig,
): Segment {
  const tags = way.tags;
  const lengthM = polylineLengthM(coords);
  const sources: Partial<Record<IndicatorKey, ValueSource>> = {};
  const values: Segment["values"] = {};

  const widthM = parseMetres(tags.width) ?? parseMetres(tags["sidewalk:width"]);
  if (widthM !== undefined) {
    values.widthM = widthM;
    sources.width = "osm";
  } else {
    // No width tag: use the typical width for this kind of path from the config.
    // Labelled "estimated" so it is never mistaken for data, and never allowed to
    // trigger a width veto (see vetoReasons).
    const typical = config.autoData.widthDefaults[str(tags.highway) ?? ""];
    if (typical !== undefined) { values.widthM = typical; sources.width = "estimated"; }
  }

  const inclinePct = parseInclinePct(tags.incline);
  if (inclinePct !== undefined) { values.inclinePct = inclinePct; sources.slope = "osm"; }

  const surface = str(tags.surface)?.toLowerCase();
  if (surface) { values.surface = surface; sources.surface = "osm"; }

  values.hasSteps = str(tags.highway) === "steps";
  values.hasRamp = str(tags.ramp) === "yes" || str(tags["ramp:wheelchair"]) === "yes";

  const middle = pointAlong(coords, lengthM / 2);

  // Anything within r of the polyline is within r + length/2 of its middle, so the
  // grid query around the middle never misses a true neighbour.
  const reach = (r: number) => r + lengthM / 2;

  if (ctx.hasBenches) {
    let rest = MAX_SEARCH_M; // no bench within the search radius: far enough to be a total obstacle
    for (const r of [150, 400, MAX_SEARCH_M]) {
      const d = Math.min(...ctx.benches.near(middle, reach(r)).map((b) => pointToPolylineM(b, coords)), Infinity);
      if (d <= r) { rest = d; break; }
    }
    values.restDistanceM = rest;
    sources.rest = "osm";
  }

  if (ctx.raisedKerbs.near(middle, reach(config.kerbAttachM)).some((k) => pointToPolylineM(k, coords) <= config.kerbAttachM)) {
    values.kerbRaised = true;
  }

  const buffer = config.indicators.economic.bufferM;
  const privatizers = ctx.privatizers.near(middle, reach(buffer));
  if (ctx.hasPrivatizers) {
    const steps = Math.max(2, Math.ceil(lengthM / 5));
    let near = 0;
    for (let i = 0; i <= steps; i += 1) {
      const p = pointAlong(coords, (lengthM * i) / steps);
      if (privatizers.some((q) => distanceM(p, q) <= buffer)) near += 1;
    }
    values.privatizedShare = near / (steps + 1);
    sources.economic = "osm";
  }

  // Cognitive and social indicators, all from OpenStreetMap places.
  const places = config.autoData.places;
  const lit = str(tags.lit)?.toLowerCase();
  if (lit === "no") { values.unlitShare = 1; sources.lighting = "osm"; }
  else if (lit && lit !== "disused") { values.unlitShare = 0; sources.lighting = "osm"; }
  else if (ctx.lampsUsable) {
    const lamps = ctx.lamps.near(middle, reach(places.lampRadiusM));
    const steps = Math.max(2, Math.ceil(lengthM / 10));
    let lit = 0;
    for (let i = 0; i <= steps; i += 1) {
      const p = pointAlong(coords, (lengthM * i) / steps);
      if (lamps.some((l) => distanceM(p, l) <= places.lampRadiusM)) lit += 1;
    }
    values.unlitShare = 1 - lit / (steps + 1);
    sources.lighting = "estimated";
  }

  if (ctx.hasLandmarks) {
    values.landmarkCount = ctx.landmarks
      .near(middle, reach(places.landmarkRadiusM))
      .filter((l) => pointToPolylineM(l, coords) <= places.landmarkRadiusM).length;
    sources.landmarks = "osm";
  }

  const nearest = (grid: SpatialGrid<LngLat>): number => {
    for (const r of [300, 1000, 3000]) {
      const d = Math.min(...grid.near(middle, reach(r)).map((q) => pointToPolylineM(q, coords)), Infinity);
      if (d <= r) return d;
    }
    return 3000; // nothing within 3 km: as far as the scale goes
  };
  if (ctx.hasActivities) { values.activityDistanceM = nearest(ctx.activities); sources.activities = "osm"; }
  if (ctx.hasCivic) { values.civicDistanceM = nearest(ctx.civic); sources.civic = "osm"; }

  // Noise: the official map wins. Its gaps are the exception: a segment the map says
  // nothing about, but that lies next to a major road, gets the road-distance
  // estimate instead (labelled "estimated"), because "no band" there most likely
  // means "not covered", not "quiet". Without the map, the estimate is all there is.
  // Nothing in OSM measures noise.
  let nearestRoad: { roadClass: string; speed?: number; d: number } | null = null;
  for (const r of [100, 300, MAX_SEARCH_M]) {
    for (const road of ctx.roads.near(middle, r)) {
      const d = pointToPolylineM(middle, road.coords);
      if (!nearestRoad || d < nearestRoad.d) nearestRoad = { roadClass: road.roadClass, speed: road.speed, d };
    }
    if (nearestRoad && nearestRoad.d <= r) break;
  }
  const estimated = nearestRoad
    ? estimateNoiseDb(nearestRoad.roadClass, nearestRoad.speed, nearestRoad.d, config)
    : undefined;

  if (ctx.noiseIndex) {
    const reading = segmentNoiseReading(coords, lengthM, ctx.noiseIndex, config);
    const gapNextToRoad =
      !reading.anyBand && nearestRoad !== null && nearestRoad.d <= config.autoData.noiseMap.gapFallbackRoadM && estimated !== undefined;
    values.noiseDb = gapNextToRoad ? estimated : reading.db;
    sources.noise = gapNextToRoad ? "estimated" : "official";
  } else if (estimated !== undefined) {
    values.noiseDb = estimated;
    sources.noise = "estimated";
  }

  return { id, name: way.name, from, to, lengthM, geometry: coords, values, sources };
}
