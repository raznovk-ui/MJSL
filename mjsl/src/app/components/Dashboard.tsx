import { useMemo, useState } from "react";
import { ArchiveIcon, DownloadIcon, FileJson2Icon, PrinterIcon } from "lucide-react";
import { ZONE_CONFIG, dimensionScores, zonesToGeojson, type ScoreClass } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "../state.js";
import { useZoneStore } from "../zone/zoneStore.js";
import { DimensionBars } from "../zone/DimensionBars.js";
import { BarChart, StatTile } from "./charts.js";
import { buildArchive, downloadBlob, downloadText } from "../export/download.js";
import { PdfMapExport } from "./PdfMapExport.js";

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
    return (
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">Le calcul automatique n&apos;est pas termine.</CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card role="region" aria-labelledby="synthese">
        <CardHeader>
          <CardTitle id="synthese" role="heading" aria-level={2}>Synthese - profil « {profile?.label ?? profileId} »</CardTitle>
          <CardDescription>Les indicateurs principaux pour le profil actuellement selectionne.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Zones notees" value={String(zones.length)} note={`${stats.total.toFixed(0)} km², ${stats.streetKm.toFixed(0)} km de rue`} />
          <StatTile label="Zones prioritaires" value={String(stats.area.red ? ranking.filter((r) => scores[profileId]?.[r.zone.id]?.cls === "red").length : 0)} note="en rouge pour ce profil" />
          <StatTile label="Signalements d'habitants" value={String(reports.length)} note={`${stats.inZones} places dans une zone`} />
          <StatTile label="Part de la ville en rouge" value={pct(stats.area.red)} note={`${stats.area.red.toFixed(0)} km²`} />
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="dims">
        <CardHeader>
          <CardTitle id="dims" role="heading" aria-level={2}>Score par dimension - toute la ville</CardTitle>
          <CardDescription>
          De 0 (obstacle total) a 1 (aucun obstacle), moyenne ponderee par la surface des zones. Entre parentheses : la part de la
          ville pour laquelle les donnees ouvertes donnent une reponse. Ces six scores ne dependent pas du profil : le profil
          decide seulement du poids de chacun dans le score final.
          </CardDescription>
        </CardHeader>
        <CardContent><DimensionBars scores={dims} /></CardContent>
      </Card>

      <Card role="region" aria-labelledby="classes">
        <CardHeader>
          <CardTitle id="classes" role="heading" aria-level={2}>Repartition par surface</CardTitle>
          <CardDescription>Surface des zones selon leur niveau de priorite pour ce profil.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          <BarChart
            data={(["red", "orange", "green", "none"] as const).map((cls) => ({ key: cls, label: CLASS_LABEL[cls], value: stats.area[cls] }))}
            max={Math.max(stats.total, 1)}
            caption="Kilometres carres de zones par classe"
            unit=" km²"
          />
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="export">
        <CardHeader>
          <CardTitle id="export" role="heading" aria-level={2}>Exporter et imprimer</CardTitle>
          <CardDescription>Telechargez les donnees ou une carte de la vue actuelle.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void exportArchive()} disabled={busy}>
            <ArchiveIcon data-icon="inline-start" />
            Archive (.zip)
          </Button>
          <PdfMapExport />
          <Button type="button" variant="outline" onClick={() => downloadText(JSON.stringify(zonesToGeojson(zones, ZONE_CONFIG), null, 2), "zones.geojson", "application/geo+json")}>
            <FileJson2Icon data-icon="inline-start" />
            Zones (GeoJSON)
          </Button>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" />
            Imprimer
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
