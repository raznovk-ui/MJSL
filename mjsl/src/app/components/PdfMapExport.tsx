import { useId, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { buildMapPdf, orderedLayers } from "../export/pdfMap.js";
import { downloadBlob } from "../export/download.js";
import { useAppStore } from "../state.js";
import { type MapLayer, useZoneStore } from "../zone/zoneStore.js";

const ALL_LAYERS: MapLayer[] = ["combined", ...DIMENSION_KEYS];

function layerLabel(layer: MapLayer) {
  return layer === "combined" ? "Score combine" : `${dimension(layer).mjslCode} · ${dimension(layer).label}`;
}

export function PdfMapExport() {
  const ids = useId();
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const activeLayer = useZoneStore((s) => s.layer);
  const viewport = useZoneStore((s) => s.viewport);
  const basemapId = useAppStore((s) => s.basemap);
  const setStatus = useAppStore((s) => s.setStatus);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MapLayer[]>([activeLayer]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const selectCurrent = () => setSelected([activeLayer]);
  const toggle = (layer: MapLayer) =>
    setSelected((current) => (current.includes(layer) ? current.filter((item) => item !== layer) : orderedLayers([...current, layer])));

  async function exportPdf() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const blob = await buildMapPdf(
        {
          layers: selected,
          bounds: viewport,
          basemapId,
          profileId,
          zones,
          scores: scores[profileId] ?? {},
        },
        (message) => setProgress(message),
      );
      downloadBlob(blob, `mjsl-cartes-${new Date().toISOString().slice(0, 10)}.pdf`);
      setStatus(`${selected.length} carte(s) exportee(s) en PDF.`);
      setOpen(false);
    } catch (error) {
      console.error(error);
      setStatus("Echec de l'export PDF. Verifie que le fond de carte est charge, puis reessaie.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!busy) setOpen(nextOpen); }}>
      <DialogTrigger
        render={
          <Button
            type="button"
            disabled={zones.length === 0}
            onClick={() => setSelected([activeLayer])}
          />
        }
      >
        <DownloadIcon data-icon="inline-start" />
        Cartes (PDF)
      </DialogTrigger>
      <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exporter des cartes PDF</DialogTitle>
          <DialogDescription>A4 paysage, une page par carte, sur la vue actuelle adaptee au format paysage.</DialogDescription>
        </DialogHeader>

        <FieldSet>
          <FieldLegend>Cartes a inclure</FieldLegend>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(ALL_LAYERS)} disabled={busy}>Tout selectionner</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected([])} disabled={busy}>Tout deselectionner</Button>
            <Button type="button" variant="outline" size="sm" onClick={selectCurrent} disabled={busy}>Couche active</Button>
          </div>
          <FieldGroup className="gap-2">
            {ALL_LAYERS.map((layer, index) => (
              <Field key={layer} orientation="horizontal">
                <Checkbox
                  id={`${ids}-${layer}`}
                  checked={selected.includes(layer)}
                  onCheckedChange={() => toggle(layer)}
                  disabled={busy}
                  autoFocus={index === 0}
                />
                <FieldLabel htmlFor={`${ids}-${layer}`}>{layerLabel(layer)}</FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>

        <p className="text-muted-foreground">
          Chaque page comprend le titre de l&apos;etude, une legende propre a la dimension, une echelle graphique, le nord et les sources.
          Les signalements et les indices OSM ne sont pas inclus.
        </p>
        <p className="empty:hidden text-sm font-medium" role="status">{progress}</p>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Annuler</DialogClose>
          <Button type="button" onClick={() => void exportPdf()} disabled={busy || selected.length === 0}>
            <DownloadIcon data-icon="inline-start" />
            {busy ? "Export en cours..." : `Exporter ${selected.length} carte(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
