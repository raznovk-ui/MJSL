import { useEffect, useId, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { buildMapPdf, centerOfBounds, orderedLayers, PDF_MAP_ANCHORS, PDF_ZOOM_LEVELS } from "../export/pdfMap.js";
import { downloadBlob } from "../export/download.js";
import { useAppStore } from "../state.js";
import { type MapLayer, useZoneStore } from "../zone/zoneStore.js";

const ALL_LAYERS: MapLayer[] = ["combined", ...DIMENSION_KEYS];

interface PdfPreview {
  blob: Blob;
  url: string;
}

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
  const [anchorId, setAnchorId] = useState("current");
  const [zoom, setZoom] = useState<number>(PDF_ZOOM_LEVELS[0].zoom);
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const selectCurrent = () => setSelected([activeLayer]);
  const toggle = (layer: MapLayer) =>
    setSelected((current) => (current.includes(layer) ? current.filter((item) => item !== layer) : orderedLayers([...current, layer])));

  const anchor = anchorId === "current" ? centerOfBounds(viewport) : PDF_MAP_ANCHORS.find((item) => item.id === anchorId)?.center ?? centerOfBounds(viewport);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function createPdf() {
    return buildMapPdf(
      {
        layers: selected,
        center: anchor,
        zoom,
        basemapId,
        profileId,
        zones,
        scores: scores[profileId] ?? {},
      },
      (message) => setProgress(message),
    );
  }

  async function previewPdf() {
    if (selected.length === 0) return;
    setBusy(true);
    setError("");
    setProgress("Preparation de l'apercu...");
    try {
      const blob = await createPdf();
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      console.error(error);
      const message = "L'apercu PDF n'a pas pu etre genere. Verifie la connexion au fond de carte, puis reessaie.";
      setError(message);
      setStatus(message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function exportPdf(blob = preview?.blob) {
    if (selected.length === 0) return;
    setBusy(true);
    setError("");
    try {
      downloadBlob(blob ?? await createPdf(), `mjsl-cartes-${new Date().toISOString().slice(0, 10)}.pdf`);
      setStatus(`${selected.length} carte(s) exportee(s) en PDF.`);
      setPreview(null);
      setOpen(false);
    } catch (error) {
      console.error(error);
      const message = "L'export PDF a echoue. Verifie que le fond de carte est charge, puis reessaie.";
      setError(message);
      setStatus(message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!busy) { setError(""); setPreview(null); setOpen(nextOpen); } }}>
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
      <DialogContent showCloseButton={!busy} className={preview ? "h-[calc(100dvh-2rem)] max-h-[52rem] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-6xl" : "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"}>
        {preview ? (
          <>
            <DialogHeader>
              <DialogTitle>Apercu avant export</DialogTitle>
              <DialogDescription>Voici le PDF exact qui sera telecharge. Verifie le cadrage, l&apos;echelle et la legende.</DialogDescription>
            </DialogHeader>
            <iframe title="Apercu du PDF exporte" src={preview.url} className="h-full min-h-0 w-full rounded-md border border-border bg-muted" />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(null)}>Modifier le cadrage</Button>
              <Button type="button" disabled={busy} onClick={() => void exportPdf(preview.blob)}>
                <DownloadIcon data-icon="inline-start" />
                Exporter ce PDF
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>Exporter des cartes PDF</DialogTitle>
          <DialogDescription>A4 paysage, une page par carte avec le meme cadrage geographique.</DialogDescription>
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

        <FieldSet>
          <FieldLegend>Cadrage de la carte</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${ids}-anchor`}>Point d&apos;ancrage</FieldLabel>
              <NativeSelect id={`${ids}-anchor`} value={anchorId} onChange={(event) => setAnchorId(event.target.value)} className="w-full" disabled={busy}>
                <NativeSelectOption value="current">Centre de la vue actuelle</NativeSelectOption>
                {PDF_MAP_ANCHORS.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-zoom`}>Niveau de detail</FieldLabel>
              <NativeSelect id={`${ids}-zoom`} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-full" disabled={busy}>
                {PDF_ZOOM_LEVELS.map((level) => (
                  <NativeSelectOption key={level.percent} value={level.zoom}>{level.percent} % · {level.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <p className="text-muted-foreground">Plus le pourcentage est eleve, plus la carte est rapprochee du point d&apos;ancrage. « Centre de la vue actuelle » reprend le centre de la carte apres deplacement.</p>
        </FieldSet>

        <p className="text-muted-foreground">
          Chaque page comprend le titre de l&apos;etude, une legende propre a la dimension, une echelle graphique, le nord et les sources.
          Les signalements et les indices OSM ne sont pas inclus.
        </p>
        <p className="empty:hidden text-sm font-medium" role="status">{progress}</p>
        {error ? <p className="text-sm font-medium text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Annuler</DialogClose>
          <Button type="button" variant="outline" onClick={() => void previewPdf()} disabled={busy || selected.length === 0}>
            {busy ? "Preparation..." : "Apercu"}
          </Button>
          <Button type="button" onClick={() => void exportPdf()} disabled={busy || selected.length === 0}>
            <DownloadIcon data-icon="inline-start" />
            {busy ? "Export en cours..." : `Exporter ${selected.length} carte(s)`}
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
