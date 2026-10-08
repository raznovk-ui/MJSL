import { useId, useMemo } from "react";
import { ZONE_CONFIG, type ValueSource } from "../../domain/zone/index.js";
import { useZoneStore } from "./zoneStore.js";

const SOURCE_LABEL: Record<ValueSource, string> = { osm: "OSM", official: "officiel", reported: "signalements" };

const { redBelow, orangeBelow, colours } = ZONE_CONFIG.classes;

/** The profile, the legend with the number of zones per class, and how much data each indicator has. */
export function ZonePanel() {
  const ids = useId();
  const loadState = useZoneStore((s) => s.loadState);
  const error = useZoneStore((s) => s.error);
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const reports = useZoneStore((s) => s.reports);
  const profileId = useZoneStore((s) => s.profileId);
  const visible = useZoneStore((s) => s.visible);
  const auto = useZoneStore((s) => s.auto);
  const load = useZoneStore((s) => s.load);
  const setProfile = useZoneStore((s) => s.setProfile);
  const toggleVisible = useZoneStore((s) => s.toggleVisible);

  const counts = useMemo(() => {
    const out = { red: 0, orange: 0, green: 0, none: 0 };
    for (const score of Object.values(scores[profileId] ?? {})) out[score.cls] += 1;
    return out;
  }, [scores, profileId]);

  // How many zones have each indicator, and from which source. The colours are only as
  // good as this: an indicator with no basis in the data is left out, never counted as 0.
  const coverage = useMemo(
    () =>
      Object.entries(ZONE_CONFIG.indicators).map(([key, c]) => {
        const bySource: Record<string, number> = {};
        let known = 0;
        for (const z of zones) {
          if (z.values[key] === undefined) continue;
          known += 1;
          const source = z.sources[key] ?? "osm";
          bySource[source] = (bySource[source] ?? 0) + 1;
        }
        const detail = (Object.keys(SOURCE_LABEL) as ValueSource[]).filter((s) => bySource[s]).map((s) => `${SOURCE_LABEL[s]} ${bySource[s]}`).join(", ");
        return { key, label: c.label, known, detail };
      }),
    [zones],
  );
  const loading = loadState === "loading";

  return (
    <section aria-labelledby={`${ids}-h`} className="card">
      <h2 id={`${ids}-h`} className="card-title">Zones de Marseille ({zones.length})</h2>

      <button type="button" onClick={() => void load({ forceRefresh: loadState === "ready" })} disabled={loading} className="btn btn-secondary btn-block">
        {loading ? "Chargement..." : loadState === "ready" ? "Rafraichir depuis Overpass" : "Charger les zones"}
      </button>
      {error && <p className="callout-warning mt-2">{error}</p>}

      {loadState === "ready" && (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={`${ids}-profile`} className="block text-xs font-medium text-slate-700">Profil</label>
            <select
              id={`${ids}-profile`}
              value={profileId}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full rounded-md border p-1.5 text-sm"
              style={{ borderColor: "var(--line-strong)" }}
            >
              {Object.entries(ZONE_CONFIG.profiles).map(([id, p]) => (
                <option key={id} value={id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="callout-info">
            <p className="font-semibold">Remplissage automatique</p>
            <ul className="mt-0.5 list-disc pl-4">
              <li>Zones : IRIS de Marseille (donnees ouvertes de la Metropole).</li>
              <li>Signalements des habitants : {reports.length} (« Galere pietons »).</li>
              <li>Bruit : carte officielle (Lden 24 h, Metropole AMP).</li>
              <li>
                Pente :{" "}
                {auto.slope === "running"
                  ? `altitudes IGN en cours${auto.slopeProgress && auto.slopeProgress.total ? ` (${auto.slopeProgress.done} / ${auto.slopeProgress.total} points)` : "..."}`
                  : auto.slope === "done" ? "calculee a partir des altitudes IGN (grille de 200 m)"
                  : auto.slope === "partial" ? "partielle (altitudes IGN incompletes)"
                  : auto.slope === "error" ? `indisponible (${auto.slopeError ?? "erreur"})` : "en attente"}
              </li>
            </ul>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={visible} onChange={toggleVisible} />
            Afficher les zones sur la carte
          </label>

          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Legende et nombre de zones</p>
            <ul className="space-y-1 text-xs text-slate-700">
              <li className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-6 rounded-sm" style={{ background: colours.red, outline: "2px dashed #7f1d1d", outlineOffset: -2 }} />Rouge (&lt; {redBelow}) — contour pointille : {counts.red}</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-6 rounded-sm" style={{ background: colours.orange }} />Orange (&lt; {orangeBelow}) : {counts.orange}</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-6 rounded-sm" style={{ background: colours.green }} />Vert ({orangeBelow} et plus) : {counts.green}</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-6 rounded-sm" style={{ background: colours.none }} />Pas assez de donnees : {counts.none}</li>
            </ul>
            <p className="mt-1 text-xs text-slate-600">
              Chaque score est un produit : une dimension tres mauvaise tire le score vers le bas. Une valeur manquante est
              ignoree, jamais comptee comme 0. Les couleurs disent « pire que la plupart de la ville », pas « inutilisable ».
            </p>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-slate-700">Donnees disponibles par indicateur</summary>
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {coverage.map((c) => (
                <li key={c.key}>{c.label} : {c.known} / {zones.length}{c.detail ? ` (${c.detail})` : ""}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
