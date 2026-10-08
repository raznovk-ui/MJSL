import { useMemo, useState } from "react";
import { ZONE_CONFIG, SCORED_DIMENSIONS, dimensionScoreOf } from "../../domain/zone/index.js";
import { dimension as meta } from "../../domain/dimensions.js";
import { useZoneStore } from "../zone/zoneStore.js";

const PAGE = 50;

/**
 * The non-map view the accessibility requirement calls for: every zone, its score and
 * its six dimension scores, reachable without a pointer or a visual channel.
 */
export function DataTable() {
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const select = useZoneStore((s) => s.selectZone);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(
    () =>
      zones
        .map((zone) => ({ zone, score: scores[profileId]?.[zone.id] }))
        .sort((a, b) => (a.score?.score ?? 2) - (b.score?.score ?? 2)),
    [zones, scores, profileId],
  );

  if (rows.length === 0) {
    return (
      <p className="m-4 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Aucune zone chargee pour l&apos;instant.
      </p>
    );
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

  return (
    <div className="p-4">
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <caption className="p-3 text-left text-xs text-slate-500">
            {rows.length} zones, de la plus basse a la plus haute pour le profil « {ZONE_CONFIG.profiles[profileId]?.label ?? profileId} ». Memes donnees que la carte.
          </caption>
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--line)", background: "var(--surface-alt)" }}>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Zone</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Arrondissement</th>
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Score</th>
              {SCORED_DIMENSIONS.map((d) => (
                <th key={d} scope="col" className="px-3 py-2 font-semibold text-slate-700">{meta(d).mjslCode}</th>
              ))}
              <th scope="col" className="px-3 py-2 font-semibold text-slate-700">Voir</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(({ zone, score }, index) => (
              <tr key={zone.id} className="border-b" style={{ borderColor: "var(--line)", background: index % 2 ? "var(--surface-alt)" : "var(--surface)" }}>
                <th scope="row" className="px-3 py-1.5 font-medium text-slate-900">{zone.name}</th>
                <td className="px-3 py-1.5 text-slate-600">{zone.arrondissement.replace("Marseille ", "")}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-900">{fmt(score?.score)}</td>
                {SCORED_DIMENSIONS.map((d) => (
                  <td key={d} className="px-3 py-1.5 tabular-nums text-slate-600">{fmt(dimensionScoreOf(score, d))}</td>
                ))}
                <td className="px-3 py-1.5">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => select(zone.id)}>Fiche</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limit < rows.length && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="btn btn-secondary mt-3">
          Afficher {Math.min(PAGE, rows.length - limit)} zones de plus
        </button>
      )}
    </div>
  );
}
