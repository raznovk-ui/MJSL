import { useId, useState } from "react";
import { REPORT_TYPE_OPTIONS } from "./reportStyle.js";
import { useZoneStore } from "./zoneStore.js";

/**
 * Lets a person add a citizen report from the map: switch the mode on, click the map, choose
 * the type, save. The report is counted in the zone it falls in, like the existing ones, and
 * the scores update. Reports are kept on this device only, and can be removed here.
 */
export function ReportForm() {
  const ids = useId();
  const loadState = useZoneStore((s) => s.loadState);
  const addMode = useZoneStore((s) => s.addMode);
  const pending = useZoneStore((s) => s.pending);
  const own = useZoneStore((s) => s.ownReports);
  const toggleAddMode = useZoneStore((s) => s.toggleAddMode);
  const cancelPending = useZoneStore((s) => s.cancelPending);
  const saveOwnReport = useZoneStore((s) => s.saveOwnReport);
  const removeOwnReport = useZoneStore((s) => s.removeOwnReport);
  const [type, setType] = useState(REPORT_TYPE_OPTIONS[0]!);
  const ready = loadState === "ready";

  return (
    <section aria-labelledby={`${ids}-h`} className="card">
      <h2 id={`${ids}-h`} className="card-title">Ajouter un signalement</h2>
      <p className="mb-2 text-xs text-slate-600">
        Clique la carte, choisis le type : le point compte dans la zone ou il tombe, comme les autres signalements. Il reste sur
        cet appareil seulement.
      </p>

      <button
        type="button"
        aria-pressed={addMode}
        disabled={!ready}
        onClick={toggleAddMode}
        className="btn btn-toggle btn-block"
      >
        {addMode ? "Clique sur la carte…" : "Placer un signalement sur la carte"}
      </button>

      {pending && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-700">Point place sur la carte.</p>
          <label htmlFor={`${ids}-type`} className="block text-xs font-medium text-slate-700">Type de signalement</label>
          <select
            id={`${ids}-type`}
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border p-1.5 text-sm"
            style={{ borderColor: "var(--line-strong)" }}
          >
            {REPORT_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saveOwnReport(type)} className="btn btn-primary">
              Enregistrer le signalement
            </button>
            <button type="button" onClick={cancelPending} className="btn btn-secondary">Annuler</button>
          </div>
        </div>
      )}

      {own.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-slate-700">Vos signalements sur cet appareil ({own.length})</p>
          <ul className="space-y-1 text-xs text-slate-700">
            {own.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {r.type} · {new Date(r.addedAt).toLocaleDateString("fr-FR")}
                </span>
                <button
                  type="button"
                  onClick={() => void removeOwnReport(r.id)}
                  aria-label={`Supprimer le signalement « ${r.type} » du ${new Date(r.addedAt).toLocaleDateString("fr-FR")}`}
                  className="btn btn-secondary btn-sm"
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
