import { OVERPASS_PRESETS } from "../overpass/presets.js";
import { ageLabel } from "../overpass/cache.js";
import { useAppStore } from "../state.js";

export function LayerPanel() {
  const presets = useAppStore((s) => s.presets);
  const togglePreset = useAppStore((s) => s.togglePreset);
  const fetchPreset = useAppStore((s) => s.fetchPreset);

  return (
    <fieldset className="card border-0">
      <legend className="card-title">Couches OpenStreetMap</legend>

      {OVERPASS_PRESETS.map((preset) => {
        const layer = presets[preset.id]!;
        return (
          <div key={preset.id} className="mb-3 rounded border border-slate-200 p-3">
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => togglePreset(preset.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium text-slate-900">{preset.label}</span>
                <span className="block text-xs text-slate-600">{preset.description}</span>
              </span>
            </label>

            <p className="mt-2 text-xs text-slate-600">
              {layer.state === "loading" && "Chargement..."}
              {layer.state === "ready" &&
                `${layer.geojson?.features.length ?? 0} objets` +
                  (layer.timestamp ? ` · ${layer.fromCache ? `cache du ${ageLabel(layer.timestamp)}` : "Overpass"}` : "")}
              {layer.state === "error" && `Erreur : ${layer.error}`}
              {layer.state === "idle" && "Non charge."}
            </p>

            <button
              type="button"
              onClick={() => fetchPreset(preset.id, { forceRefresh: true })}
              disabled={layer.state === "loading"}
              className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              Rafraichir depuis Overpass
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}
