import { ZONE_CONFIG, dimensionScores } from "../../domain/zone/index.js";
import { DimensionBars } from "./DimensionBars.js";
import { shortArrondissement } from "./labels.js";
import { useZoneStore } from "./zoneStore.js";

/** The zones with the lowest score for the chosen profile, worst first. */
export function ZoneRanking() {
  const ranking = useZoneStore((s) => s.ranking);
  const loadState = useZoneStore((s) => s.loadState);
  const profileId = useZoneStore((s) => s.profileId);
  const scores = useZoneStore((s) => s.scores);
  const selected = useZoneStore((s) => s.selectedZoneId);
  const select = useZoneStore((s) => s.selectZone);
  const profile = ZONE_CONFIG.profiles[profileId];
  const top = ranking.slice(0, ZONE_CONFIG.ranking.topN);

  return (
    <section aria-labelledby="zones-title" className="card">
      <h2 id="zones-title" className="card-title">Zones prioritaires</h2>
      <p className="mb-2 text-xs text-slate-600">
        Les zones au score le plus bas pour le profil « {profile?.label ?? profileId} », classees automatiquement : aucun releve n&apos;est saisi.
      </p>
      {loadState !== "ready" ? (
        <p className="text-sm text-slate-500">{loadState === "error" ? "Calcul impossible." : "Calcul en cours..."}</p>
      ) : top.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune zone notee.</p>
      ) : (
        <>
          <ol className="space-y-2">
            {top.map((r) => (
              <li key={r.zone.id}>
                <button
                  type="button"
                  onClick={() => select(selected === r.zone.id ? null : r.zone.id)}
                  aria-pressed={selected === r.zone.id}
                  className="btn btn-toggle btn-block !items-start !text-left"
                >
                  <span className="font-bold">
                    #{r.rank} · {r.zone.name} <span className="font-normal text-slate-600">({shortArrondissement(r.zone)})</span>
                  </span>
                  <span className="block text-xs font-normal">{r.summary}</span>
                  {selected === r.zone.id && (
                    <span className="mt-2 block w-full font-normal">
                      <span className="mb-1 block text-xs font-semibold">Score par dimension (0 = obstacle total, 1 = aucun)</span>
                      <DimensionBars scores={dimensionScores([r.zone], scores[profileId] ?? {})} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {ranking.length > top.length && (
            <p className="mt-2 text-xs text-slate-500">Les {top.length} premieres sur {ranking.length}. Liste complete dans l&apos;onglet Tableau.</p>
          )}
        </>
      )}
    </section>
  );
}
