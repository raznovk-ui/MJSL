import type { FeatureCollection } from "geojson";
import { create } from "zustand";
import {
  PolygonIndex,
  ZONE_CONFIG,
  MARSEILLE_TERRITORY,
  buildAmpIndex,
  buildEconomicIndex,
  buildNoiseIndex,
  buildZones,
  rankZones,
  scoreAllProfiles,
  terrainPoints,
  withReports,
  withSlope,
  type AmpData,
  type AmpIndex,
  type EconomicData,
  type EconomicIndex,
  type NoiseIndex,
  type RankedZone,
  type Report,
  type ReportKind,
  type Dimension,
  type Zone,
  type ZoneScore,
  type LngLat,
} from "../../domain/zone/index.js";
import { fetchDataManifest, versionedUrl } from "../dataManifest.js";
import { loadPreset } from "../overpass/client.js";
import { mergeTiles } from "../overpass/mergeTiles.js";
import { fetchSnapshotManifest, type SnapshotManifest } from "../overpass/snapshot.js";
import { OSM_TILES, SOCIAL_TILES } from "../overpass/zonePreset.js";
import { useAppStore, type LoadState } from "../state.js";
import { getAltitudes } from "./elevationClient.js";
import { readOwnReports, writeOwnReports, zoneContaining, type OwnReport } from "./ownReports.js";
import { locate } from "./locate.js";

const NOISE_MAP_URL = `${import.meta.env.BASE_URL}data/noise_lden_all.geojson`;
const REPORTS_URL = `${import.meta.env.BASE_URL}data/reports.json`;
const AMP_BASE = `${import.meta.env.BASE_URL}data/amp/`;
const RENT_URL = `${AMP_BASE}rent.json`;
const INCOME_URL = `${AMP_BASE}income_2021.json`;
const PUBLIC_SPACE_URL = `${AMP_BASE}public_space.json`;

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
  /** A background reload of the deployed snapshots; the map stays usable. */
  refreshing: boolean;
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

  load: (options?: { reloadSnapshots?: boolean }) => Promise<void>;
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

/** Manifest version of the snapshots currently loaded in `inputs.osm`. */
let osmManifestVersion: string | null = null;
/** Global data manifest version of the files currently loaded into `inputs`. */
let dataManifestVersion: string | null = null;

interface CityData {
  /** Null when a reload found the deployed manifest unchanged. */
  geojson: FeatureCollection | null;
  fromCache: boolean;
  failed: number;
  unchanged: boolean;
}

/**
 * Loads the city's OpenStreetMap data. It fetches the local/cached snapshots concurrently
 * using a worker pool for fast loading (< 700ms). Any tile not available locally falls back
 * to the polite sequential Overpass query with pauses to prevent 429/504 errors.
 *
 * `reloadSnapshots` revalidates the deployed files with the server and skips the whole read
 * when the manifest version has not changed. It never sends the 60 tile queries to Overpass:
 * that path is reserved for `forceRefresh` on the small overlay presets.
 */
export async function loadCity(
  reloadSnapshots: boolean,
  onProgress: (done: number, total: number) => void,
  dataVersion?: string,
): Promise<CityData> {
  // Only trust the manifest after a reload: the initial load may have come from an
  // older HTTP cache, so comparing its version to a fresh manifest could make a later
  // reload skip files that were never actually revalidated.
  let manifest: SnapshotManifest | null = null;
  if (reloadSnapshots) {
    manifest = await fetchSnapshotManifest(fetch, { forceReload: true });
    if (manifest && osmManifestVersion === manifest.version) {
      onProgress(OSM_TILES.length, OSM_TILES.length);
      return { geojson: null, fromCache: true, failed: 0, unchanged: true };
    }
  }

  // Keep responses in reference order while requests still run concurrently.
  // Retries replace the same slot; optional social tiles have lower priority.
  const tiles: (FeatureCollection | undefined)[] = new Array(OSM_TILES.length + SOCIAL_TILES.length);
  let fromCache = true;
  let lastError: unknown = null;

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
        const result = await loadPreset(OSM_TILES[i]!, { reloadSnapshot: reloadSnapshots, dataVersion });
        if (!result.fromCache) fromCache = false;
        tiles[i] = result.geojson;
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
        const result = await loadPreset(OSM_TILES[i]!, { reloadSnapshot: reloadSnapshots, dataVersion });
        if (!result.fromCache) {
          fromCache = false;
          await new Promise((r) => setTimeout(r, 1500));
        }
        tiles[i] = result.geojson;
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
    SOCIAL_TILES.map(async (tile, i) => {
      try {
        tiles[OSM_TILES.length + i] = (await loadPreset(tile, { reloadSnapshot: reloadSnapshots, dataVersion })).geojson;
      } catch {
        /* the indicators built on these stay "no data" */
      }
    }),
  );

  if (failed === OSM_TILES.length) throw lastError;
  onProgress(OSM_TILES.length, OSM_TILES.length);
  // An incomplete in-memory city must not be marked as this manifest version: the
  // next reload has to try the missing tiles again. The initial load leaves the
  // version null, so the first reload always verifies the files once.
  osmManifestVersion = reloadSnapshots && failed === 0 ? manifest?.version ?? null : null;
  return { geojson: mergeTiles(tiles), fromCache, failed, unchanged: false };
}

async function getJson<T>(url: string, options: { noCache?: boolean; version?: string } = {}): Promise<T | undefined> {
  try {
    const response = await fetch(versionedUrl(url, options.version), options.noCache ? { cache: "no-cache" } : undefined);
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The official noise map, trimmed to the study area (npm run data:noise). */
async function loadNoiseIndex(dataVersion?: string): Promise<NoiseIndex | undefined> {
  const data = await getJson<FeatureCollection>(NOISE_MAP_URL, { version: dataVersion });
  if (!data) return undefined;
  const index = buildNoiseIndex(data);
  return index.size > 0 ? index : undefined;
}

/**
 * Open data of the Metropole portal (npm run data:zones): the zones themselves, public
 * transport, tourist offices, priority neighbourhoods and project perimeters. Only the
 * zones are required; each other file is optional and leaves its indicators at "no data".
 */
async function loadAmp(dataVersion?: string): Promise<{ zones?: FeatureCollection; amp?: AmpIndex }> {
  const options = { version: dataVersion };
  const [zones, transit, tourism, qpv, projects] = await Promise.all([
    getJson<FeatureCollection>(AMP_BASE + "zones.geojson", options),
    getJson<AmpData["transit"]>(AMP_BASE + "transit.json", options),
    getJson<AmpData["tourism"]>(AMP_BASE + "tourism.json", options),
    getJson<AmpData["qpv"]>(AMP_BASE + "qpv.geojson", options),
    getJson<AmpData["projects"]>(AMP_BASE + "projects.geojson", options),
  ]);
  const any = transit || tourism || qpv || projects;
  return { zones, amp: any ? buildAmpIndex({ transit, tourism, qpv, projects }) : undefined };
}

/** Rents, income and public-space shares, all optional. Missing files leave their indicators "no data". */
async function loadEconomic(reload: boolean, dataVersion?: string): Promise<EconomicIndex | undefined> {
  const options = { noCache: reload, version: dataVersion };
  const [rent, income, publicSpace] = await Promise.all([
    getJson<EconomicData["rent"]>(RENT_URL, options),
    getJson<EconomicData["income"]>(INCOME_URL, options),
    getJson<EconomicData["publicSpace"]>(PUBLIC_SPACE_URL, options),
  ]);
  return buildEconomicIndex({ rent, income, publicSpace });
}

/** What the zones are built from. Kept outside the store so a new report re-scores without downloading again. */
let inputs: {
  collection: FeatureCollection;
  osm: FeatureCollection;
  base: Report[] | undefined;
  amp?: AmpIndex;
  noiseIndex?: NoiseIndex;
  economic?: EconomicIndex;
} | null = null;
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
        ...(inputs.economic ? { economic: inputs.economic } : {}),
        territory: MARSEILLE_TERRITORY,
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
  refreshing: false,
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

  load: async ({ reloadSnapshots = false } = {}) => {
    if (get().loadState === "loading" || get().refreshing) return;
    // Once the map is ready, "Recharger les donnees" compares the global data manifest
    // first: if no runtime file changed, nothing is downloaded or rebuilt.
    const background = reloadSnapshots && get().loadState === "ready";
    const manifest = await fetchDataManifest();
    const dataVersion = manifest?.version;
    if (background && dataManifestVersion && dataVersion === dataManifestVersion) {
      say("Donnees deja a jour : aucun fichier n'a change.");
      return;
    }
    if (background) {
      set({ refreshing: true, error: null });
      say("Rechargement des donnees publiees...");
    } else {
      set({
        loadState: "loading",
        loadProgress: { done: 0, total: OSM_TILES.length },
        error: null,
        auto: IDLE_AUTO,
      });
      say("Chargement des zones, des donnees OpenStreetMap, des signalements, des loyers, des revenus et de la carte de bruit...");
    }
    try {
      const [osm, { zones: collection, amp }, reports, noiseIndex, economic] = await Promise.all([
        loadCity(reloadSnapshots, (done, total) => {
          set({ loadProgress: { done, total } });
          say(`${background ? "Rechargement" : "Chargement"} de la ville : zone ${Math.min(done + 1, total)} sur ${total}...`);
        }, dataVersion),
        loadAmp(dataVersion),
        getJson<Report[]>(REPORTS_URL, { noCache: reloadSnapshots, version: dataVersion }),
        loadNoiseIndex(dataVersion),
        loadEconomic(reloadSnapshots, dataVersion),
      ]);
      if (!collection) throw new Error("Les zones (data/amp/zones.geojson) sont introuvables : lance « npm run data:zones ».");
      const osmCollection = osm.unchanged ? inputs?.osm : osm.geojson;
      if (!osmCollection) throw new Error("Les donnees OpenStreetMap sont introuvables : lance « npm run data:osm ».");
      inputs = { collection, osm: osmCollection, base: reports, amp, noiseIndex, economic };
      cachedZoneIndex = null;
      cachedBuiltZones = null;
      cachedSlopedZones = null;
      cachedTerrainPoints = null;
      const ownReports = await readOwnReports();
      set({
        ownReports,
        loadProgress: { done: OSM_TILES.length, total: OSM_TILES.length },
      });
      say(`${background ? "Recalcul" : "Calcul"} des indicateurs d'accessibilite et notation des zones...`);
      // Microtask yield: allows the browser to paint progress updates and smooth animations before CPU computation
      await new Promise((resolve) => setTimeout(resolve, 30));
      recompute({ rebuild: true, extraState: { loadState: "ready", loadProgress: null, refreshing: false } });
      // Baseline only after a complete city load; a partial OSM load must retry next time.
      dataManifestVersion = osm.failed === 0 ? dataVersion ?? null : null;
      say(
        `${useZoneStore.getState().zones.length} zones notees` +
          (osm.unchanged ? " ; donnees OSM deja a jour." : osm.fromCache ? " (snapshots locaux)." : " (Overpass).") +
          (osm.failed ? ` ${osm.failed} partie(s) de la ville n'ont pas pu etre chargees : recharge la page.` : ""),
      );
      await loadSlope();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (background) {
        set({ refreshing: false, loadProgress: null, error: message });
        say("Echec du rechargement. Les donnees actuelles sont conservees.");
      } else {
        set({ loadState: "error", loadProgress: null, refreshing: false, error: message });
        say("Echec du chargement des zones. Verifie la connexion.");
      }
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
