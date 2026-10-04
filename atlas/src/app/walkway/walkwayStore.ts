import { create } from "zustand";
import {
  buildSegments,
  findRoute,
  nearestGraphNode,
  scoreAllProfiles,
  WALKWAY_CONFIG,
  type LngLat,
  type RouteResult,
  type Segment,
  type SegmentScore,
} from "../../domain/walkway/index.js";
import { loadPreset } from "../overpass/client.js";
import { WALKWAY_PRESET } from "../overpass/walkwayPreset.js";
import { useAppStore } from "../state.js";

/** A clicked point, snapped to the nearest junction of the walkway graph. */
export interface RoutePoint {
  node: string;
  coord: LngLat;
}

/** Farther than this from any walkway end, a click is not a usable route point. */
const MAX_SNAP_M = 250;

type LoadState = "idle" | "loading" | "ready" | "error";

interface WalkwayState {
  loadState: LoadState;
  error: string | null;
  segments: Segment[];
  /** profile id -> segment id -> score */
  scores: Record<string, Record<string, SegmentScore>>;
  profileId: string;
  visible: boolean;

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

export const useWalkwayStore = create<WalkwayState>((set, get) => ({
  loadState: "idle",
  error: null,
  segments: [],
  scores: {},
  profileId: Object.keys(WALKWAY_CONFIG.profiles)[0]!,
  visible: true,

  routePicking: null,
  routeFrom: null,
  routeTo: null,
  routes: [],

  load: async ({ forceRefresh = false } = {}) => {
    if (get().loadState === "loading") return;
    set({ loadState: "loading", error: null });
    say("Chargement des troncons pietons (OSM)...");
    try {
      const result = await loadPreset(WALKWAY_PRESET, { forceRefresh });
      const segments = buildSegments(result.geojson, WALKWAY_CONFIG);
      set({ loadState: "ready", segments, scores: scoreEverything(segments), routes: [], routeFrom: null, routeTo: null });
      say(`${segments.length} troncons pietons notes` + (result.fromCache ? " (cache local)." : " (Overpass)."));
    } catch (error) {
      set({ loadState: "error", error: error instanceof Error ? error.message : String(error) });
      say("Echec du chargement des troncons pietons. Verifie la connexion.");
    }
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
