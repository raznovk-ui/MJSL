import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension } from "../../domain/zone/index.js";
import { buildMapPdf, orderedLayers } from "../export/pdfMap.js";
import { downloadBlob } from "../export/download.js";
import { useAppStore } from "../state.js";
import { type MapLayer, useZoneStore } from "../zone/zoneStore.js";
import { IconDownload } from "./icons.js";

const ALL_LAYERS: MapLayer[] = ["combined", ...DIMENSION_KEYS];

function layerLabel(layer: MapLayer) {
  return layer === "combined" ? "Score combine" : `${dimension(layer).mjslCode} · ${dimension(layer).label}`;
}

export function PdfMapExport() {
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

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, open]);

  useEffect(() => {
    if (!open) return;
    // The dialog is portalled outside #root, letting inert block every control
    // behind it for both pointer and keyboard users.
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => root?.removeAttribute("inert");
  }, [open]);

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
    <>
      <button
        type="button"
        onClick={() => {
          setSelected([activeLayer]);
          setOpen(true);
        }}
        disabled={zones.length === 0}
        className="btn btn-primary"
      >
        <IconDownload />
        Cartes (PDF)
      </button>

      {open ? createPortal(
        <div className="modal-backdrop" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="pdf-export-title" className="modal-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pdf-export-title" className="text-base font-bold text-slate-900">Exporter des cartes PDF</h2>
                <p className="mt-1 text-sm text-slate-600">A4 paysage, une page par carte, sur la vue actuelle adaptee au format paysage.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-secondary btn-sm" aria-label="Fermer">
                Fermer
              </button>
            </div>

            <fieldset className="mt-5">
              <legend className="text-sm font-semibold text-slate-800">Cartes a inclure</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setSelected(ALL_LAYERS)} disabled={busy} className="btn btn-secondary btn-sm">Tout selectionner</button>
                <button type="button" onClick={() => setSelected([])} disabled={busy} className="btn btn-secondary btn-sm">Tout deselectionner</button>
                <button type="button" onClick={selectCurrent} disabled={busy} className="btn btn-secondary btn-sm">Couche active</button>
              </div>
              <div className="mt-3 space-y-2">
                {ALL_LAYERS.map((layer, index) => (
                  <label key={layer} className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={selected.includes(layer)}
                      onChange={() => toggle(layer)}
                      disabled={busy}
                      autoFocus={index === 0}
                    />
                    {layerLabel(layer)}
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="mt-4 text-xs text-slate-600">
              Chaque page comprend le titre de l&apos;etude, une legende propre a la dimension, une echelle graphique, le nord et les sources.
              Les signalements et les indices OSM ne sont pas inclus.
            </p>
            {progress ? <p className="mt-3 text-sm font-medium text-slate-700" role="status">{progress}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-secondary">Annuler</button>
              <button type="button" onClick={() => void exportPdf()} disabled={busy || selected.length === 0} className="btn btn-primary">
                <IconDownload />
                {busy ? "Export en cours..." : `Exporter ${selected.length} carte(s)`}
              </button>
            </div>
          </section>
        </div>
      , document.body) : null}
    </>
  );
}
