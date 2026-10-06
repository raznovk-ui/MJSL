import { useMemo, useState } from "react";
import { WALKWAY_CONFIG, dimensionScores, segmentsToGeojson, type ScoreClass } from "../../domain/walkway/index.js";
import { useAppStore } from "../state.js";
import { useWalkwayStore } from "../walkway/walkwayStore.js";
import { DimensionBars } from "../walkway/DimensionBars.js";
import { zonesGeojson } from "../walkway/walkwayLayers.js";
import { BarChart, StatTile } from "./charts.js";
import { IconDownload } from "./icons.js";
import { buildArchive, downloadBlob, downloadText } from "../export/download.js";

const CLASS_LABEL: Record<ScoreClass, string> = {
  red: "Rouge (dashed)",
  orange: "Orange",
  green: "Vert",
  none: "Pas assez de donnees",
};

export function Dashboard() {
  const segments = useWalkwayStore((s) => s.segments);
  const scores = useWalkwayStore((s) => s.scores);
  const zones = useWalkwayStore((s) => s.zones);
  const profileId = useWalkwayStore((s) => s.profileId);
  const setStatus = useAppStore((s) => s.setStatus);
  const [busy, setBusy] = useState(false);
  const profile = WALKWAY_CONFIG.profiles[profileId];

  const stats = useMemo(() => {
    const byId = scores[profileId] ?? {};
    const length: Record<ScoreClass, number> = { red: 0, orange: 0, green: 0, none: 0 };
    let total = 0;
    let vetoed = 0;
    for (const segment of segments) {
      const s = byId[segment.id];
      const l = segment.lengthM ?? 0;
      length[s?.cls ?? "none"] += l;
      total += l;
      if (s?.vetoed) vetoed += 1;
    }
    return { length, total, vetoed, zoneLength: zones.reduce((sum, z) => sum + z.lengthM, 0) };
  }, [segments, scores, profileId, zones]);

  const dims = useMemo(() => dimensionScores(segments, scores[profileId] ?? {}), [segments, scores, profileId]);

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const pct = (m: number) => (stats.total ? `${Math.round((m / stats.total) * 100)} %` : "—");

  async function exportArchive() {
    setBusy(true);
    try {
      const blob = await buildArchive({
        "troncons.geojson": JSON.stringify(segmentsToGeojson(segments, WALKWAY_CONFIG), null, 2),
        "zones.geojson": JSON.stringify(zonesGeojson(zones), null, 2),
      });
      downloadBlob(blob, `atlas-mjsl-${new Date().toISOString().slice(0, 10)}.zip`);
      setStatus("Archive exportee.");
    } catch (error) {
      console.error(error);
      setStatus("Echec de l'export.");
    } finally {
      setBusy(false);
    }
  }

  if (segments.length === 0) {
    return <p className="card text-sm text-slate-500">Le calcul automatique n&apos;est pas termine.</p>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="synthese" className="card">
        <h2 id="synthese" className="card-title">Synthese — profil « {profile?.label ?? profileId} »</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label="Troncons notes" value={String(segments.length)} note={km(stats.total)} />
          <StatTile label="Zones prioritaires" value={String(zones.length)} note={`${km(stats.zoneLength)} au total`} />
          <StatTile label="Part en rouge" value={pct(stats.length.red)} note={km(stats.length.red)} />
          <StatTile label="Blocages eliminatoires" value={String(stats.vetoed)} note="troncons" />
        </div>
      </section>

      <section aria-labelledby="dims" className="card">
        <h2 id="dims" className="card-title">Score par dimension — toute la ville</h2>
        <p className="mb-2 text-xs text-slate-600">
          De 0 (obstacle total) a 1 (aucun obstacle), moyenne ponderee par la longueur des troncons. Entre
          parentheses : la part du reseau pour laquelle les donnees ouvertes donnent une reponse. Ces cinq
          scores ne dependent pas du profil : le profil decide seulement du poids de chacun dans le score final.
        </p>
        <DimensionBars scores={dims} />
      </section>

      <section aria-labelledby="classes" className="card">
        <h2 id="classes" className="card-title">Repartition par longueur</h2>
        <div className="min-w-0">
          <BarChart
            data={(["red", "orange", "green", "none"] as const).map((cls) => ({
              key: cls,
              label: CLASS_LABEL[cls],
              value: stats.length[cls] / 1000,
            }))}
            max={Math.max(stats.total / 1000, 0.1)}
            caption="Kilometres de troncons par classe"
            unit=" km"
          />
        </div>
      </section>

      <section aria-labelledby="export" className="card">
        <h2 id="export" className="card-title">Export</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportArchive()} disabled={busy} className="btn btn-primary">
            <IconDownload />
            Archive (.zip)
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(JSON.stringify(zonesGeojson(zones), null, 2), "zones.geojson", "application/geo+json")
            }
            className="btn btn-secondary"
          >
            Zones (GeoJSON)
          </button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">
            Imprimer
          </button>
        </div>
      </section>
    </div>
  );
}
