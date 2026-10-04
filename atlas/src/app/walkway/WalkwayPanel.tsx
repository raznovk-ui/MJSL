import { useId, useMemo } from "react";
import { WALKWAY_CONFIG, type RouteResult, type ScoreClass } from "../../domain/walkway/index.js";
import { useWalkwayStore } from "./walkwayStore.js";

const CLASS_LABEL: Record<ScoreClass, string> = {
  red: "Rouge (< seuil bas) — trait pointille",
  orange: "Orange",
  green: "Vert",
  none: "Pas assez de donnees",
};

const { colours, redBelow, orangeBelow } = WALKWAY_CONFIG.classes;

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
  const { load, setProfile, toggleVisible, armPicking, clearRoute } = useWalkwayStore.getState();

  const counts = useMemo(() => {
    const out: Record<ScoreClass, number> = { red: 0, orange: 0, green: 0, none: 0 };
    for (const score of Object.values(scores[profileId] ?? {})) out[score.cls] += 1;
    return out;
  }, [scores, profileId]);

  // How much of each indicator is real data, and from where. The colours are
  // only as good as this: most OSM footways carry no width or slope tag.
  const coverage = useMemo(() => {
    const total = segments.length;
    const bySource = (key: "width" | "noise" | "slope" | "surface" | "rest" | "economic", has: (s: (typeof segments)[number]) => boolean) => {
      const known = segments.filter(has);
      const estimated = known.filter((s) => s.sources?.[key] === "estimated").length;
      return { known: known.length, estimated, total };
    };
    return [
      { label: "Largeur", ...bySource("width", (s) => s.values.widthM !== undefined) },
      { label: "Pente", ...bySource("slope", (s) => s.values.inclinePct !== undefined) },
      { label: "Revetement", ...bySource("surface", (s) => s.values.surface !== undefined) },
      { label: "Bruit", ...bySource("noise", (s) => s.values.noiseDb !== undefined) },
      { label: "Banc le plus proche", ...bySource("rest", (s) => s.values.restDistanceM !== undefined) },
      { label: "Terrasses / parkings", ...bySource("economic", (s) => s.values.privatizedShare !== undefined) },
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
                  {c.estimated > 0 ? " (estime, non mesure)" : c.known > 0 ? " (OSM)" : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Un indicateur absent est ignore, pas compte comme 0. Banc et terrasses sont calcules a partir des objets
              OSM charges : un banc non cartographie est invisible ici.
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
