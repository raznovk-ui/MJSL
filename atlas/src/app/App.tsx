import { useEffect, useState } from "react";
import { MapView } from "./map/MapView.js";
import { BasemapPicker } from "./components/BasemapPicker.js";
import { LayerPanel } from "./components/LayerPanel.js";
import { DataTable } from "./components/DataTable.js";
import { StatusBar } from "./components/StatusBar.js";
import { ImportWizard } from "./components/ImportWizard.js";
import { ObservationList } from "./components/ObservationList.js";
import { ObservationEditor } from "./components/ObservationEditor.js";
import { PhotoImport } from "./components/PhotoImport.js";
import { PhotoGallery } from "./components/PhotoGallery.js";
import { RuptureList } from "./components/RuptureList.js";
import { RuptureEditor } from "./components/RuptureEditor.js";
import { AnalysisPanel } from "./components/AnalysisPanel.js";
import { RedZoneList } from "./components/RedZoneList.js";
import { CellInspector } from "./components/CellInspector.js";
import { useScoring } from "./analysis/useScoring.js";
import { Dashboard } from "./components/Dashboard.js";
import { WalkwayPanel } from "./walkway/WalkwayPanel.js";
import { MapOverlayToggles } from "./components/MapOverlayToggles.js";
import { IconPin } from "./components/icons.js";
import { OVERPASS_PRESETS } from "./overpass/presets.js";
import { STUDY_AREA } from "./studyArea.js";
import { useAppStore } from "./state.js";

type View = "map" | "table" | "analysis";

export function App() {
  const fetchPreset = useAppStore((s) => s.fetchPreset);
  const loadStored = useAppStore((s) => s.loadStoredObservations);
  const loadStoredPhotos = useAppStore((s) => s.loadStoredPhotos);
  const loadStoredRuptures = useAppStore((s) => s.loadStoredRuptures);
  const selectedRuptureId = useAppStore((s) => s.selectedRuptureId);
  const selectedCell = useAppStore((s) => s.selectedCell);
  const selectedObservationId = useAppStore((s) => s.selectedObservationId);
  useScoring();
  const addPointMode = useAppStore((s) => s.addPointMode);
  const toggleAddPointMode = useAppStore((s) => s.toggleAddPointMode);
  const [view, setView] = useState<View>("map");
  // On Tableau/Analyse there is nothing to inspect unless something is
  // actively selected: showing an empty "fiche" panel there just steals width
  // from the dashboard and the table.
  const hasSelection = Boolean(selectedCell || selectedRuptureId || selectedObservationId);
  const showInspector = view === "map" || hasSelection;

  useEffect(() => {
    // Fired without awaiting: a slow Overpass query must never hold the UI.
    for (const preset of OVERPASS_PRESETS) void fetchPreset(preset.id);
    void loadStored();
    void loadStoredPhotos();
    void loadStoredRuptures();
  }, [fetchPreset, loadStored, loadStoredPhotos, loadStoredRuptures]);

  return (
    <div className="flex min-h-screen flex-col text-slate-900 lg:h-screen" style={{ background: "var(--surface-alt)" }}>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>

      <header className="px-4 py-3" style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ background: "var(--brand)" }}
            aria-hidden="true"
          >
            <IconPin className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--brand-dark)" }}>
              Matrice de Justice Spatiale Littorale
            </p>
            <h1 className="truncate text-lg font-bold leading-tight text-slate-900">
              Atlas d&apos;accessibilite multi-dimensionnelle
            </h1>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">{STUDY_AREA.name}</p>
      </header>

      {/* Stacks below lg so the page reflows at 320px without sideways scrolling
          (WCAG 1.4.10), which also makes it usable on a phone in the field. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className="w-full shrink-0 overflow-y-auto border-b border-[var(--line)] p-4 lg:w-80 lg:border-b-0 lg:border-r"
          style={{ background: "var(--surface-alt)" }}
          aria-label="Reglages des couches"
        >
          <div className="space-y-4">
            <section aria-labelledby="saisie" className="card">
              <h2 id="saisie" className="card-title">Saisie</h2>
              <button
                type="button"
                onClick={toggleAddPointMode}
                aria-pressed={addPointMode}
                className="btn btn-toggle btn-block"
              >
                <IconPin />
                {addPointMode ? "Clique sur la carte…" : "Ajouter un point"}
              </button>
            </section>
            <section aria-labelledby="import" className="card">
              <h2 id="import" className="card-title">Import</h2>
              <ImportWizard />
            </section>
            <AnalysisPanel />
            <WalkwayPanel />
            <RuptureList />
            <section aria-labelledby="photos" className="card">
              <h2 id="photos" className="card-title">Photos</h2>
              <PhotoImport />
              <div className="mt-2">
                <PhotoGallery />
              </div>
            </section>
            <ObservationList />
            <BasemapPicker />
            <LayerPanel />
            <section aria-labelledby="limites" className="card">
              <h2 id="limites" className="card-title">
                Limites
              </h2>
              <p className="text-xs text-slate-500">
                Les objets OSM sont des indices a verifier sur le terrain, pas des preuves. Cet outil ne
                remplace pas la consultation des personnes handicapees et des habitants concernes.
              </p>
            </section>
          </div>
        </aside>

        <main id="contenu" className="flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0" style={{ background: "var(--surface-alt)" }}>
          <nav aria-label="Mode d'affichage" className="px-4 py-2" style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
            <div role="tablist" className="tabbar">
              {(["map", "table", "analysis"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className="tab"
                >
                  {value === "map" ? "Carte" : value === "table" ? "Tableau" : "Analyse"}
                </button>
              ))}
            </div>
          </nav>

          {/* The map stays mounted so MapLibre keeps its WebGL context. */}
          <div className={`relative min-h-0 min-w-0 flex-1 ${view === "map" ? "" : "hidden"}`}>
            <MapView />
            <MapOverlayToggles />
          </div>
          <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${view === "table" ? "" : "hidden"}`}>
            <DataTable />
          </div>
          <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto p-4 ${view === "analysis" ? "" : "hidden"}`}>
            <div className="space-y-4">
              <Dashboard />
              <RedZoneList />
            </div>
          </div>

          <StatusBar />
        </main>

        {showInspector && (
          <aside
            className="w-full shrink-0 overflow-y-auto border-t border-[var(--line)] lg:w-80 lg:border-l lg:border-t-0"
            style={{ background: "var(--surface)" }}
            aria-label="Fiche d'observation"
          >
            {selectedCell ? (
              <CellInspector />
            ) : selectedRuptureId ? (
              <RuptureEditor />
            ) : (
              <ObservationEditor />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
