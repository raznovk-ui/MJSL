import { DIMENSIONS } from "../../domain/dimensions.js";
import { WALKWAY_CONFIG, type IndicatorKey, type Segment, type ValueSource } from "../../domain/walkway/index.js";
import { useWalkwayStore } from "./walkwayStore.js";

const LABEL: Record<IndicatorKey, string> = {
  width: "Largeur", noise: "Bruit", slope: "Pente", surface: "Revetement", rest: "Distance a un banc", economic: "Privatisation",
};
const SOURCE: Record<ValueSource, string> = { measured: "mesure", osm: "OSM", official: "officiel", estimated: "estime" };

function rawValue(segment: Segment, key: IndicatorKey): string {
  const v = segment.values;
  switch (key) {
    case "width": return v.widthM === undefined ? "—" : `${v.widthM.toFixed(2)} m`;
    case "noise": return v.noiseDb === undefined ? "—" : `${v.noiseDb.toFixed(1)} dB`;
    case "slope": return v.inclinePct === undefined ? "—" : `${v.inclinePct.toFixed(1)} %`;
    case "surface": return v.surface ?? "—";
    case "rest": return v.restDistanceM === undefined ? "—" : `${Math.round(v.restDistanceM)} m`;
    case "economic": return v.privatizedShare === undefined ? "—" : `${Math.round(v.privatizedShare * 100)} %`;
  }
}

function rule(key: IndicatorKey): string {
  const i = WALKWAY_CONFIG.indicators[key];
  if ("scores" in i) return "table de revetements";
  if (!("noProblemAt" in i)) return "part privatisee (0 a 1)";
  return `0 a ${i.noProblemAt}, 1 a ${i.totalObstacleAt}`;
}

/** Shows, for the segment clicked on the map, every step behind its score. */
export function SegmentInspector() {
  const id = useWalkwayStore((s) => s.inspectedId);
  const segments = useWalkwayStore((s) => s.segments);
  const scores = useWalkwayStore((s) => s.scores);
  const profileId = useWalkwayStore((s) => s.profileId);
  const inspect = useWalkwayStore((s) => s.inspectSegment);
  const segment = segments.find((s) => s.id === id);
  const score = id ? scores[profileId]?.[id] : undefined;
  const profile = WALKWAY_CONFIG.profiles[profileId];

  return (
    <section aria-labelledby="inspect-title" className="card">
      <h2 id="inspect-title" className="card-title">Verifier un calcul</h2>
      {!segment || !score || !profile ? (
        <p className="text-sm text-slate-600">Clique un troncon sur la carte pour voir comment son score est calcule, profil par profil.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-slate-900">
            {segment.name || "Troncon sans nom"} · {Math.round(segment.lengthM ?? 0)} m
            <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => inspect(null)}>Fermer</button>
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="pb-1 text-left text-slate-600">1. Valeur → obstacle (0 = aucun probleme, 1 = obstacle total)</caption>
              <thead><tr><th scope="col">Indicateur</th><th scope="col">Valeur</th><th scope="col">Source</th><th scope="col">Regle</th><th scope="col">Obstacle</th></tr></thead>
              <tbody>
                {score.barriers.map((b) => (
                  <tr key={b.indicator} className="border-t border-slate-200">
                    <th scope="row" className="font-medium">{LABEL[b.indicator]}</th>
                    <td>{rawValue(segment, b.indicator)}</td>
                    <td>{b.source ? SOURCE[b.source] : "—"}</td>
                    <td className="text-slate-500">{rule(b.indicator)}</td>
                    <td>{b.barrier === null ? "pas de donnee" : b.barrier.toFixed(2)}</td>
                  </tr>
                ))}
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
                  return (
                    <tr key={d.key} className="border-t border-slate-200">
                      <th scope="row" className="font-medium">{d.label}</th>
                      <td>{b === undefined ? "pas de donnee (ignoree)" : b.toFixed(2)}</td>
                      <td>{w}</td>
                      <td>{b === undefined ? "—" : Math.pow(1 - b, w / sum).toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p>
            <strong>3. Resultat :</strong>{" "}
            {score.vetoed
              ? `0 — blocage eliminatoire (${score.vetoReasons.join(" ; ")}).`
              : score.score === null
                ? "pas assez de donnees pour noter."
                : `produit des facteurs = ${score.score.toFixed(3)} (${score.cls === "red" ? "rouge" : score.cls === "orange" ? "orange" : "vert"}).`}
          </p>
          <p className="text-xs text-slate-500">
            Seuils : rouge sous {WALKWAY_CONFIG.classes.redBelow}, orange sous {WALKWAY_CONFIG.classes.orangeBelow}. Tout se regle dans walkway.config.json.
          </p>
        </div>
      )}
    </section>
  );
}
