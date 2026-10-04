import { useAppStore } from "../state.js";
import { useWalkwayStore } from "../walkway/walkwayStore.js";
import { IconLayers } from "./icons.js";

/**
 * On/off switches for every overlay, on the map itself, so any layer can be hidden
 * to compare against the bare basemap. "Carte seule" hides them all at once.
 */
export function MapOverlayToggles() {
  const presets = useAppStore((s) => s.presets);
  const walkVisible = useWalkwayStore((s) => s.visible);
  const zonesVisible = useWalkwayStore((s) => s.zonesVisible);
  const walkSegments = useWalkwayStore((s) => s.segments.length);

  const osmVisible = Object.values(presets).some((p) => p.visible);
  const allHidden = !zonesVisible && !osmVisible && !(walkVisible && walkSegments > 0);

  const setOsm = (visible: boolean) =>
    useAppStore.setState((s) => ({
      presets: Object.fromEntries(Object.entries(s.presets).map(([id, p]) => [id, { ...p, visible }])),
    }));

  const setAll = (visible: boolean) => {
    setOsm(visible);
    useWalkwayStore.setState({ visible, zonesVisible: visible });
  };

  const row = "flex items-start gap-2 text-xs";

  return (
    <fieldset
      className="absolute left-2 top-2 z-10 w-56 rounded-md border bg-white p-2 shadow-md"
      style={{ borderColor: "var(--line)" }}
    >
      <legend className="sr-only">Calques de la carte</legend>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-900">
        <IconLayers className="h-4 w-4" />
        Calques
      </p>
      <div className="space-y-1.5">
        <label className={row}>
          <input type="checkbox" checked={zonesVisible} onChange={() => useWalkwayStore.getState().toggleZones()} className="mt-0.5" />
          <span>Zones prioritaires</span>
        </label>
        <label className={row}>
          <input
            type="checkbox"
            checked={walkVisible && walkSegments > 0}
            disabled={walkSegments === 0}
            onChange={() => useWalkwayStore.getState().toggleVisible()}
            className="mt-0.5"
          />
          <span>
            Troncons pietons
            {walkSegments === 0 && <span className="block text-slate-500">calcul en cours</span>}
          </span>
        </label>
        <label className={row}>
          <input type="checkbox" checked={osmVisible} onChange={(e) => setOsm(e.target.checked)} className="mt-0.5" />
          <span>Indices OSM</span>
        </label>
      </div>
      <button type="button" onClick={() => setAll(allHidden)} className="btn btn-secondary btn-sm btn-block mt-2">
        {allHidden ? "Tout afficher" : "Carte seule"}
      </button>
    </fieldset>
  );
}
