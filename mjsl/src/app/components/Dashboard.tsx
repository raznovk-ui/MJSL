import { useMemo, useState } from "react";
import { ZONE_CONFIG, dimensionScores, zonesToGeojson, type ScoreClass } from "../../domain/zone/index.js";
import { useAppStore } from "../state.js";
import { useZoneStore } from "../zone/zoneStore.js";
import { DimensionBars } from "../zone/DimensionBars.js";
import { BarChart, StatTile } from "./charts.js";
import { IconDownload } from "./icons.js";
import { buildArchive, downloadBlob, downloadText } from "../export/download.js";

const CLASS_LABEL: Record<ScoreClass, string> = {
  red: "Rouge (contour pointille)",
  orange: "Orange",
  green: "Vert",
  none: "Pas assez de donnees",
};

export function Dashboard() {
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const ranking = useZoneStore((s) => s.ranking);
  const reports = useZoneStore((s) => s.reports);
  const profileId = useZoneStore((s) => s.profileId);
  const setStatus = useAppStore((s) => s.setStatus);
  const [busy, setBusy] = useState(false);
  const profile = ZONE_CONFIG.profiles[profileId];

  const stats = useMemo(() => {
    const byId = scores[profileId] ?? {};
    const area: Record<ScoreClass, number> = { red: 0, orange: 0, green: 0, none: 0 };
    let total = 0;
    let streetKm = 0;
    for (const zone of zones) {
      area[byId[zone.id]?.cls ?? "none"] += zone.areaKm2;
      total += zone.areaKm2;
      streetKm += zone.streetKm;
    }
    const inZones = zones.reduce((n, z) => n + Object.entries(z.counts).filter(([k]) => k.startsWith("reports")).reduce((m, [, v]) => m + v, 0), 0);
    return { area, total, streetKm, inZones };
  }, [zones, scores, profileId]);

  const dims = useMemo(() => dimensionScores(zones, scores[profileId] ?? {}), [zones, scores, profileId]);
  const pct = (km2: number) => (stats.total ? `${Math.round((km2 / stats.total) * 100)} %` : "—");

  async function exportArchive() {
    setBusy(true);
    try {
      const blob = await buildArchive({ "zones.geojson": JSON.stringify(zonesToGeojson(zones, ZONE_CONFIG), null, 2) });
      downloadBlob(blob, `mjsl-${new Date().toISOString().slice(0, 10)}.zip`);
      setStatus("Archive exportee.");
    } catch (error) {
      console.error(error);
      setStatus("Echec de l'export.");
    } finally {
      setBusy(false);
    }
  }

  if (zones.length === 0) {
    return <p className="card text-sm text-slate-500">Le calcul automatique n&apos;est pas termine.</p>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="synthese" className="card">
        <h2 id="synthese" className="card-title">Synthese — profil « {profile?.label ?? profileId} »</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label="Zones notees" value={String(zones.length)} note={`${stats.total.toFixed(0)} km², ${stats.streetKm.toFixed(0)} km de rue`} />
          <StatTile label="Zones prioritaires" value={String(stats.area.red ? ranking.filter((r) => scores[profileId]?.[r.zone.id]?.cls === "red").length : 0)} note="en rouge pour ce profil" />
          <StatTile label="Signalements d'habitants" value={String(reports.length)} note={`${stats.inZones} places dans une zone`} />
          <StatTile label="Part de la ville en rouge" value={pct(stats.area.red)} note={`${stats.area.red.toFixed(0)} km²`} />
        </div>
      </section>

      <section aria-labelledby="dims" className="card">
        <h2 id="dims" className="card-title">Score par dimension — toute la ville</h2>
        <p className="mb-2 text-xs text-slate-600">
          De 0 (obstacle total) a 1 (aucun obstacle), moyenne ponderee par la surface des zones. Entre parentheses : la part de la
          ville pour laquelle les donnees ouvertes donnent une reponse. Ces six scores ne dependent pas du profil : le profil
          decide seulement du poids de chacun dans le score final.
        </p>
        <DimensionBars scores={dims} />
      </section>

      <section aria-labelledby="classes" className="card">
        <h2 id="classes" className="card-title">Repartition par surface</h2>
        <div className="min-w-0">
          <BarChart
            data={(["red", "orange", "green", "none"] as const).map((cls) => ({ key: cls, label: CLASS_LABEL[cls], value: stats.area[cls] }))}
            max={Math.max(stats.total, 1)}
            caption="Kilometres carres de zones par classe"
            unit=" km²"
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
          <button type="button" onClick={() => downloadText(JSON.stringify(zonesToGeojson(zones, ZONE_CONFIG), null, 2), "zones.geojson", "application/geo+json")} className="btn btn-secondary">
            Zones (GeoJSON)
          </button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">Imprimer</button>
        </div>
      </section>
    </div>
  );
}
