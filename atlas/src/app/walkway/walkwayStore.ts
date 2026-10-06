import { reversePlace } from "./nominatimClient.js";
import { create } from "zustand";
import {
  applyElevations,
  buildNoiseIndex,
  buildSegments,
  detectZones,
  endpointCoordinates,
  findRoute,
  nearestGraphNode,
  scoreAllProfiles,
  WALKWAY_CONFIG,
  type LngLat,
  type NoiseIndex,
  type RouteResult,
  type Segment,
  type SegmentScore,
  buildAmpIndex,
  type AmpData,
  type AmpIndex,
  type ScoredDimension,
  type Zone,
} from "../../domain/walkway/index.js";
import { loadPreset } from "../overpass/client.js";
import { SOCIAL_TILES, WALKWAY_TILES } from "../overpass/walkwayPreset.js";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../state.js";
import { getAltitudes } from "./elevationClient.js";

export type MapLayer = "combined" | ScoredDimension;

/** A clicked point, snapped to the nearest junction of the walkway graph. */
export interface RoutePoint {
  node: string;
  coord: LngLat;
}

/** Farther than this from any walkway end, a click is not a usable route point. */
const MAX_SNAP_M = 250;
const NOISE_MAP_URL = `${import.meta.env.BASE_URL}data/noise_lden_all.geojson`;

type LoadState = "idle" | "loading" | "ready" | "error";

/** What the program filled in by itself, and how far it got. */
export interface AutoDataStatus {
  noise: "official" | "estimate" | "none";
  slope: "idle" | "running" | "done" | "partial" | "error";
  slopeProgress: { done: number; total: number } | null;
  slopeError: string | null;
}

interface WalkwayState {
  loadState: LoadState;
  error: string | null;
  segments: Segment[];
  /** profile id -> segment id -> score */
  scores: Record<string, Record<string, SegmentScore>>;
  profileId: string;
  visible: boolean;
  /** What the walkway lines show: the profile's combined score, or one dimension. */
  layer: MapLayer;
  setLayer: (layer: MapLayer) => void;
  auto: AutoDataStatus;

  /** Priority zones for the selected profile, found automatically. */
  zones: Zone[];
  selectedZoneId: string | null;
  inspectedId: string | null;
  inspectSegment: (id: string | null) => void;
  /** Place names from Nominatim, fetched only for zones a person selects. */
  zonePlaces: Record<string, string>;
  zonesVisible: boolean;

  routePicking: "from" | "to" | null;
  routeFrom: RoutePoint | null;
  routeTo: RoutePoint | null;
  routes: RouteResult[];

  load: (options?: { forceRefresh?: boolean }) => Promise<void>;
  setProfile: (id: string) => void;
  toggleVisible: () => void;
  toggleZones: () => void;
  selectZone: (id: string | null) => void;
  armPicking: (which: "from" | "to" | null) => void;
  pickPoint: (lng: number, lat: number) => void;
  clearRoute: () => void;
}

const say = (message: string) => useAppStore.getState().setStatus(message);

function scoreEverything(segments: Segment[]) {
  const scores: WalkwayState["scores"] = Object.fromEntries(Object.keys(WALKWAY_CONFIG.profiles).map((id) => [id, {}]));
  for (const segment of segments) {
    for (const [profileId, score] of Object.entries(scoreAllProfiles(segment, WALKWAY_CONFIG))) {
      scores[profileId]![segment.id] = score;
    }
  }
  return scores;
}

/** Loads the city tile by tile (one at a time, to go easy on Overpass) and merges them. */
async function loadCity(
  forceRefresh: boolean,
  onProgress: (done: number, total: number) => void,
): Promise<{ geojson: FeatureCollection; fromCache: boolean; failed: number }> {
  const seen = new Set<string>();
  const features: FeatureCollection["features"] = [];
  let fromCache = true;
  let failed = 0;
  let lastError: unknown = null;
  const take = (geojson: FeatureCollection) => {
    for (const f of geojson.features) {
      const key = String(f.id ?? f.properties?.osm_id ?? "");
      if (key) {
        if (seen.has(key)) continue; // a way crossing a tile border comes back in both tiles
        seen.add(key);
      }
      features.push(f);
    }
  };
  // Overpass sometimes answers 429/504 under load. Tiles that fail are retried after a
  // pause (the ones that worked are cached, so a retry only repeats the failures).
  let pending = WALKWAY_TILES.map((_, i) => i);
  for (let pass = 0; pass < 3 && pending.length > 0; pass += 1) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 8000 * pass));
    const next: number[] = [];
    for (const [n, i] of pending.entries()) {
      onProgress(WALKWAY_TILES.length - pending.length + n, WALKWAY_TILES.length);
      try {
        const result = await loadPreset(WALKWAY_TILES[i]!, { forceRefresh });
        if (!result.fromCache) {
          fromCache = false;
          await new Promise((r) => setTimeout(r, 1500)); // go easy on the public servers
        }
        take(result.geojson);
      } catch (error) {
        next.push(i);
        lastError = error;
      }
    }
    pending = next;
  }
  failed = pending.length;

  // Optional extras for the social dimension: one try each, never worth failing the load.
  for (const tile of SOCIAL_TILES) {
    try {
      take((await loadPreset(tile, { forceRefresh })).geojson);
    } catch {
      /* the indicators built on these stay "no data" */
    }
  }
  if (failed === WALKWAY_TILES.length) throw lastError;
  onProgress(WALKWAY_TILES.length, WALKWAY_TILES.length);
  return { geojson: { type: "FeatureCollection", features }, fromCache, failed };
}

function zonesOf(segments: Segment[], scores: WalkwayState["scores"], profileId: string): Zone[] {
  return detectZones(segments, scores[profileId] ?? {}, profileId, WALKWAY_CONFIG);
}

function computeRoutes(segments: Segment[], from: RoutePoint, to: RoutePoint): RouteResult[] {
  return Object.keys(WALKWAY_CONFIG.profiles).map((id) => findRoute(segments, from.node, to.node, id, WALKWAY_CONFIG));
}

/** The official noise map, trimmed to the study area (npm run data:noise). Null if it cannot be read. */
async function loadNoiseIndex(): Promise<NoiseIndex | null> {
  try {
    const response = await fetch(NOISE_MAP_URL);
    if (!response.ok) return null;
    const index = buildNoiseIndex(await response.json());
    return index.polygons.length > 0 ? index : null;
  } catch {
    return null;
  }
}

/**
 * Open data of the Metropole portal (npm run data:amp): public transport, tourist
 * offices, household poverty, priority neighbourhoods and project perimeters.
 * Each file is optional: a missing one leaves the indicators built on it at "no data".
 */
async function loadAmp(): Promise<AmpIndex | undefined> {
  const base = `${import.meta.env.BASE_URL}data/amp/`;
  const get = async <T,>(file: string): Promise<T | undefined> => {
    try {
      const response = await fetch(base + file);
      return response.ok ? ((await response.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  const [transit, tourism, iris, qpv, projects] = await Promise.all([
    get<AmpData["transit"]>("transit.json"),
    get<AmpData["tourism"]>("tourism.json"),
    get<AmpData["iris"]>("iris.geojson"),
    get<AmpData["qpv"]>("qpv.geojson"),
    get<AmpData["projects"]>("projects.geojson"),
  ]);
  if (!transit && !tourism && !iris && !qpv && !projects) return undefined;
  return buildAmpIndex({ transit, tourism, iris, qpv, projects });
}

const IDLE_AUTO: AutoDataStatus = { noise: "none", slope: "idle", slopeProgress: null, slopeError: null };

export const useWalkwayStore = create<WalkwayState>((set, get) => ({
  loadState: "idle",
  error: null,
  segments: [],
  scores: {},
  profileId: Object.keys(WALKWAY_CONFIG.profiles)[0]!,
  visible: true,
  layer: "combined",
  setLayer: (layer) => set({ layer }),
  auto: IDLE_AUTO,

  zones: [],
  selectedZoneId: null,
  inspectedId: null,
  inspectSegment: (inspectedId) => set({ inspectedId }),
  zonePlaces: {},
  zonesVisible: true,

  routePicking: null,
  routeFrom: null,
  routeTo: null,
  routes: [],

  load: async ({ forceRefresh = false } = {}) => {
    if (get().loadState === "loading") return;
    set({ loadState: "loading", error: null, auto: IDLE_AUTO, zones: [], selectedZoneId: null });
    say("Chargement des troncons pietons (OSM) et de la carte de bruit officielle...");
    try {
      const [result, noiseIndex, amp] = await Promise.all([loadCity(forceRefresh, (done, total) => say(`Chargement de la ville : zone ${Math.min(done + 1, total)} sur ${total}...`)), loadNoiseIndex(), loadAmp()]);
      const segments = buildSegments(result.geojson, WALKWAY_CONFIG, { ...(noiseIndex ? { noiseIndex } : {}), ...(amp ? { amp } : {}) });
      const hasRoads = segments.some((s) => s.sources?.noise === "estimated");
      const scores = scoreEverything(segments);
      set({
        loadState: "ready",
        segments,
        scores,
        zones: zonesOf(segments, scores, get().profileId),
        routes: [],
        routeFrom: null,
        routeTo: null,
        auto: { ...IDLE_AUTO, noise: noiseIndex ? "official" : hasRoads ? "estimate" : "none" },
      });
      say(`${segments.length} troncons pietons notes, ${get().zones.length} zones prioritaires` + (result.fromCache ? " (cache local)." : " (Overpass).") + (result.failed ? ` ${result.failed} zone(s) de la ville n'ont pas pu etre chargees : recharge la page.` : ""));
    } catch (error) {
      set({ loadState: "error", error: error instanceof Error ? error.message : String(error) });
      say("Echec du chargement des troncons pietons. Verifie la connexion.");
      return;
    }

    // Slopes come from altitude data and take a moment: the segments are usable
    // meanwhile, and are re-scored once the altitudes arrive.
    const base = get().segments;
    set((s) => ({ auto: { ...s.auto, slope: "running", slopeProgress: { done: 0, total: 0 }, slopeError: null } }));
    const { altitudes, complete, error } = await getAltitudes(endpointCoordinates(base), {
      onProgress: (done, total) => set((s) => ({ auto: { ...s.auto, slopeProgress: { done, total } } })),
    });
    const withSlope = applyElevations(base, altitudes, WALKWAY_CONFIG);
    const { routeFrom, routeTo } = get();
    const rescored = scoreEverything(withSlope);
    set((s) => ({
      segments: withSlope,
      scores: rescored,
      zones: zonesOf(withSlope, rescored, s.profileId),
      selectedZoneId: null,
      routes: routeFrom && routeTo ? computeRoutes(withSlope, routeFrom, routeTo) : s.routes,
      auto: {
        ...s.auto,
        slope: complete ? "done" : Object.keys(altitudes).length > 0 ? "partial" : "error",
        slopeError: error ?? null,
      },
    }));
    const gained = withSlope.filter((s) => s.sources?.slope === "official").length;
    say(complete ? `Pentes calculees pour ${gained} troncons (altitudes IGN) : ${get().zones.length} zones prioritaires.` : `Pentes partielles (${gained} troncons) : ${error ?? "erreur"}.`);
  },

  setProfile: (profileId) =>
    set((s) => ({ profileId, zones: zonesOf(s.segments, s.scores, profileId), selectedZoneId: null })),
  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  toggleZones: () => set((s) => ({ zonesVisible: !s.zonesVisible })),
  selectZone: (selectedZoneId) => {
    set({ selectedZoneId });
    const zone = get().zones.find((z) => z.id === selectedZoneId);
    if (!zone || get().zonePlaces[zone.id]) return;
    const [w, s, e, n] = zone.bbox;
    reversePlace((s + n) / 2, (w + e) / 2)
      .then((place) => {
        if (place) set((st) => ({ zonePlaces: { ...st.zonePlaces, [zone.id]: place.label } }));
      })
      .catch(() => undefined); // a name is a convenience; the zone stands without it
  },

  armPicking: (which) => {
    set({ routePicking: which });
    if (which) {
      say(which === "from" ? "Clique la carte pour le depart." : "Clique la carte pour l'arrivee.");
    }
  },

  pickPoint: (lng, lat) => {
    const { routePicking, segments, routeFrom, routeTo } = get();
    if (!routePicking) return;
    const hit = nearestGraphNode(segments, [lng, lat]);
    if (!hit || hit.distanceM > MAX_SNAP_M) {
      say(`Aucun cheminement a moins de ${MAX_SNAP_M} m de ce point. Clique plus pres d'un troncon.`);
      return;
    }
    const point: RoutePoint = { node: hit.node, coord: hit.coord };
    const from = routePicking === "from" ? point : routeFrom;
    const to = routePicking === "to" ? point : routeTo;
    const routes = from && to ? computeRoutes(segments, from, to) : [];
    set({
      routeFrom: from,
      routeTo: to,
      routes,
      // After the start, go straight on to the end; after both, stop picking.
      routePicking: routePicking === "from" && !to ? "to" : null,
    });
    say(from && to ? "Parcours calcule pour chaque profil." : "Depart place. Clique la carte pour l'arrivee.");
  },

  clearRoute: () => set({ routeFrom: null, routeTo: null, routes: [], routePicking: null }),
}));

// Dev-only handle, matching __map and __store.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__walkway = useWalkwayStore;
