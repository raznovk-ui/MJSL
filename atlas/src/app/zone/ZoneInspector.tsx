import { DIMENSIONS } from "../../domain/dimensions.js";
import { ZONE_CONFIG, dimensionScores, type ValueSource } from "../../domain/zone/index.js";
import { DimensionBars } from "./DimensionBars.js";
import { useZoneStore } from "./zoneStore.js";

const SOURCE: Record<ValueSource, string> = { osm: "OSM", official: "officiel", reported: "signalements" };

/** Shows, for the zone clicked on the map, every step behind its score. */
export function ZoneInspector() {
  const id = useZoneStore((s) => s.selectedZoneId);
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const select = useZoneStore((s) => s.selectZone);
  const zone = zones.find((z) => z.id === id);
  const score = id ? scores[profileId]?.[id] : undefined;
  const profile = ZONE_CONFIG.profiles[profileId];

  return (
    <section aria-labelledby="inspect-title" className="card">
      <h2 id="inspect-title" className="card-title">Verifier un calcul</h2>
      {!zone || !score || !profile ? (
        <p className="text-sm text-slate-600">Clique une zone sur la carte pour voir comment son score est calcule, profil par profil.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-slate-900">
            {zone.name} · {zone.arrondissement.replace("Marseille ", "")} · {zone.areaKm2.toFixed(2)} km² · {zone.streetKm.toFixed(1)} km de rue
            <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => select(null)}>Fermer</button>
          </p>
          <p className="text-xs text-slate-600">
            Signalements d&apos;habitants : stationnement {zone.counts.reportsParking ?? 0}, trottoir etroit {zone.counts.reportsNarrow ?? 0},
            chantier / encombrants {zone.counts.reportsWorks ?? 0}, terrasses / mobilier {zone.counts.reportsFurniture ?? 0}.
          </p>

          <div>
            <p className="pb-1 text-xs text-slate-600">Score de cette zone par dimension (0 = obstacle total, 1 = aucun)</p>
            <DimensionBars scores={dimensionScores([zone], { [zone.id]: score })} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="pb-1 text-left text-slate-600">1. Valeur → obstacle (0 = aucun probleme, 1 = obstacle total)</caption>
              <thead><tr><th scope="col">Indicateur</th><th scope="col">Valeur</th><th scope="col">Source</th><th scope="col">Regle</th><th scope="col">Obstacle</th></tr></thead>
              <tbody>
                {score.barriers.map((b) => {
                  const c = ZONE_CONFIG.indicators[b.indicator]!;
                  const v = zone.values[b.indicator];
                  return (
                    <tr key={b.indicator} className="border-t border-slate-200">
                      <th scope="row" className="font-medium">{c.label}</th>
                      <td>{v === undefined ? "—" : `${Number(v.toFixed(2))} ${c.unit}`}</td>
                      <td>{b.source ? SOURCE[b.source] : "—"}</td>
                      <td className="text-slate-500">{c.kind === "share" ? "deja un obstacle (0 a 1)" : `${c.kind === "evidence" ? "s'ajoute aux autres : " : ""}0 a ${c.noProblemAt}, 1 a ${c.totalObstacleAt}`}</td>
                      <td>{b.barrier === null ? "pas de donnee" : b.barrier.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="pb-1 text-left text-slate-600">2. Profil « {profile.label} » : moyenne par dimension, poids, puis (1 − obstacle)^(poids / somme)</caption>
              <thead><tr><th scope="col">Dimension</th><th scope="col">Obstacle moyen</th><th scope="col">Poids</th><th scope="col">Facteur</th></tr></thead>
              <tbody>
                {DIMENSIONS.filter((d) => (profile.weights[d.key] ?? 0) > 0).map((d) => {
                  const b = score.dimensionBarriers[d.key];
                  const w = profile.weights[d.key]!;
                  const sum = DIMENSIONS.reduce((t, x) => t + (score.dimensionBarriers[x.key] !== undefined ? profile.weights[x.key] ?? 0 : 0), 0);
                  const capped = b === undefined ? undefined : Math.min(b, ZONE_CONFIG.scoring.dimensionBarrierCap);
                  return (
                    <tr key={d.key} className="border-t border-slate-200">
                      <th scope="row" className="font-medium">{d.label}</th>
                      <td>{b === undefined ? "pas de donnee (ignoree)" : b.toFixed(2) + (capped !== b ? ` (plafonne a ${capped!.toFixed(2)})` : "")}</td>
                      <td>{w}</td>
                      <td>{capped === undefined ? "—" : Math.pow(1 - capped, w / sum).toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p>
            <strong>3. Resultat :</strong>{" "}
            {score.score === null ? "pas assez de donnees pour noter." : `produit des facteurs = ${score.score.toFixed(3)} (${score.cls === "red" ? "rouge" : score.cls === "orange" ? "orange" : "vert"}).`}
          </p>
          <p className="text-xs text-slate-500">
            Seuils : rouge sous {ZONE_CONFIG.classes.redBelow}, orange sous {ZONE_CONFIG.classes.orangeBelow}. Tout se regle dans zone.config.json.
          </p>
        </div>
      )}
    </section>
  );
}
