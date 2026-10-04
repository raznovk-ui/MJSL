import { create } from "zustand";
import type { FeatureCollection } from "geojson";
import { DEFAULT_BASEMAP } from "./map/basemaps.js";
import { OVERPASS_PRESETS } from "./overpass/presets.js";
import { loadPreset } from "./overpass/client.js";

export type LoadState = "idle" | "loading" | "ready" | "error";

interface PresetLayer {
  visible: boolean;
  state: LoadState;
  geojson: FeatureCollection | null;
  fromCache: boolean;
  timestamp: number | null;
  error: string | null;
}

/**
 * App-wide state: the basemap, the OSM overlay and the status line. There is no
 * user-entered data in the app: everything on the map is derived automatically
 * from open data (see walkway/walkwayStore.ts for the walkway scores and zones).
 */
interface AppState {
  basemap: string;
  setBasemap: (id: string) => void;

  presets: Record<string, PresetLayer>;
  togglePreset: (id: string) => void;
  fetchPreset: (id: string, options?: { forceRefresh?: boolean }) => Promise<void>;

  /** Announced through an aria-live region, so progress is not colour-only. */
  status: string;
  setStatus: (message: string) => void;
}

const initialPresets = Object.fromEntries(
  OVERPASS_PRESETS.map((preset) => [
    preset.id,
    { visible: true, state: "idle" as LoadState, geojson: null, fromCache: false, timestamp: null, error: null },
  ]),
);

export const useAppStore = create<AppState>((set, get) => ({
  basemap: DEFAULT_BASEMAP,
  setBasemap: (id) => set({ basemap: id }),

  presets: initialPresets,
  togglePreset: (id) =>
    set((s) => ({ presets: { ...s.presets, [id]: { ...s.presets[id]!, visible: !s.presets[id]!.visible } } })),

  status: "Pret.",
  setStatus: (message) => set({ status: message }),

  fetchPreset: async (id, options = {}) => {
    const preset = OVERPASS_PRESETS.find((p) => p.id === id);
    if (!preset) return;

    const patch = (partial: Partial<PresetLayer>) =>
      set((s) => ({ presets: { ...s.presets, [id]: { ...s.presets[id]!, ...partial } } }));

    patch({ state: "loading", error: null });
    get().setStatus(`Chargement de « ${preset.label} »...`);

    try {
      const result = await loadPreset(preset, options);
      patch({
        state: "ready",
        geojson: result.geojson,
        fromCache: result.fromCache,
        timestamp: result.timestamp,
      });
      get().setStatus(
        `${result.geojson.features.length} objets charges pour « ${preset.label} »` +
          (result.fromCache ? " (cache local)." : " (Overpass)."),
      );
    } catch (error) {
      patch({ state: "error", error: error instanceof Error ? error.message : String(error) });
      get().setStatus(`Echec du chargement de « ${preset.label} ». Verifie la connexion.`);
    }
  },
}));

// Dev-only handle, so state can be inspected from the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useAppStore;
}
