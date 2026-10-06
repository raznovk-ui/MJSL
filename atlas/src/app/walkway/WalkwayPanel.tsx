import { useId, useMemo } from "react";
import {
  WALKWAY_CONFIG,
  type IndicatorKey,
  type RouteResult,
  type ScoreClass,
  type Segment,
  type ValueSource,
} from "../../domain/walkway/index.js";
import { useWalkwayStore } from "./walkwayStore.js";

const CLASS_LABEL: Record<ScoreClass, string> = {
  red: "Rouge (< seuil bas) — trait pointille",
  orange: "Orange",
  green: "Vert",
  none: "Pas assez de donnees",
};

const { colours, redBelow, orangeBelow } = WALKWAY_CONFIG.classes;

const SOURCE_LABEL: Record<ValueSource, string> = {
  measured: "mesure",
  osm: "OSM",
  official: "officiel",
  estimated: "estime",
};

function routeState(route: RouteResult): string {
  if (!route.connected) return "Aucun chemin";
  return route.possible ? "Possible" : route.detour ? "Bloque — detour" : "Bloque — impossible";
}

export function WalkwayPanel() {
  const ids = useId();
  const loadState = useWalkwayStore((s) => s.loadState);
  const error = useWalkwayStore((s) => s.error);
  const segments = useWalkwayStore((s) => s.segments);
  const scores = useWalkwayStore((s) => s.scores);
  const profileId = useWalkwayStore((s) => s.profileId);
  const visible = useWalkwayStore((s) => s.visible);
  const routePicking = useWalkwayStore((s) => s.routePicking);
  const routeFrom = useWalkwayStore((s) => s.routeFrom);
  const routeTo = useWalkwayStore((s) => s.routeTo);
  const routes = useWalkwayStore((s) => s.routes);
  const auto = useWalkwayStore((s) => s.auto);
  const { load, setProfile, toggleVisible, armPicking, clearRoute } = useWalkwayStore.getState();

  const counts = useMemo(() => {
    const out: Record<ScoreClass, number> = { red: 0, orange: 0, green: 0, none: 0 };
    for (const score of Object.values(scores[profileId] ?? {})) out[score.cls] += 1;
    return out;
  }, [scores, profileId]);

  // How much of each indicator is filled in, and from where. The colours are only
  // as good as this: most OSM footways carry no width or slope tag.
  const coverage = useMemo(() => {
    const total = segments.length;
    const row = (label: string, key: IndicatorKey, has: (s: Segment) => boolean) => {
      const bySource: Record<string, number> = {};
      let known = 0;
      for (const segment of segments) {
        if (!has(segment)) continue;
        known += 1;
        const source = segment.sources?.[key] ?? "measured";
        bySource[source] = (bySource[source] ?? 0) + 1;
      }
      const detail = (["measured", "osm", "official", "estimated"] as const)
        .filter((source) => bySource[source])
        .map((source) => `${SOURCE_LABEL[source]} ${bySource[source]}`)
        .join(", ");
      return { label, known, total, detail };
    };
    return [
      row("Largeur", "width", (s) => s.values.widthM !== undefined),
      row("Pente", "slope", (s) => s.values.inclinePct !== undefined),
      row("Revetement", "surface", (s) => s.values.surface !== undefined),
      row("Bruit", "noise", (s) => s.values.noiseDb !== undefined),
      row("Banc le plus proche", "rest", (s) => s.values.restDistanceM !== undefined),
      row("Terrasses / parkings", "economic", (s) => s.values.privatizedShare !== undefined),
      row("Eclairage", "lighting", (s) => s.values.unlitShare !== undefined),
      row("Reperes (commerces, arrets)", "landmarks", (s) => s.values.landmarkCount !== undefined),
      row("Lieux d'activites", "activities", (s) => s.values.activityDistanceM !== undefined),
      row("Lieux de decision / civiques", "civic", (s) => s.values.civicDistanceM !== undefined),
      row("Espaces prives / publics", "publicPrivate", (s) => s.values.privateShare !== undefined),
      row("Marches a l'entree des lieux", "thresholds", (s) => s.values.thresholdSteps !== undefined),
      row("Cameras, portails", "surveillance", (s) => s.values.controlDevices !== undefined),
      row("Largeur reelle (marcher a deux)", "width", (s) => s.values.widthM !== undefined && s.sources?.width !== "estimated"),
      row("Abris, seuils habitables", "shelter", (s) => s.values.shelterCount !== undefined),
      row("Transports en commun (modes)", "transit", (s) => s.values.transitModes !== undefined),
      row("Passages pietons proches", "crossings", (s) => s.values.crossingBarrier !== undefined),
      row("Eblouissement (materiau)", "surface", (s) => s.values.surface !== undefined),
      row("Signaletique", "signage", (s) => s.values.signageCount !== undefined),
      row("Services gratuits", "freeServices", (s) => s.values.freeServiceDistanceM !== undefined),
      row("Lisibilite du trace", "legibility", (s) => s.values.sinuosity !== undefined),
      row("Centres d'information", "infoCentres", (s) => s.values.infoDistanceM !== undefined),
      row("Pauvrete du quartier (IRIS)", "poverty", (s) => s.values.areaPovertyPct !== undefined),
      row("Dispositif de co-participation", "participation", (s) => s.values.inParticipationArea !== undefined),
    ];
  }, [segments]);

  const nameOf = (id: string | null) => {
    if (!id) return "—";
    const segment = segments.find((s) => s.id === id);
    return segment?.name ? `${segment.name} (${id})` : id;
  };
  const loading = loadState === "loading";

  return (
    <section aria-labelledby={`${ids}-h`} className="card">
      <h2 id={`${ids}-h`} className="card-title">
        Parcours pietons par profil ({segments.length} troncons)
      </h2>

      <button type="button" onClick={() => void load({ forceRefresh: loadState === "ready" })} disabled={loading} className="btn btn-secondary btn-block">
        {loading ? "Chargement..." : loadState === "ready" ? "Rafraichir depuis Overpass" : "Charger les troncons (OSM)"}
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
              {Object.entries(WALKWAY_CONFIG.profiles).map(([id, p]) => (
                <option key={id} value={id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="callout-info">
            <p className="font-semibold">Remplissage automatique</p>
            <ul className="mt-0.5 list-disc pl-4">
              <li>
                Bruit :{" "}
                {auto.noise === "official"
                  ? "carte officielle (Lden 24 h, Metropole AMP)"
                  : auto.noise === "estimate"
                    ? "estimation par la distance aux grands axes (carte officielle indisponible)"
                    : "aucune donnee"}
              </li>
              <li>
                Pente :{" "}
                {auto.slope === "running"
                  ? `altitudes IGN en cours${auto.slopeProgress && auto.slopeProgress.total ? ` (${auto.slopeProgress.done} / ${auto.slopeProgress.total} points)` : "..."}`
                  : auto.slope === "done"
                    ? "calculee a partir des altitudes IGN (troncons de 20 m et plus)"
                    : auto.slope === "partial"
                      ? `partielle : ${auto.slopeError ?? "erreur"}`
                      : auto.slope === "error"
                        ? `indisponible : ${auto.slopeError ?? "erreur"}`
                        : "—"}
              </li>
              <li>Largeur : etiquette OSM, sinon valeur type par defaut (estimee, jamais eliminatoire).</li>
            </ul>
          </div>

          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={visible} onChange={toggleVisible} className="mt-1" />
            <span>Afficher les troncons sur la carte</span>
          </label>

          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Legende et nombre de troncons</p>
            <ul className="space-y-1">
              {(["red", "orange", "green", "none"] as const).map((cls) => (
                <li key={cls} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0 w-7 shrink-0"
                    style={{ borderTop: `4px ${cls === "red" ? "dashed" : "solid"} ${colours[cls]}` }}
                  />
                  <span>
                    {CLASS_LABEL[cls]}
                    {cls === "red" && ` : score < ${redBelow}`}
                    {cls === "orange" && ` : < ${orangeBelow}`}
                    {cls === "green" && ` : ${orangeBelow} et plus`}
                    {" — "}
                    <strong>{counts[cls]}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Chaque score est un produit : un seul obstacle grave suffit a l&apos;effondrer. Une valeur manquante est
              ignoree, jamais comptee comme 0.
            </p>
          </div>

          <details>
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">Donnees disponibles par indicateur</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {coverage.map((c) => (
                <li key={c.label}>
                  {c.label} : {c.known} / {c.total}
                  {c.detail ? ` (${c.detail})` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Un indicateur absent est ignore, pas compte comme 0. Banc et terrasses sont calcules a partir des objets
              OSM charges : un banc non cartographie est invisible ici. « estime » = hypothese par defaut, pas une mesure.
            </p>
          </details>

          <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <p className="mb-1.5 text-xs font-semibold text-slate-700">Parcours entre deux points</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => armPicking(routePicking === "from" ? null : "from")} aria-pressed={routePicking === "from"} className="btn btn-toggle btn-sm">
                {routeFrom ? "Changer le depart" : "Choisir le depart"}
              </button>
              <button type="button" onClick={() => armPicking(routePicking === "to" ? null : "to")} aria-pressed={routePicking === "to"} className="btn btn-toggle btn-sm" disabled={!routeFrom}>
                {routeTo ? "Changer l'arrivee" : "Choisir l'arrivee"}
              </button>
              {(routeFrom || routeTo) && (
                <button type="button" onClick={clearRoute} className="btn btn-ghost btn-sm">Effacer</button>
              )}
            </div>

            {routes.length > 0 && (
              <div className="card mt-2 overflow-x-auto p-0">
                <table className="w-full min-w-[300px] border-collapse text-left text-xs">
                  <caption className="p-2 text-left text-xs text-slate-500">
                    Le score d&apos;un parcours est celui de son maillon le plus faible.
                  </caption>
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--line)", background: "var(--surface-alt)" }}>
                      <th scope="col" className="px-2 py-1.5">Profil</th>
                      <th scope="col" className="px-2 py-1.5">Etat</th>
                      <th scope="col" className="px-2 py-1.5">Score</th>
                      <th scope="col" className="px-2 py-1.5">Maillon faible</th>
                      <th scope="col" className="px-2 py-1.5">Detour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((r) => (
                      <tr key={r.profileId} className="border-b align-top" style={{ borderColor: "var(--line)", background: r.profileId === profileId ? "var(--brand-tint)" : undefined }}>
                        <th scope="row" className="px-2 py-1 font-semibold">{WALKWAY_CONFIG.profiles[r.profileId]?.label ?? r.profileId}</th>
                        <td className="px-2 py-1">{routeState(r)}</td>
                        <td className="px-2 py-1">{r.score === null ? "—" : r.score.toFixed(2)}</td>
                        <td className="px-2 py-1">{nameOf(r.weakestSegmentId)}</td>
                        <td className="px-2 py-1">
                          {r.detour
                            ? `+${Math.round(r.detour.extraLengthM)} m (score ${r.detour.score === null ? "—" : r.detour.score.toFixed(2)})`
                            : r.possible ? "—" : "aucun"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {routes.some((r) => r.unscoredSegmentIds.length > 0) && (
                  <p className="callout-warning m-2">
                    Certains troncons du parcours n&apos;ont pas assez de donnees pour etre notes : le maillon
                    faible peut etre l&apos;un d&apos;eux.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
