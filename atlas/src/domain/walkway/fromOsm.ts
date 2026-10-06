import { SpatialGrid } from "./spatial.js";
import type { AmpIndex } from "./ampData.js";
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
/** A hiking trail rather than a pavement: see excludeTrails in the config. */
export function isTrail(tags: Tags, config: WalkwayConfig): boolean {
  const highway = str(tags.highway);
  if (highway !== "path" && highway !== "footway" && highway !== "steps") return false;
  const rule = config.autoData.excludeTrails;
  if (rule.tags.some((key) => str(tags[key]) !== undefined)) return true;
  const name = str(tags.name)?.toLowerCase();
  if (name && rule.nameStartsWith.some((p) => name.startsWith(p.toLowerCase()))) return true;
  const surface = str(tags.surface)?.toLowerCase();
  return highway === "path" && surface !== undefined && rule.unpavedSurfaces.includes(surface);
}

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
  options: { noiseIndex?: NoiseIndex; amp?: AmpIndex } = {},
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
  const freePlaces: LngLat[] = [];
  const privatePlaces: LngLat[] = [];
  const controls: LngLat[] = [];
  const shelters: LngLat[] = [];
  const crossings: { p: LngLat; barrier: number }[] = [];
  const signs: LngLat[] = [];
  const infoOffices: LngLat[] = [];
  const freeServices: LngLat[] = [];
  const stepsNoRamp: LngLat[] = []; // middle of each flight of steps with no ramp
  const { activityAmenities, activityLeisure, civicAmenities, freeAmenities, freeLeisure, privateAmenities } = config.autoData.places;

  for (const feature of features) {
    const tags = (feature.properties ?? {}) as Tags;
    const geometry = feature.geometry;
    const highway = str(tags.highway);

    if (geometry?.type === "LineString" && highway && WALKWAY_HIGHWAYS.has(highway) && !isTrail(tags, config)) {
      const coords = coordsOf(geometry)!;
      const ids = Array.isArray(tags.osm_nodes) && tags.osm_nodes.length === coords.length
        ? (tags.osm_nodes as unknown[]).map(String)
        : coords.map(coordKey); // No node ids: connect by identical coordinates.
      if (highway === "steps" && str(tags.ramp) !== "yes" && str(tags["ramp:wheelchair"]) !== "yes") stepsNoRamp.push(pointAlong(coords, polylineLengthM(coords) / 2));
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
    // Persona indicators: crossings, signs, information offices, free services.
    if (geometry?.type === "Point" && highway === "crossing") {
      const kind = str(tags.crossing);
      const equipped = kind === "traffic_signals" || str(tags.tactile_paving) === "yes" || str(tags.traffic_signals) !== undefined;
      crossings.push({ p: geometry.coordinates as LngLat, barrier: equipped ? 0 : kind === "unmarked" ? config.indicators.crossings.unmarked : config.indicators.crossings.marked });
    }
    if (geometry?.type === "Point" && str(tags.tourism) === "information") {
      const info = str(tags.information);
      if (info && config.autoData.places.signageInformation.includes(info)) signs.push(geometry.coordinates as LngLat);
      if (info === "office") infoOffices.push(geometry.coordinates as LngLat);
    }
    if (amenity && config.autoData.places.freeServiceAmenities.includes(amenity) && str(tags.fee) !== "yes") freeServices.push(...pointsOf(geometry).slice(0, 1));

    // Memoire dimension 5: control devices, sheltered places, steps at entrances.
    if (str(tags.man_made) === "surveillance" || ["gate", "lift_gate", "turnstile"].includes(str(tags.barrier) ?? "")) controls.push(...pointsOf(geometry).slice(0, 1));
    if (amenity === "shelter" || str(tags.covered) === "yes" || str(tags.shelter) === "yes" || str(tags["building:part"]) === "arcade") {
      shelters.push(...pointsOf(geometry).slice(0, 1));
    }
    // Free public places versus private ones (memoire, dimension 4).
    const leisure = str(tags.leisure);
    if ((amenity && freeAmenities.includes(amenity)) || (leisure && freeLeisure.includes(leisure))) {
      if (str(tags.fee) !== "yes") freePlaces.push(...pointsOf(geometry));
    }
    if ((amenity && privateAmenities.includes(amenity)) || str(tags.outdoor_seating) === "yes") privatePlaces.push(...pointsOf(geometry));
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
    free: new SpatialGrid<LngLat>(),
    private: new SpatialGrid<LngLat>(),
    hasFreeOrPrivate: freePlaces.length + privatePlaces.length > 0,
    controls: new SpatialGrid<LngLat>(),
    shelters: new SpatialGrid<LngLat>(),
    crossings: new SpatialGrid<{ p: LngLat; barrier: number }>(),
    signs: new SpatialGrid<LngLat>(),
    info: new SpatialGrid<LngLat>(500),
    freeServices: new SpatialGrid<LngLat>(500),
    hasCrossings: crossings.length > 0,
    hasSigns: signs.length > 0,
    hasInfo: infoOffices.length > 0,
    hasFreeServices: freeServices.length > 0,
    hasControls: controls.length > 0,
    hasShelters: shelters.length > 0,
    // Steps count as a threshold only when a place (shop, cafe...) is right beside them.
    thresholds: new SpatialGrid<LngLat>(),
  };
  for (const l of lamps) index.lamps.addPoint(l, l);
  for (const l of landmarks) index.landmarks.addPoint(l, l);
  for (const a of activityPlaces) index.activities.addPoint(a, a);
  for (const c of civicPlaces) index.civic.addPoint(c, c);
  for (const c of crossings) index.crossings.addPoint(c.p, c);
  for (const sg of signs) index.signs.addPoint(sg, sg);
  for (const o of infoOffices) index.info.addPoint(o, o);
  for (const f of freeServices) index.freeServices.addPoint(f, f);
  for (const c of controls) index.controls.addPoint(c, c);
  for (const sh of shelters) index.shelters.addPoint(sh, sh);
  for (const st of stepsNoRamp) {
    const near = index.landmarks.near(st, config.autoData.places.stepsNearPlaceM);
    if (near.some((l) => distanceM(st, l) <= config.autoData.places.stepsNearPlaceM)) index.thresholds.addPoint(st, st);
  }
  for (const f of freePlaces) index.free.addPoint(f, f);
  for (const q of privatePlaces) index.private.addPoint(q, q);
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
      segments.push(describeSegment(id, way, coords, way.nodeIds[start]!, way.nodeIds[end]!, { ...index, noiseIndex: options.noiseIndex, amp: options.amp }, config));
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
  free: SpatialGrid<LngLat>;
  private: SpatialGrid<LngLat>;
  hasFreeOrPrivate: boolean;
  controls: SpatialGrid<LngLat>;
  shelters: SpatialGrid<LngLat>;
  thresholds: SpatialGrid<LngLat>;
  hasControls: boolean;
  hasShelters: boolean;
  crossings: SpatialGrid<{ p: LngLat; barrier: number }>;
  signs: SpatialGrid<LngLat>;
  info: SpatialGrid<LngLat>;
  freeServices: SpatialGrid<LngLat>;
  hasCrossings: boolean;
  hasSigns: boolean;
  hasInfo: boolean;
  hasFreeServices: boolean;
  noiseIndex?: NoiseIndex;
  amp?: AmpIndex;
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

  // Steps with no ramp next to a place (always known once walkways are loaded: no steps means 0).
  values.thresholdSteps = ctx.thresholds
    .near(middle, reach(places.stepsNearPlaceM))
    .filter((st) => pointToPolylineM(st, coords) <= places.stepsNearPlaceM).length;
  sources.thresholds = "osm";

  if (ctx.hasControls) {
    values.controlDevices = ctx.controls
      .near(middle, reach(places.cameraRadiusM))
      .filter((q) => pointToPolylineM(q, coords) <= places.cameraRadiusM).length;
    sources.surveillance = "osm";
  }

  if (ctx.hasShelters) {
    values.shelterCount = ctx.shelters
      .near(middle, reach(places.shelterRadiusM))
      .filter((q) => pointToPolylineM(q, coords) <= places.shelterRadiusM).length;
    sources.shelter = "osm";
  }

  if (ctx.hasFreeOrPrivate) {
    const r = places.publicPrivateRadiusM;
    const within = (grid: SpatialGrid<LngLat>) => grid.near(middle, reach(r)).filter((q) => pointToPolylineM(q, coords) <= r).length;
    const free = within(ctx.free);
    const priv = within(ctx.private);
    if (free + priv > 0) {
      values.privateShare = priv / (free + priv);
      sources.publicPrivate = "osm";
    }
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

  // Indicators of the six personas (client's list), from OSM and the open data portal.
  if (ctx.hasFreeServices) { values.freeServiceDistanceM = nearest(ctx.freeServices); sources.freeServices = "osm"; }
  if (ctx.hasSigns) {
    values.signageCount = ctx.signs
      .near(middle, reach(places.signageRadiusM))
      .filter((q) => pointToPolylineM(q, coords) <= places.signageRadiusM).length;
    sources.signage = "osm";
  }
  if (ctx.hasCrossings) {
    let best: { d: number; barrier: number } | null = null;
    for (const c of ctx.crossings.near(middle, reach(places.crossingRadiusM))) {
      const d = pointToPolylineM(c.p, coords);
      if (d <= places.crossingRadiusM && (!best || d < best.d)) best = { d, barrier: c.barrier };
    }
    if (best) { values.crossingBarrier = best.barrier; sources.crossings = "osm"; }
  }
  const straight = distanceM(coords[0]!, coords[coords.length - 1]!);
  if (straight >= 10) { values.sinuosity = lengthM / straight; sources.legibility = "osm"; }

  const amp = ctx.amp;
  if (amp?.hasTransit) {
    const modes = new Set<string>();
    for (const stop of amp.transit.near(middle, reach(places.transitRadiusM))) {
      if (pointToPolylineM(stop.p, coords) <= places.transitRadiusM) modes.add(stop.mode);
    }
    values.transitModes = modes.size;
    sources.transit = "official";
  }
  if (amp?.hasTourism || ctx.hasInfo) {
    let d = Infinity;
    if (ctx.hasInfo) d = Math.min(d, nearest(ctx.info));
    if (amp?.hasTourism) d = Math.min(d, nearest(amp.tourism));
    values.infoDistanceM = d;
    sources.infoCentres = amp?.hasTourism ? "official" : "osm";
  }
  if (amp) {
    const poverty = amp.iris.at(middle).map((p) => p.poverty).find((v): v is number => typeof v === "number");
    if (poverty !== undefined) { values.areaPovertyPct = poverty; sources.poverty = "official"; }
    if (amp.hasParticipation) { values.inParticipationArea = amp.participation.at(middle).length > 0; sources.participation = "official"; }
  }

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
