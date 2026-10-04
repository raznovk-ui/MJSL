import { create } from "zustand";
import {
  applyElevations,
  buildNoiseIndex,
  buildSegments,
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
} from "../../domain/walkway/index.js";
import { loadPreset } from "../overpass/client.js";
import { WALKWAY_PRESET } from "../overpass/walkwayPreset.js";
import { useAppStore } from "../state.js";
import { getAltitudes } from "./elevationClient.js";

/** A clicked point, snapped to the nearest junction of the walkway graph. */
export interface RoutePoint {
  node: string;
  coord: LngLat;
}

/** Farther than this from any walkway end, a click is not a usable route point. */
const MAX_SNAP_M = 250;
const NOISE_MAP_URL = `${import.meta.env.BASE_URL}data/noise_lden_road.geojson`;

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
  auto: AutoDataStatus;

  routePicking: "from" | "to" | null;
  routeFrom: RoutePoint | null;
  routeTo: RoutePoint | null;
  routes: RouteResult[];

  load: (options?: { forceRefresh?: boolean }) => Promise<void>;
  setProfile: (id: string) => void;
  toggleVisible: () => void;
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

const IDLE_AUTO: AutoDataStatus = { noise: "none", slope: "idle", slopeProgress: null, slopeError: null };

export const useWalkwayStore = create<WalkwayState>((set, get) => ({
  loadState: "idle",
  error: null,
  segments: [],
  scores: {},
  profileId: Object.keys(WALKWAY_CONFIG.profiles)[0]!,
  visible: true,
  auto: IDLE_AUTO,

  routePicking: null,
  routeFrom: null,
  routeTo: null,
  routes: [],

  load: async ({ forceRefresh = false } = {}) => {
    if (get().loadState === "loading") return;
    set({ loadState: "loading", error: null, auto: IDLE_AUTO });
    say("Chargement des troncons pietons (OSM) et de la carte de bruit officielle...");
    try {
      const [result, noiseIndex] = await Promise.all([loadPreset(WALKWAY_PRESET, { forceRefresh }), loadNoiseIndex()]);
      const segments = buildSegments(result.geojson, WALKWAY_CONFIG, noiseIndex ? { noiseIndex } : {});
      const hasRoads = segments.some((s) => s.sources?.noise === "estimated");
      set({
        loadState: "ready",
        segments,
        scores: scoreEverything(segments),
        routes: [],
        routeFrom: null,
        routeTo: null,
        auto: { ...IDLE_AUTO, noise: noiseIndex ? "official" : hasRoads ? "estimate" : "none" },
      });
      say(`${segments.length} troncons pietons notes` + (result.fromCache ? " (cache local)." : " (Overpass)."));
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
    set((s) => ({
      segments: withSlope,
      scores: scoreEverything(withSlope),
      routes: routeFrom && routeTo ? computeRoutes(withSlope, routeFrom, routeTo) : s.routes,
      auto: {
        ...s.auto,
        slope: complete ? "done" : Object.keys(altitudes).length > 0 ? "partial" : "error",
        slopeError: error ?? null,
      },
    }));
    const gained = withSlope.filter((s) => s.sources?.slope === "official").length;
    say(complete ? `Pentes calculees pour ${gained} troncons (altitudes IGN).` : `Pentes partielles (${gained} troncons) : ${error ?? "erreur"}.`);
  },

  setProfile: (profileId) => set({ profileId }),
  toggleVisible: () => set((s) => ({ visible: !s.visible })),

  armPicking: (which) => {
    set({ routePicking: which });
    if (which) {
      useAppStore.setState({ addPointMode: false, addRuptureMode: false, placingPhotoId: null });
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
