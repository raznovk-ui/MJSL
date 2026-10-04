import { useMemo, useState } from "react";
import { DEFAULT_CONFIG } from "../../domain/config.js";
import { DIMENSIONS, dimension as dimensionMeta } from "../../domain/dimensions.js";
import { useAppStore } from "../state.js";
import { BarChart, Histogram, StatTile } from "./charts.js";
import { IconDownload } from "./icons.js";
import { WALKWAY_CONFIG, segmentsToGeojson } from "../../domain/walkway/index.js";
import { useWalkwayStore } from "../walkway/walkwayStore.js";
import { buildArchive, downloadBlob, downloadText } from "../export/download.js";
import { observationsCsv, redZonesGeojson, toGeojson } from "../export/project.js";

const MAX = DEFAULT_CONFIG.scaleMax;

function classOf(score: number): string {
  const ratio = score / MAX;
  if (ratio < 1 / 3) return "excluant";
  if (ratio < 2 / 3) return "faible";
  if (ratio < 0.867) return "acceptable";
  return "capacitant";
}

export function Dashboard() {
  const cellScores = useAppStore((s) => s.cellScores);
  const observations = useAppStore((s) => s.observations);
  const ruptures = useAppStore((s) => s.ruptures);
  const redZones = useAppStore((s) => s.redZones);
  const photos = useAppStore((s) => s.photos);
  const globalMode = useAppStore((s) => s.globalMode);
  const scoringConfig = useAppStore((s) => s.scoringConfig);
  const setStatus = useAppStore((s) => s.setStatus);
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => {
    const scored = cellScores.filter((c) => c.sufficient && c.global !== null);
    const mean = scored.length
      ? scored.reduce((sum, c) => sum + c.global!, 0) / scored.length
      : null;

    const perDimension = DIMENSIONS.map((meta) => {
      const entries = cellScores.filter(
        (c) => c.dimensions[meta.key].score !== null && c.dimensions[meta.key].confidence.sufficient,
      );
      const value = entries.length
        ? entries.reduce((sum, c) => sum + c.dimensions[meta.key].score!, 0) / entries.length
        : null;
      return {
        key: meta.key,
        label: `${meta.mjslCode} ${meta.label}`,
        value,
        note: entries.length ? `${entries.length} cellules` : "aucune cellule documentee",
      };
    });

    const bins = ["0–0.75", "0.75–1.5", "1.5–2.25", "2.25–3"].map((label, index) => ({
      label,
      count: scored.filter((c) => {
        const ratio = c.global! / MAX;
        return ratio >= index / 4 && (index === 3 ? ratio <= 1 : ratio < (index + 1) / 4);
      }).length,
    }));

    return {
      mean,
      scored: scored.length,
      total: cellScores.length,
      perDimension,
      bins,
      unrated: observations.filter((o) => o.ratings.every((r) => r.score === null)).length,
      undated: observations.filter((o) => !o.observedAt).length,
      blocking: ruptures.filter((r) => r.blocking).length,
    };
  }, [cellScores, observations, ruptures]);

  async function exportArchive() {
    setBusy(true);
    setStatus("Preparation de l'archive (les photos sont re-encodees sans EXIF)...");
    try {
      const blob = await buildArchive({
        config: scoringConfig(),
        observations,
        ruptures,
        redZones,
        photos,
        // Scored walkway segments, with each value's source, when they are loaded.
        extraFiles: (() => {
          const { segments } = useWalkwayStore.getState();
          return segments.length
            ? { "troncons_scores.geojson": JSON.stringify(segmentsToGeojson(segments, WALKWAY_CONFIG), null, 2) }
            : undefined;
        })(),
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

  return (
    <div className="space-y-6">
      <section aria-labelledby="synthese" className="card">
        <h2 id="synthese" className="card-title">Synthese</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            label={`Score moyen (${globalMode === "weakest_link" ? "maillon faible" : "moyenne ponderee"})`}
            value={stats.mean === null ? "—" : stats.mean.toFixed(2)}
            note={stats.mean === null ? "aucune cellule documentee" : `sur ${MAX} · ${classOf(stats.mean)}`}
          />
          <StatTile
            label="Cellules au score global documente"
            value={`${stats.scored} / ${stats.total}`}
            note={stats.total ? `${Math.round((stats.scored / stats.total) * 100)} % de couverture` : "—"}
          />
          <StatTile label="Zones rouges" value={String(redZones.length)} note={`${stats.blocking} blocage(s) dur(s)`} />
          <StatTile
            label="Releves sans date"
            value={String(stats.undated)}
            note={stats.undated ? "confiance plafonnee" : "toutes datees"}
          />
        </div>
        {stats.mean === null && (
          <p className="callout-warning mt-2">
            Aucune cellule ne passe le seuil de confiance. Les chiffres ci-dessous restent vides tant que
            les releves ne sont pas dates et corrobores — c&apos;est voulu : un score sans preuve ne vaut rien.
          </p>
        )}
      </section>

      <section aria-labelledby="profil" className="card grid gap-6 md:grid-cols-2">
        {/* min-w-0: a grid item's implicit min-width is its content's intrinsic
            width, so the BarChart's fixed-viewBox SVG could otherwise force
            this column wider than the viewport at 320px. */}
        <div className="min-w-0">
          <h2 id="profil" className="card-title">Profil par dimension</h2>
          <BarChart data={stats.perDimension} max={MAX} caption={`Score moyen par dimension (0 a ${MAX})`} />
          {/* Each dimension is counted on its own evidence, so a dimension can
              be documented in cells whose global score is not. */}
          <p className="mt-1 text-xs text-slate-600">
            Chaque dimension est moyennee sur les cellules ou <em>elle</em> est suffisamment documentee.
            Une dimension peut donc etre renseignee la ou le score global ne l&apos;est pas encore.
          </p>
        </div>
        <div className="min-w-0">
          <h2 className="card-title">Distribution des scores</h2>
          <Histogram bins={stats.bins} caption="Nombre de cellules par tranche de score global" />
        </div>
      </section>

      <section aria-labelledby="zones-table" className="card">
        <h2 id="zones-table" className="card-title">Zones rouges classees</h2>
        {redZones.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune zone rouge retenue.</p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th scope="col" className="py-1 pr-2">Rang</th>
                <th scope="col" className="py-1 pr-2">Severite</th>
                <th scope="col" className="py-1 pr-2">Cellules</th>
                <th scope="col" className="py-1 pr-2">Blocages</th>
                <th scope="col" className="py-1 pr-2">Confiance</th>
                <th scope="col" className="py-1">Dimensions en cause</th>
              </tr>
            </thead>
            <tbody>
              {redZones.map((zone, index) => (
                <tr key={zone.id} className="border-b" style={{ borderColor: "var(--line)" }}>
                  <th scope="row" className="py-1 pr-2 font-normal">#{index + 1}</th>
                  <td className="py-1 pr-2">{zone.severityIndex.toFixed(1)}</td>
                  <td className="py-1 pr-2">{zone.areaCells}</td>
                  <td className="py-1 pr-2">{zone.blockingRuptureIds.length}</td>
                  <td className="py-1 pr-2">{zone.meanConfidence.toFixed(2)}</td>
                  <td className="py-1">
                    {zone.dominantDimensions.map((d) => dimensionMeta(d).label).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="inventaire" className="card">
        <h2 id="inventaire" className="card-title">
          Inventaire des ruptures ({ruptures.length})
        </h2>
        {ruptures.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune rupture signalee.</p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th scope="col" className="py-1 pr-2">Description</th>
                <th scope="col" className="py-1 pr-2">Type</th>
                <th scope="col" className="py-1 pr-2">Gravite</th>
                <th scope="col" className="py-1 pr-2">Dimensions</th>
                <th scope="col" className="py-1">Correction suggeree</th>
              </tr>
            </thead>
            <tbody>
              {ruptures.map((rupture) => (
                <tr key={rupture.id} className="border-b" style={{ borderColor: "var(--line)" }}>
                  <th scope="row" className="py-1 pr-2 font-normal">{rupture.comment || "—"}</th>
                  <td className="py-1 pr-2">{rupture.blocking ? "Blocage dur" : "Friction"}</td>
                  <td className="py-1 pr-2">{rupture.severity} / {MAX}</td>
                  <td className="py-1 pr-2">{rupture.dimensions.join(", ") || "—"}</td>
                  <td className="py-1">{rupture.suggestedFix || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="export" className="card no-print">
        <h2 id="export" className="card-title">Export</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportArchive()}
            disabled={busy}
            className="btn btn-primary"
          >
            <IconDownload />
            {busy ? "Preparation..." : "Archive complete (.zip)"}
          </button>
          <button
            type="button"
            onClick={() => downloadText(observationsCsv(observations), "observations.csv", "text/csv")}
            className="btn btn-secondary"
          >
            Observations (.csv)
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                JSON.stringify(toGeojson(observations, ruptures), null, 2),
                "mjsl.geojson",
                "application/geo+json",
              )
            }
            className="btn btn-secondary"
          >
            GeoJSON pour QGIS
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                JSON.stringify(redZonesGeojson(redZones), null, 2),
                "zones_rouges.geojson",
                "application/geo+json",
              )
            }
            className="btn btn-secondary"
          >
            Zones rouges (.geojson)
          </button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">
            Imprimer / PDF
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Les photos de l&apos;archive sont re-encodees sans metadonnees EXIF : ni lieu, ni heure, ni appareil.
        </p>
      </section>
    </div>
  );
}
