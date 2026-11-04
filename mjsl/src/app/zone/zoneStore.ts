import type { FeatureCollection } from "geojson";
import { create } from "zustand";
import {
  PolygonIndex,
  ZONE_CONFIG,
  buildAmpIndex,
  buildNoiseIndex,
  buildZones,
  rankZones,
  scoreAllProfiles,
  terrainPoints,
  withReports,
  withSlope,
  type AmpData,
  type AmpIndex,
  type NoiseIndex,
  type RankedZone,
  type Report,
  type ReportKind,
  type Dimension,
  type Zone,
  type ZoneScore,
  type LngLat,
} from "../../domain/zone/index.js";
import { loadPreset } from "../overpass/client.js";
import { OSM_TILES, SOCIAL_TILES } from "../overpass/zonePreset.js";
import { useAppStore, type LoadState } from "../state.js";
import { getAltitudes } from "./elevationClient.js";
import { readOwnReports, writeOwnReports, zoneContaining, type OwnReport } from "./ownReports.js";
import { locate } from "./locate.js";

const NOISE_MAP_URL = `${import.meta.env.BASE_URL}data/noise_lden_all.geojson`;
const REPORTS_URL = `${import.meta.env.BASE_URL}data/reports.json`;
const AMP_BASE = `${import.meta.env.BASE_URL}data/amp/`;

/** What the map shows for each zone: the profile's combined score, or one dimension. */
export type MapLayer = "combined" | Dimension;
export type MapBounds = [west: number, south: number, east: number, north: number];

/** What the program filled in by itself, and how far it got. */
interface AutoDataStatus {
  slope: "idle" | "running" | "done" | "partial" | "error";
  slopeProgress: { done: number; total: number } | null;
  slopeError: string | null;
}

export interface ZoneState {
  loadState: LoadState;
  loadProgress: { done: number; total: number } | null;
  error: string | null;
  zones: Zone[];
  /** profile id -> zone id -> score */
  scores: Record<string, Record<string, ZoneScore>>;
  /** Priority zones for the selected profile, worst first. */
  ranking: RankedZone[];
  reports: Report[];
  profileId: string;
  layer: MapLayer;
  /** Last viewport of the interactive map, retained for map exports. */
  viewport: MapBounds;
  visible: boolean;
  reportsVisible: boolean;
  /** Whether to show score tooltip on hovering over a zone. */
  hoverScoreVisible: boolean;
  /** Which kinds of report are drawn (the legend doubles as the filter). */
  reportKinds: Record<ReportKind, boolean>;
  selectedZoneId: string | null;
  /** Reports this person added on this device, counted with the others. */
  ownReports: OwnReport[];
  /** Placing a report: a map click sets the point, until it is saved or cancelled. */
  addMode: boolean;
  pending: { lon: number; lat: number } | null;
  /** A position being looked up, and the last one found (the map flies there). */
  locating: boolean;
  target: { lon: number; lat: number; accuracyM: number; nonce: number } | null;
  auto: AutoDataStatus;

  load: (options?: { forceRefresh?: boolean }) => Promise<void>;
  setProfile: (id: string) => void;
  setLayer: (layer: MapLayer) => void;
  setViewport: (viewport: MapBounds) => void;
  toggleVisible: () => void;
  toggleHoverScore: () => void;
  toggleReports: () => void;
  toggleReportKind: (kind: ReportKind) => void;
  selectZone: (id: string | null) => void;
  toggleAddMode: () => void;
  placeAt: (lon: number, lat: number) => void;
  cancelPending: () => void;
  saveOwnReport: (type: string) => Promise<void>;
  removeOwnReport: (id: string) => Promise<void>;
  locateMe: () => Promise<void>;
}

const say = (message: string) => useAppStore.getState().setStatus(message);

function scoreEverything(
  zones: Zone[],
  prevZones?: Zone[],
  prevScores?: ZoneState["scores"],
): ZoneState["scores"] {
  const profileIds = Object.keys(ZONE_CONFIG.profiles);
  const scores: ZoneState["scores"] = Object.fromEntries(profileIds.map((id) => [id, {}]));
  const prevById = prevZones && prevScores ? new Map(prevZones.map((z) => [z.id, z])) : null;
  for (const zone of zones) {
    if (prevById && prevScores && prevById.get(zone.id) === zone) {
      for (const profileId of profileIds) {
        const existing = prevScores[profileId]?.[zone.id];
        if (existing) scores[profileId]![zone.id] = existing;
      }
      continue;
    }
    for (const [profileId, score] of Object.entries(scoreAllProfiles(zone, ZONE_CONFIG))) {
      scores[profileId]![zone.id] = score;
    }
  }
  return scores;
}

const rankingOf = (zones: Zone[], scores: ZoneState["scores"], profileId: string) => rankZones(zones, scores[profileId] ?? {}, ZONE_CONFIG);

/**
 * Loads the city's OpenStreetMap data. It fetches the local/cached snapshots concurrently
 * using a worker pool for fast loading (< 700ms). Any tile not available locally falls back
 * to the polite sequential Overpass query with pauses to prevent 429/504 errors.
 */
async function loadCity(
  _forceRefresh: boolean,
  onProgress: (done: number, total: number) => void,
): Promise<{ geojson: FeatureCollection; fromCache: boolean; failed: number }> {
  const seen = new Set<string>();
  const features: FeatureCollection["features"] = [];
  let fromCache = true;
  let lastError: unknown = null;
  const take = (geojson: FeatureCollection) => {
    for (const f of geojson.features) {
      const key = String(f.id ?? f.properties?.osm_id ?? "");
      if (key) {
        if (seen.has(key)) continue; // an object crossing a tile border comes back in both tiles
        seen.add(key);
      }
      features.push(f);
    }
  };

  const CONCURRENCY = 8;
  let completed = 0;
  const retryQueue: number[] = [];

  // Always load packaged city snapshots/cache concurrently first: querying 60 whole-city
  // tiles live against public Overpass servers from the browser takes 10+ minutes and triggers 429s.
  let cursor = 0;
  const worker = async () => {
    while (cursor < OSM_TILES.length) {
      const i = cursor++;
      try {
        const result = await loadPreset(OSM_TILES[i]!, { forceRefresh: false });
        if (!result.fromCache) fromCache = false;
        take(result.geojson);
      } catch (error) {
        retryQueue.push(i);
        lastError = error;
      } finally {
        completed += 1;
        onProgress(completed, OSM_TILES.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, OSM_TILES.length) }, worker));

  // Polite sequential retry loop only for tiles that had no snapshot and failed initial load
  let pending = retryQueue;
  for (let pass = 0; pass < 2 && pending.length > 0; pass += 1) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 2000 * pass));
    const next: number[] = [];
    for (const i of pending) {
      try {
        const result = await loadPreset(OSM_TILES[i]!, { forceRefresh: false });
        if (!result.fromCache) {
          fromCache = false;
          await new Promise((r) => setTimeout(r, 1500));
        }
        take(result.geojson);
      } catch (error) {
        next.push(i);
        lastError = error;
      }
    }
    pending = next;
  }
  const failed = pending.length;

  // Optional extras (cameras, crossings, shelters...): fetched concurrently via Promise.allSettled
  await Promise.allSettled(
    SOCIAL_TILES.map(async (tile) => {
      try {
        take((await loadPreset(tile, { forceRefresh: false })).geojson);
      } catch {
        /* the indicators built on these stay "no data" */
      }
    }),
  );

  if (failed === OSM_TILES.length) throw lastError;
  onProgress(OSM_TILES.length, OSM_TILES.length);
  return { geojson: { type: "FeatureCollection", features }, fromCache, failed };
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The official noise map, trimmed to the study area (npm run data:noise). */
async function loadNoiseIndex(): Promise<NoiseIndex | undefined> {
  const data = await getJson<FeatureCollection>(NOISE_MAP_URL);
  if (!data) return undefined;
  const index = buildNoiseIndex(data);
  return index.size > 0 ? index : undefined;
}

/**
 * Open data of the Metropole portal (npm run data:zones): the zones themselves, public
 * transport, tourist offices, priority neighbourhoods and project perimeters. Only the
 * zones are required; each other file is optional and leaves its indicators at "no data".
 */
async function loadAmp(): Promise<{ zones?: FeatureCollection; amp?: AmpIndex }> {
  const [zones, transit, tourism, qpv, projects] = await Promise.all([
    getJson<FeatureCollection>(AMP_BASE + "zones.geojson"),
    getJson<AmpData["transit"]>(AMP_BASE + "transit.json"),
    getJson<AmpData["tourism"]>(AMP_BASE + "tourism.json"),
    getJson<AmpData["qpv"]>(AMP_BASE + "qpv.geojson"),
    getJson<AmpData["projects"]>(AMP_BASE + "projects.geojson"),
  ]);
  const any = transit || tourism || qpv || projects;
  return { zones, amp: any ? buildAmpIndex({ transit, tourism, qpv, projects }) : undefined };
}

/** What the zones are built from. Kept outside the store so a new report re-scores without downloading again. */
let inputs: { collection: FeatureCollection; osm: FeatureCollection; base: Report[] | undefined; amp?: AmpIndex; noiseIndex?: NoiseIndex } | null = null;
/** Altitudes at the grid points, once downloaded (or read from the cache). */
let terrain: Record<string, number> = {};
/** Cached spatial index and built zones so report or slope updates never re-run the expensive OSM/noise joins. */
let cachedZoneIndex: PolygonIndex | null = null;
let cachedBuiltZones: Zone[] | null = null;
let cachedSlopedZones: Zone[] | null = null;
let cachedTerrainPoints: LngLat[] | null = null;

/**
 * Builds the zones from what was loaded plus this device's reports, then scores them.
 * Called after every change, so the map, the ranking and the calculations always agree.
 *
 * - `rebuild: true` re-runs the full OSM/AMP/noise join (only needed when city data loads).
 * - `reslope: true` re-applies terrain altitudes onto `cachedBuiltZones` (~2 ms).
 * - Otherwise (e.g. adding/removing a report), it only re-applies `withReports` (~1.5 ms)!
 */
function recompute(
  options: { rebuild?: boolean; reslope?: boolean; extraState?: Partial<ZoneState> } = {},
): void {
  const state = useZoneStore.getState();
  if (!inputs) return;
  const ownReports = options.extraState?.ownReports ?? state.ownReports;
  const reports = inputs.base ? [...inputs.base, ...ownReports] : ownReports.length > 0 ? [...ownReports] : undefined;

  if (!cachedZoneIndex || options.rebuild) {
    cachedZoneIndex = new PolygonIndex(inputs.collection);
  }
  if (!cachedBuiltZones || options.rebuild) {
    cachedBuiltZones = buildZones(
      {
        zones: inputs.collection,
        osm: inputs.osm,
        ...(inputs.amp ? { amp: inputs.amp } : {}),
        ...(inputs.noiseIndex ? { noiseIndex: inputs.noiseIndex } : {}),
        zoneIndex: cachedZoneIndex,
      },
      ZONE_CONFIG,
    );
    cachedSlopedZones = withSlope(cachedBuiltZones, inputs.collection, terrain, ZONE_CONFIG, cachedZoneIndex);
  } else if (!cachedSlopedZones || options.reslope) {
    cachedSlopedZones = withSlope(cachedBuiltZones, inputs.collection, terrain, ZONE_CONFIG, cachedZoneIndex);
  }

  const baseZones =
    !options.rebuild && !options.reslope && state.zones.length > 0 ? state.zones : cachedSlopedZones;
  const zones = withReports(baseZones, inputs.collection, reports, ZONE_CONFIG, cachedZoneIndex);
  const scores = scoreEverything(zones, state.zones, state.scores);
  useZoneStore.setState({
    ...options.extraState,
    zones,
    scores,
    reports: reports ?? [],
    ranking: rankingOf(zones, scores, state.profileId),
  });
}

const IDLE_AUTO: AutoDataStatus = { slope: "idle", slopeProgress: null, slopeError: null };

export const useZoneStore = create<ZoneState>((set, get) => ({
  loadState: "idle",
  loadProgress: null,
  error: null,
  zones: [],
  scores: {},
  ranking: [],
  reports: [],
  profileId: Object.keys(ZONE_CONFIG.profiles)[0]!,
  layer: "combined",
  viewport: [5.22, 43.17, 5.54, 43.39],
  visible: true,
  reportsVisible: false,
  hoverScoreVisible: true,
  reportKinds: { parking: true, narrow: true, works: true, furniture: true, other: true },
  selectedZoneId: null,
  ownReports: [],
  addMode: false,
  pending: null,
  locating: false,
  target: null,
  auto: IDLE_AUTO,

  load: async ({ forceRefresh = false } = {}) => {
    if (get().loadState === "loading") return;
    set({
      loadState: "loading",
      loadProgress: { done: 0, total: OSM_TILES.length },
      error: null,
      auto: IDLE_AUTO,
    });
    say("Chargement des zones, des donnees OpenStreetMap, des signalements et de la carte de bruit...");
    try {
      const [osm, { zones: collection, amp }, reports, noiseIndex] = await Promise.all([
        loadCity(forceRefresh, (done, total) => {
          set({ loadProgress: { done, total } });
          say(`Chargement de la ville : zone ${Math.min(done + 1, total)} sur ${total}...`);
        }),
        loadAmp(),
        getJson<Report[]>(REPORTS_URL),
        loadNoiseIndex(),
      ]);
      if (!collection) throw new Error("Les zones (data/amp/zones.geojson) sont introuvables : lance « npm run data:zones ».");
      inputs = { collection, osm: osm.geojson, base: reports, amp, noiseIndex };
      cachedZoneIndex = null;
      cachedBuiltZones = null;
      cachedSlopedZones = null;
      cachedTerrainPoints = null;
      const ownReports = await readOwnReports();
      set({
        ownReports,
        loadProgress: { done: OSM_TILES.length, total: OSM_TILES.length },
      });
      say("Calcul des indicateurs d'accessibilite et notation des zones...");
      // Microtask yield: allows the browser to paint progress updates and smooth animations before CPU computation
      await new Promise((resolve) => setTimeout(resolve, 30));
      recompute({ rebuild: true, extraState: { loadState: "ready", loadProgress: null } });
      say(
        `${useZoneStore.getState().zones.length} zones notees` +
          (osm.fromCache ? " (cache local)." : " (Overpass).") +
          (osm.failed ? ` ${osm.failed} partie(s) de la ville n'ont pas pu etre chargees : recharge la page.` : ""),
      );
      await loadSlope();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loadState: "error", loadProgress: null, error: message });
      say("Echec du chargement des zones. Verifie la connexion.");
    }
  },

  setProfile: (profileId) => set((s) => ({ profileId, ranking: rankingOf(s.zones, s.scores, profileId) })),
  setLayer: (layer) => set({ layer }),
  setViewport: (viewport) => set({ viewport }),
  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  toggleHoverScore: () => set((s) => ({ hoverScoreVisible: !s.hoverScoreVisible })),
  toggleReports: () => set((s) => ({ reportsVisible: !s.reportsVisible })),
  toggleReportKind: (kind) => set((s) => ({ reportKinds: { ...s.reportKinds, [kind]: !s.reportKinds[kind] } })),
  selectZone: (selectedZoneId) => set({ selectedZoneId }),

  toggleAddMode: () => set((s) => ({ addMode: !s.addMode, pending: null })),
  placeAt: (lon, lat) => {
    const zone = zoneContaining(get().zones, lon, lat, cachedZoneIndex ?? undefined);
    if (!zone) {
      set({ pending: null });
      say("Ce point est hors de la ville : clique a l'interieur d'une zone de Marseille.");
      return;
    }
    set({ pending: { lon, lat } });
    say(`Point place dans « ${zone.name} ». Choisis le type, puis enregistre.`);
  },
  cancelPending: () => set({ pending: null }),
  saveOwnReport: async (type) => {
    const { pending, ownReports } = get();
    if (!pending) return;
    const next: OwnReport[] = [...ownReports, { id: crypto.randomUUID(), lon: pending.lon, lat: pending.lat, type, addedAt: new Date().toISOString() }];
    recompute({
      rebuild: false,
      extraState: { ownReports: next, pending: null, reportsVisible: true },
    });
    await writeOwnReports(next);
    say(`Signalement enregistre : ${next.length} ajoute(s) sur cet appareil, scores mis a jour.`);
  },
  locateMe: async () => {
    set({ locating: true });
    try {
      const found = await locate();
      set({ target: { lon: found.lon, lat: found.lat, accuracyM: found.accuracyM, nonce: Date.now() } });
      get().placeAt(found.lon, found.lat);
      if (get().pending) say(`Position trouvee (precision ± ${found.accuracyM} m) : choisis le type, puis enregistre.`);
    } catch (error) {
      say(error instanceof Error ? error.message : "Position introuvable.");
    } finally {
      set({ locating: false });
    }
  },
  removeOwnReport: async (id) => {
    const next = get().ownReports.filter((r) => r.id !== id);
    recompute({
      rebuild: false,
      extraState: { ownReports: next },
    });
    await writeOwnReports(next);
    say("Signalement supprime, scores mis a jour.");
  },
}));

/** Slopes come from altitude data and take a moment: the zones are usable meanwhile, and re-scored once the altitudes arrive. */
async function loadSlope() {
  if (!inputs) return;
  const { collection } = inputs;
  useZoneStore.setState((s) => ({ auto: { ...s.auto, slope: "running", slopeProgress: { done: 0, total: 0 }, slopeError: null } }));
  if (!cachedTerrainPoints) {
    cachedTerrainPoints = terrainPoints(collection, ZONE_CONFIG, cachedZoneIndex ?? undefined);
  }
  const { altitudes, complete, error } = await getAltitudes(cachedTerrainPoints, {
    onProgress: (done, total) => useZoneStore.setState((s) => ({ auto: { ...s.auto, slopeProgress: { done, total } } })),
  });
  terrain = altitudes;
  recompute({ rebuild: false, reslope: true });
  useZoneStore.setState((s) => ({
    auto: { ...s.auto, slope: complete ? "done" : Object.keys(altitudes).length > 0 ? "partial" : "error", slopeError: error ?? null },
  }));
  const gained = useZoneStore.getState().zones.filter((z) => z.sources.slope === "official").length;
  say(complete ? `Pentes calculees pour ${gained} zones (altitudes IGN).` : `Pentes partielles (${gained} zones) : ${error ?? "erreur"}.`);
}

// Dev-only handle, so state can be inspected from the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__zones = useZoneStore;
}
