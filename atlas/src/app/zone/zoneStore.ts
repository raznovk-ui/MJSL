import type { FeatureCollection } from "geojson";
import { create } from "zustand";
import {
  ZONE_CONFIG,
  buildAmpIndex,
  buildNoiseIndex,
  buildZones,
  rankZones,
  scoreAllProfiles,
  terrainPoints,
  withSlope,
  type AmpData,
  type AmpIndex,
  type NoiseIndex,
  type RankedZone,
  type Report,
  type ReportKind,
  type ScoredDimension,
  type Zone,
  type ZoneScore,
} from "../../domain/zone/index.js";
import { loadPreset } from "../overpass/client.js";
import { OSM_TILES, SOCIAL_TILES } from "../overpass/zonePreset.js";
import { useAppStore } from "../state.js";
import { getAltitudes } from "./elevationClient.js";

const NOISE_MAP_URL = `${import.meta.env.BASE_URL}data/noise_lden_all.geojson`;
const REPORTS_URL = `${import.meta.env.BASE_URL}data/reports.json`;
const AMP_BASE = `${import.meta.env.BASE_URL}data/amp/`;

type LoadState = "idle" | "loading" | "ready" | "error";

/** What the map shows for each zone: the profile's combined score, or one dimension. */
export type MapLayer = "combined" | ScoredDimension;

/** What the program filled in by itself, and how far it got. */
export interface AutoDataStatus {
  slope: "idle" | "running" | "done" | "partial" | "error";
  slopeProgress: { done: number; total: number } | null;
  slopeError: string | null;
}

interface ZoneState {
  loadState: LoadState;
  error: string | null;
  zones: Zone[];
  /** The zone polygons as loaded, for the altitude grid. */
  collection: FeatureCollection | null;
  /** profile id -> zone id -> score */
  scores: Record<string, Record<string, ZoneScore>>;
  /** Priority zones for the selected profile, worst first. */
  ranking: RankedZone[];
  reports: Report[];
  profileId: string;
  layer: MapLayer;
  visible: boolean;
  reportsVisible: boolean;
  /** Which kinds of report are drawn (the legend doubles as the filter). */
  reportKinds: Record<ReportKind, boolean>;
  selectedZoneId: string | null;
  auto: AutoDataStatus;

  load: (options?: { forceRefresh?: boolean }) => Promise<void>;
  setProfile: (id: string) => void;
  setLayer: (layer: MapLayer) => void;
  toggleVisible: () => void;
  toggleReports: () => void;
  toggleReportKind: (kind: ReportKind) => void;
  selectZone: (id: string | null) => void;
}

const say = (message: string) => useAppStore.getState().setStatus(message);

function scoreEverything(zones: Zone[]): ZoneState["scores"] {
  const scores: ZoneState["scores"] = Object.fromEntries(Object.keys(ZONE_CONFIG.profiles).map((id) => [id, {}]));
  for (const zone of zones) {
    for (const [profileId, score] of Object.entries(scoreAllProfiles(zone, ZONE_CONFIG))) scores[profileId]![zone.id] = score;
  }
  return scores;
}

const rankingOf = (zones: Zone[], scores: ZoneState["scores"], profileId: string) => rankZones(zones, scores[profileId] ?? {}, ZONE_CONFIG);

/** Loads the city's OpenStreetMap data tile by tile (one at a time, to go easy on Overpass) and merges it. */
async function loadCity(
  forceRefresh: boolean,
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
  // Overpass sometimes answers 429/504 under load. Tiles that fail are retried after a
  // pause (the ones that worked are cached, so a retry only repeats the failures).
  let pending = OSM_TILES.map((_, i) => i);
  for (let pass = 0; pass < 3 && pending.length > 0; pass += 1) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 8000 * pass));
    const next: number[] = [];
    for (const [n, i] of pending.entries()) {
      onProgress(OSM_TILES.length - pending.length + n, OSM_TILES.length);
      try {
        const result = await loadPreset(OSM_TILES[i]!, { forceRefresh });
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
  const failed = pending.length;

  // Optional extras (cameras, crossings, shelters...): one try each, never worth failing the load.
  for (const tile of SOCIAL_TILES) {
    try {
      take((await loadPreset(tile, { forceRefresh })).geojson);
    } catch {
      /* the indicators built on these stay "no data" */
    }
  }
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
  return index.polygons.length > 0 ? index : undefined;
}

/**
 * Open data of the Metropole portal (npm run data:amp): the zones themselves, public
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

const IDLE_AUTO: AutoDataStatus = { slope: "idle", slopeProgress: null, slopeError: null };

export const useZoneStore = create<ZoneState>((set, get) => ({
  loadState: "idle",
  error: null,
  zones: [],
  collection: null,
  scores: {},
  ranking: [],
  reports: [],
  profileId: Object.keys(ZONE_CONFIG.profiles)[0]!,
  layer: "combined",
  visible: true,
  reportsVisible: false,
  reportKinds: { parking: true, narrow: true, works: true, furniture: true, other: true },
  selectedZoneId: null,
  auto: IDLE_AUTO,

  load: async ({ forceRefresh = false } = {}) => {
    if (get().loadState === "loading") return;
    set({ loadState: "loading", error: null, auto: IDLE_AUTO, ranking: [], selectedZoneId: null });
    say("Chargement des zones, des donnees OpenStreetMap, des signalements et de la carte de bruit...");
    try {
      const [osm, { zones: collection, amp }, reports, noiseIndex] = await Promise.all([
        loadCity(forceRefresh, (done, total) => say(`Chargement de la ville : zone ${Math.min(done + 1, total)} sur ${total}...`)),
        loadAmp(),
        getJson<Report[]>(REPORTS_URL),
        loadNoiseIndex(),
      ]);
      if (!collection) throw new Error("Les zones (data/amp/zones.geojson) sont introuvables : lance « npm run data:amp ».");
      const zones = buildZones(
        { zones: collection, osm: osm.geojson, ...(reports ? { reports } : {}), ...(amp ? { amp } : {}), ...(noiseIndex ? { noiseIndex } : {}) },
        ZONE_CONFIG,
      );
      const scores = scoreEverything(zones);
      set({ loadState: "ready", zones, collection, scores, reports: reports ?? [], ranking: rankingOf(zones, scores, get().profileId) });
      say(
        `${zones.length} zones notees` +
          (osm.fromCache ? " (cache local)." : " (Overpass).") +
          (osm.failed ? ` ${osm.failed} partie(s) de la ville n'ont pas pu etre chargees : recharge la page.` : ""),
      );
      await loadSlope();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loadState: "error", error: message });
      say("Echec du chargement des zones. Verifie la connexion.");
    }
  },

  setProfile: (profileId) => set((s) => ({ profileId, ranking: rankingOf(s.zones, s.scores, profileId) })),
  setLayer: (layer) => set({ layer }),
  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  toggleReports: () => set((s) => ({ reportsVisible: !s.reportsVisible })),
  toggleReportKind: (kind) => set((s) => ({ reportKinds: { ...s.reportKinds, [kind]: !s.reportKinds[kind] } })),
  selectZone: (selectedZoneId) => set({ selectedZoneId }),
}));

/** Slopes come from altitude data and take a moment: the zones are usable meanwhile, and re-scored once the altitudes arrive. */
async function loadSlope() {
  const { collection, zones } = useZoneStore.getState();
  if (!collection) return;
  useZoneStore.setState((s) => ({ auto: { ...s.auto, slope: "running", slopeProgress: { done: 0, total: 0 }, slopeError: null } }));
  const { altitudes, complete, error } = await getAltitudes(terrainPoints(collection, ZONE_CONFIG), {
    onProgress: (done, total) => useZoneStore.setState((s) => ({ auto: { ...s.auto, slopeProgress: { done, total } } })),
  });
  const withSlopes = withSlope(zones, collection, altitudes, ZONE_CONFIG);
  const scores = scoreEverything(withSlopes);
  useZoneStore.setState((s) => ({
    zones: withSlopes,
    scores,
    ranking: rankingOf(withSlopes, scores, s.profileId),
    auto: { ...s.auto, slope: complete ? "done" : Object.keys(altitudes).length > 0 ? "partial" : "error", slopeError: error ?? null },
  }));
  const gained = withSlopes.filter((z) => z.sources.slope === "official").length;
  say(complete ? `Pentes calculees pour ${gained} zones (altitudes IGN).` : `Pentes partielles (${gained} zones) : ${error ?? "erreur"}.`);
}

// Dev-only handle, so state can be inspected from the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__zones = useZoneStore;
}
