import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AmpIndex } from "./ampData.js";
import { KX, KY, bboxOfCoordinates, coordKey, distanceM, polylineLengthM } from "./geo.js";
import type { ZoneConfig } from "./loadConfig.js";
import { bandAt, type NoiseIndex } from "./noiseMap.js";
import { PolygonIndex, SpatialGrid } from "./spatial.js";
import type { LngLat, Report, ReportKind, ValueSource, Zone } from "./types.js";
import { anchorOf, areaAndCentroid } from "./zoneGeometry.js";

type Tags = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** "1.5", "1,5 m", "150 cm" -> metres. */
function parseMetres(value: unknown): number | undefined {
  const s = str(value)?.toLowerCase().replace(",", ".");
  if (!s) return undefined;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return undefined;
  return s.includes("cm") ? n / 100 : n;
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const reportKindCache = new WeakMap<ZoneConfig, Map<string, ReportKind>>();

/** Sorts a citizen report into a kind, from the type the citizen chose. */
export function reportKind(type: string, config: ZoneConfig): ReportKind {
  let byType = reportKindCache.get(config);
  if (!byType) {
    byType = new Map<string, ReportKind>();
    reportKindCache.set(config, byType);
  }
  const cached = byType.get(type);
  if (cached !== undefined) return cached;

  const t = plain(type);
  let resolved: ReportKind = "other";
  for (const kind of ["parking", "narrow", "works", "furniture"] as const) {
    if (config.reports[kind].some((word) => t.includes(plain(word)))) {
      resolved = kind;
      break;
    }
  }
  byType.set(type, resolved);
  return resolved;
}

/** A hiking trail rather than a pavement: see excludeTrails in the config. */
function isTrail(tags: Tags, config: ZoneConfig): boolean {
  const highway = str(tags.highway);
  if (highway !== "path" && highway !== "footway" && highway !== "steps") return false;
  const rule = config.autoData.excludeTrails;
  if (rule.tags.some((key) => str(tags[key]) !== undefined)) return true;
  const name = str(tags.name)?.toLowerCase();
  if (name && rule.nameStartsWith.some((p) => name.startsWith(p.toLowerCase()))) return true;
  const surface = str(tags.surface)?.toLowerCase();
  return highway === "path" && surface !== undefined && rule.unpavedSurfaces.includes(surface);
}

interface Acc {
  streetM: number;
  taggedWays: number;
  wideWays: number;
  roughSum: number; roughLen: number;
  glareSum: number; glareLen: number;
  litTaggedM: number; unlitM: number;
  sinSum: number; sinLen: number;
  noiseSum: number; noiseN: number;
  outsideN: number; sampleN: number;
  modes: Set<string>;
  n: Record<string, number>;
}

const newAcc = (): Acc => ({
  streetM: 0, taggedWays: 0, wideWays: 0, roughSum: 0, roughLen: 0, glareSum: 0, glareLen: 0,
  litTaggedM: 0, unlitM: 0, sinSum: 0, sinLen: 0, noiseSum: 0, noiseN: 0, outsideN: 0, sampleN: 0,
  modes: new Set(), n: {},
});

const bump = (acc: Acc, key: string, by = 1) => { acc.n[key] = (acc.n[key] ?? 0) + by; };

/** Every point (lng, lat) of the regular lattice of `gridM` metres that lies inside the zones. */
function lattice(bbox: [number, number, number, number], gridM: number): { i: number; j: number; p: LngLat }[] {
  const dLon = gridM / KX;
  const dLat = gridM / KY;
  const out: { i: number; j: number; p: LngLat }[] = [];
  for (let i = Math.ceil(bbox[0] / dLon); i * dLon <= bbox[2]; i += 1) {
    for (let j = Math.ceil(bbox[1] / dLat); j * dLat <= bbox[3]; j += 1) out.push({ i, j, p: [Number((i * dLon).toFixed(6)), Number((j * dLat).toFixed(6))] });
  }
  return out;
}

const bboxOf = (zones: FeatureCollection) =>
  bboxOfCoordinates(zones.features.map((f) => (f.geometry as { coordinates: unknown } | null)?.coordinates ?? []));

interface BuildInput {
  /** The zones: polygons with `id`, `name`, `arr`, `poverty`, `households` properties (scripts/fetchAmp.mjs). */
  zones: FeatureCollection;
  /** Loaded OpenStreetMap features (as produced by osmToGeojson). */
  osm: FeatureCollection;
  reports?: Report[];
  amp?: AmpIndex;
  noiseIndex?: NoiseIndex;
  /** Optional pre-built PolygonIndex for `zones` to avoid rebuilding it. */
  zoneIndex?: PolygonIndex;
}

const reportZoneCache = new WeakMap<PolygonIndex, WeakMap<Report, string>>();

/**
 * Applies citizen reports to already-built zones without re-running the expensive
 * OpenStreetMap, noise map and AMP spatial joins.
 */
export function withReports(
  zones: Zone[],
  zoneCollection: FeatureCollection,
  reports: Report[] | undefined,
  config: ZoneConfig,
  existingIndex?: PolygonIndex,
): Zone[] {
  const index = existingIndex ?? new PolygonIndex(zoneCollection);
  let byReport = reportZoneCache.get(index);
  if (!byReport) {
    byReport = new WeakMap<Report, string>();
    reportZoneCache.set(index, byReport);
  }
  const reportCounts = new Map<string, Record<ReportKind, number>>();
  if (reports) {
    for (const r of reports) {
      let id = byReport.get(r);
      if (id === undefined) {
        const hit = index.at([r.lon, r.lat])[0];
        id = hit ? String(hit.id) : "";
        byReport.set(r, id);
      }
      if (!id) continue;
      const counts = reportCounts.get(id) ?? { parking: 0, narrow: 0, works: 0, furniture: 0, other: 0 };
      counts[reportKind(r.type, config)] += 1;
      reportCounts.set(id, counts);
    }
  }

  return zones.map((zone) => {
    const dense = zone.streetKm >= config.autoData.minStreetKm;
    const perKm = (n: number) => (dense ? n / zone.streetKm : undefined);
    const rc = reportCounts.get(zone.id);

    const values = { ...zone.values };
    const sources = { ...zone.sources };
    delete values.parkingReports;
    delete values.narrowReports;
    delete values.worksReports;
    delete values.furnitureReports;
    delete sources.parkingReports;
    delete sources.narrowReports;
    delete sources.worksReports;
    delete sources.furnitureReports;

    if (reports) {
      const set = (key: string, val: number | undefined) => {
        if (val !== undefined && Number.isFinite(val)) {
          values[key] = val;
          sources[key] = "reported";
        }
      };
      set("parkingReports", perKm(rc?.parking ?? 0));
      set("narrowReports", perKm(rc?.narrow ?? 0));
      set("worksReports", perKm(rc?.works ?? 0));
      set("furnitureReports", perKm(rc?.furniture ?? 0));
    }

    const counts = { ...zone.counts };
    delete counts.reportsParking;
    delete counts.reportsNarrow;
    delete counts.reportsWorks;
    delete counts.reportsFurniture;
    delete counts.reportsOther;
    if (rc) {
      counts.reportsParking = rc.parking;
      counts.reportsNarrow = rc.narrow;
      counts.reportsWorks = rc.works;
      counts.reportsFurniture = rc.furniture;
      counts.reportsOther = rc.other;
    }

    const sameValues =
      zone.values.parkingReports === values.parkingReports &&
      zone.values.narrowReports === values.narrowReports &&
      zone.values.worksReports === values.worksReports &&
      zone.values.furnitureReports === values.furnitureReports &&
      zone.sources.parkingReports === sources.parkingReports &&
      zone.sources.narrowReports === sources.narrowReports &&
      zone.sources.worksReports === sources.worksReports &&
      zone.sources.furnitureReports === sources.furnitureReports;
    const sameCounts =
      zone.counts.reportsParking === counts.reportsParking &&
      zone.counts.reportsNarrow === counts.reportsNarrow &&
      zone.counts.reportsWorks === counts.reportsWorks &&
      zone.counts.reportsFurniture === counts.reportsFurniture &&
      zone.counts.reportsOther === counts.reportsOther;

    if (sameValues && sameCounts) return zone;

    return { ...zone, values, sources, counts };
  });
}

/**
 * Works out every indicator for every zone from every dataset, with its source.
 *
 * Nothing is invented: an indicator with no basis in the data (no tagged width, no
 * crossing, no street) is left out and counts as "no data", never as 0. Densities are
 * per kilometre of street, so a large zone is not penalised for being large, and are
 * left out for a zone with too little street to be meaningful.
 */
export function buildZones({ zones: zoneCollection, osm, reports, amp, noiseIndex, zoneIndex }: BuildInput, config: ZoneConfig): Zone[] {
  const index = zoneIndex ?? new PolygonIndex(zoneCollection);
  const zoneAt = (p: LngLat | null): string | undefined => {
    if (!p) return undefined;
    const hit = index.at(p)[0];
    return hit ? String(hit.id) : undefined;
  };
  const accs = new Map<string, Acc>();
  const accOf = (id: string) => {
    let a = accs.get(id);
    if (!a) { a = newAcc(); accs.set(id, a); }
    return a;
  };

  const { places, streetHighways, surfaceGlare, surfaceRoughness } = config.autoData;
  const civicGrid = new SpatialGrid<LngLat>(500);
  const infoGrid = new SpatialGrid<LngLat>(500);
  const seen = { civic: 0, info: 0, benches: 0, signs: 0, landmarks: 0, freeServices: 0, shelters: 0, controls: 0, activities: 0, any: 0 };

  // ---- OpenStreetMap
  for (const feature of osm.features as Feature[]) {
    const tags = (feature.properties ?? {}) as Tags;
    const g = feature.geometry;
    const anchor = anchorOf(g);
    if (!anchor) continue;
    const highway = str(tags.highway);
    const amenity = str(tags.amenity);
    const leisure = str(tags.leisure);
    const isPoint = g?.type === "Point";

    // Places of the whole city (for the distances from a zone's centre).
    if ((amenity && places.civicAmenities.includes(amenity)) || str(tags.office) === "government") { civicGrid.addPoint(anchor, anchor); seen.civic += 1; }
    if (isPoint && str(tags.tourism) === "information" && str(tags.information) === "office") { infoGrid.addPoint(anchor, anchor); seen.info += 1; }

    const id = zoneAt(anchor);
    if (!id) continue;
    const acc = accOf(id);

    if (g?.type === "LineString" && highway && streetHighways.includes(highway) && !isTrail(tags, config)) {
      const coords = g.coordinates as LngLat[];
      const len = polylineLengthM(coords);
      acc.streetM += len;
      if (highway === "steps" && str(tags.ramp) !== "yes" && str(tags["ramp:wheelchair"]) !== "yes") bump(acc, "steps");

      const width = parseMetres(tags.width) ?? parseMetres(tags["sidewalk:width"]);
      if (width !== undefined) {
        acc.taggedWays += 1;
        if (width >= config.autoData.coPresenceWidthM) acc.wideWays += 1;
      }
      const surface = str(tags.surface)?.toLowerCase();
      if (surface && surfaceRoughness[surface] !== undefined) { acc.roughSum += surfaceRoughness[surface]! * len; acc.roughLen += len; }
      if (surface && surfaceGlare[surface] !== undefined) { acc.glareSum += surfaceGlare[surface]! * len; acc.glareLen += len; }
      const lit = str(tags.lit)?.toLowerCase();
      if (lit && lit !== "disused") { acc.litTaggedM += len; if (lit === "no") acc.unlitM += len; }
      const straight = distanceM(coords[0]!, coords[coords.length - 1]!);
      if (straight >= 10) { acc.sinSum += (len / straight) * len; acc.sinLen += len; }
    }

    if (amenity === "bench") { bump(acc, "benches"); seen.benches += 1; }
    if ((amenity && places.freeAmenities.includes(amenity)) || (leisure && places.freeLeisure.includes(leisure))) {
      if (str(tags.fee) !== "yes") bump(acc, "freePlaces");
    }
    if ((amenity && places.privateAmenities.includes(amenity)) || str(tags.outdoor_seating) === "yes") bump(acc, "privatePlaces");
    if (amenity && places.freeServiceAmenities.includes(amenity) && str(tags.fee) !== "yes") { bump(acc, "freeServices"); seen.freeServices += 1; }
    if ((amenity && places.activityAmenities.includes(amenity)) || (leisure && places.activityLeisure.includes(leisure))) { bump(acc, "activities"); seen.activities += 1; }
    if (amenity === "shelter" || str(tags.covered) === "yes" || str(tags.shelter) === "yes" || str(tags["building:part"]) === "arcade") { bump(acc, "shelters"); seen.shelters += 1; }
    if (isPoint) {
      if (str(tags.man_made) === "surveillance" || ["gate", "lift_gate", "turnstile"].includes(str(tags.barrier) ?? "")) { bump(acc, "controls"); seen.controls += 1; }
      if (highway === "crossing") {
        bump(acc, "crossings");
        const equipped = str(tags.crossing) === "traffic_signals" || str(tags.tactile_paving) === "yes" || str(tags.traffic_signals) !== undefined;
        if (equipped) bump(acc, "crossingsEquipped");
      }
      if (str(tags.tourism) === "information" && places.signageInformation.includes(str(tags.information) ?? "")) { bump(acc, "signs"); seen.signs += 1; }
      if ((amenity && !places.notLandmarks.includes(amenity)) || str(tags.shop) || str(tags.tourism) || str(tags.historic) || highway === "bus_stop") { bump(acc, "landmarks"); seen.landmarks += 1; }
    }
    seen.any += 1;
  }

  // ---- Public transport (open data)
  for (const stop of amp?.transit ?? []) {
    const id = zoneAt(stop.p);
    if (id) accOf(id).modes.add(stop.mode);
  }

  // ---- Sampled over the area of each zone: noise and co-participation devices
  const sampleBox = bboxOf(zoneCollection);
  if (Number.isFinite(sampleBox[0]) && (noiseIndex || amp)) {
    const { bandMidpointOffsetDb, belowThresholdDb } = config.autoData.noiseMap;
    const hasParticipation = Boolean(amp && amp.participation.size > 0);
    for (const { p } of lattice(sampleBox, config.autoData.sampleGridM)) {
      const id = zoneAt(p);
      if (!id) continue;
      const acc = accOf(id);
      acc.sampleN += 1;
      if (noiseIndex) {
        const band = bandAt(noiseIndex, p);
        acc.noiseSum += band === null ? belowThresholdDb : band + bandMidpointOffsetDb;
        acc.noiseN += 1;
      }
      if (hasParticipation && amp!.participation.at(p).length === 0) acc.outsideN += 1;
    }
  }

  // ---- Assemble the zones
  const nearest = (grid: SpatialGrid<LngLat>, from: LngLat): number => {
    for (const r of [1000, 3000, 10000]) {
      const d = Math.min(...grid.near(from, r).map((q) => distanceM(from, q)), Infinity);
      if (d <= r) return d;
    }
    return 10000;
  };

  let tourismGrid: SpatialGrid<LngLat> | null = null;
  if (amp?.tourism.length) {
    tourismGrid = new SpatialGrid<LngLat>(500);
    for (const q of amp.tourism) tourismGrid.addPoint(q, q);
  }

  const out: Zone[] = [];
  for (const feature of zoneCollection.features as Feature[]) {
    const g = feature.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const p = (feature.properties ?? {}) as Tags;
    const id = String(p.id ?? "");
    if (!id) continue;
    const acc = accs.get(id) ?? newAcc();
    const { areaKm2, centroid } = areaAndCentroid(g as Polygon | MultiPolygon);
    const streetKm = acc.streetM / 1000;
    const dense = streetKm >= config.autoData.minStreetKm;
    const values: Record<string, number> = {};
    const sources: Record<string, ValueSource> = {};
    const set = (key: string, value: number | undefined, source: ValueSource) => {
      if (value === undefined || !Number.isFinite(value)) return;
      values[key] = value;
      sources[key] = source;
    };
    const perKm = (n: number) => (dense ? n / streetKm : undefined);
    const n = (key: string) => acc.n[key] ?? 0;

    set("steps", perKm(n("steps")), "osm");
    if (amp && amp.transit.length > 0) set("transit", acc.modes.size, "official");
    if (acc.roughLen >= 100) set("surface", acc.roughSum / acc.roughLen, "osm");
    if (seen.benches > 0) set("rest", perKm(n("benches")), "osm");

    if (acc.noiseN > 0) set("noise", acc.noiseSum / acc.noiseN, "official");
    if (n("crossings") > 0) set("crossings", 1 - n("crossingsEquipped") / n("crossings"), "osm");
    if (acc.glareLen >= 100) set("glare", acc.glareSum / acc.glareLen, "osm");
    if (seen.signs > 0) set("signage", perKm(n("signs")), "osm");
    if (acc.litTaggedM >= 200) set("lighting", acc.unlitM / acc.litTaggedM, "osm");

    if (acc.sinLen >= 200) set("legibility", acc.sinSum / acc.sinLen, "osm");
    if (seen.landmarks > 0) set("landmarks", perKm(n("landmarks")), "osm");
    if (seen.info > 0 || tourismGrid) {
      let d = Infinity;
      if (tourismGrid) d = Math.min(d, nearest(tourismGrid, centroid));
      if (seen.info > 0) d = Math.min(d, nearest(infoGrid, centroid));
      set("infoCentres", d, tourismGrid ? "official" : "osm");
    }

    if (n("freePlaces") + n("privatePlaces") > 0) set("publicPrivate", n("privatePlaces") / (n("freePlaces") + n("privatePlaces")), "osm");
    if (seen.freeServices > 0) set("freeServices", perKm(n("freeServices")), "osm");

    const poverty = typeof p.poverty === "number" ? p.poverty : undefined;
    set("poverty", poverty, "official");
    if (seen.shelters > 0) set("shelter", perKm(n("shelters")), "osm");
    if (seen.controls > 0) set("surveillance", perKm(n("controls")), "osm");
    if (acc.taggedWays >= config.autoData.minTaggedWays) set("coPresence", 1 - acc.wideWays / acc.taggedWays, "osm");
    if (seen.activities > 0) set("activities", perKm(n("activities")), "osm");

    if (amp && amp.participation.size > 0 && acc.sampleN > 0) {
      set("participation", config.autoData.participation.outsideBarrier * (acc.outsideN / acc.sampleN), "official");
    }
    if (seen.civic > 0) set("civic", nearest(civicGrid, centroid), "osm");

    out.push({
      id,
      name: String(p.name ?? id),
      zoneType: p.type === "activite" || p.type === "divers" ? p.type : "habitat",
      arrondissement: String(p.arr ?? ""),
      geometry: g as Polygon | MultiPolygon,
      areaKm2,
      centroid,
      streetKm,
      households: typeof p.households === "number" ? p.households : 0,
      values,
      sources,
      counts: {
        steps: n("steps"), benches: n("benches"), crossings: n("crossings"), signs: n("signs"),
        landmarks: n("landmarks"), shelters: n("shelters"), cameras: n("controls"), freeServices: n("freeServices"),
        activities: n("activities"), freePlaces: n("freePlaces"), privatePlaces: n("privatePlaces"),
      },
    });
  }

  return reports !== undefined ? withReports(out, zoneCollection, reports, config, index) : out;
}

/** Points of the altitude grid (inside a zone) to fetch from the altimetry service. */
export function terrainPoints(zones: FeatureCollection, config: ZoneConfig, existingIndex?: PolygonIndex): LngLat[] {
  const index = existingIndex ?? new PolygonIndex(zones);
  return lattice(bboxOf(zones), config.autoData.terrainGridM).filter(({ p }) => index.at(p).length > 0).map(({ p }) => p);
}

/**
 * Mean slope per zone, in percent: between each altitude point and its east and north
 * neighbours, when both lie in the same zone. Returns zones with `slope` filled in
 * (source "official": IGN RGE ALTI), the others unchanged.
 */
export function withSlope(
  zones: Zone[],
  collection: FeatureCollection,
  altitudes: Record<string, number>,
  config: ZoneConfig,
  existingIndex?: PolygonIndex,
): Zone[] {
  if (Object.keys(altitudes).length === 0) return zones;
  const index = existingIndex ?? new PolygonIndex(collection);
  const grid = config.autoData.terrainGridM;
  const cells = new Map<string, { zone: string; z: number }>();
  for (const { i, j, p } of lattice(bboxOf(collection), grid)) {
    const z = altitudes[coordKey(p)];
    if (z === undefined) continue;
    const hit = index.at(p)[0];
    if (hit) cells.set(`${i},${j}`, { zone: String(hit.id), z });
  }
  const sums = new Map<string, { sum: number; n: number }>();
  for (const [key, here] of cells) {
    const [i, j] = key.split(",").map(Number) as [number, number];
    for (const next of [`${i + 1},${j}`, `${i},${j + 1}`]) {
      const there = cells.get(next);
      if (!there || there.zone !== here.zone) continue;
      const s = sums.get(here.zone) ?? { sum: 0, n: 0 };
      s.sum += (Math.abs(there.z - here.z) / grid) * 100;
      s.n += 1;
      sums.set(here.zone, s);
    }
  }
  return zones.map((zone) => {
    const s = sums.get(zone.id);
    if (!s || s.n < 3) return zone;
    return { ...zone, values: { ...zone.values, slope: s.sum / s.n }, sources: { ...zone.sources, slope: "official" } };
  });
}
