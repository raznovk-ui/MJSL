import { WALKWAY_CONFIG } from "../../domain/walkway/index.js";
import { DimensionBars } from "./DimensionBars.js";
import { useWalkwayStore } from "./walkwayStore.js";

const TOP = 15;

/** Priority zones, found automatically for the selected profile. */
export function ZoneList() {
  const zones = useWalkwayStore((s) => s.zones);
  const loadState = useWalkwayStore((s) => s.loadState);
  const profileId = useWalkwayStore((s) => s.profileId);
  const selected = useWalkwayStore((s) => s.selectedZoneId);
  const places = useWalkwayStore((s) => s.zonePlaces);
  const select = useWalkwayStore((s) => s.selectZone);
  const profile = WALKWAY_CONFIG.profiles[profileId];

  return (
    <section aria-labelledby="zones-title" className="card">
      <h2 id="zones-title" className="card-title">Zones prioritaires</h2>
      <p className="mb-2 text-xs text-slate-600">
        Trouvees automatiquement pour le profil « {profile?.label ?? profileId} » : aucun releve n&apos;est saisi.
      </p>
      {loadState !== "ready" ? (
        <p className="text-sm text-slate-500">{loadState === "error" ? "Calcul impossible." : "Calcul en cours..."}</p>
      ) : zones.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune zone sous le seuil pour ce profil.</p>
      ) : (
        <>
          <p className="mb-2 text-sm font-medium text-slate-900">{zones.length} zones, classees par gravite.</p>
          <ol className="space-y-2">
            {zones.slice(0, TOP).map((zone) => (
              <li key={zone.id}>
                <button
                  type="button"
                  onClick={() => select(selected === zone.id ? null : zone.id)}
                  aria-pressed={selected === zone.id}
                  className="btn btn-toggle btn-block !items-start !text-left"
                >
                  <span className="font-bold">
                    #{zone.rank}
                    {zone.streets.length > 0 && ` · ${zone.streets.join(", ")}`}
                    {places[zone.id] && ` — ${places[zone.id]}`}
                  </span>
                  <span className="block text-xs font-normal">{zone.summary}</span>
                  {selected === zone.id && (
                    <span className="mt-2 block w-full font-normal">
                      <span className="mb-1 block text-xs font-semibold">Score par dimension (0 = obstacle total, 1 = aucun ; entre parentheses : part des donnees)</span>
                      <DimensionBars scores={zone.dimensions} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {zones.length > TOP && <p className="mt-2 text-xs text-slate-500">Les {TOP} premieres sur {zones.length}. Liste complete dans l&apos;onglet Tableau.</p>}
        </>
      )}
    </section>
  );
}
