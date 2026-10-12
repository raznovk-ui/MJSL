import { BASEMAPS } from "../map/basemaps.js";
import { useAppStore } from "../state.js";

export function BasemapPicker() {
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);

  return (
    <fieldset className="card border-0">
      <legend className="card-title">Fond de carte</legend>
      <div className="space-y-2">
        {BASEMAPS.map((option) => (
          <label key={option.id} className="flex gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="basemap"
              value={option.id}
              checked={basemap === option.id}
              onChange={() => setBasemap(option.id)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-slate-900">{option.label}</span>
              <span className="block text-xs text-slate-600">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
