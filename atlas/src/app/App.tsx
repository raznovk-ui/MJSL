import { useEffect, useState } from "react";
import { MapView } from "./map/MapView.js";
import { BasemapPicker } from "./components/BasemapPicker.js";
import { LayerPanel } from "./components/LayerPanel.js";
import { DataTable } from "./components/DataTable.js";
import { StatusBar } from "./components/StatusBar.js";
import { Dashboard } from "./components/Dashboard.js";
import { WalkwayPanel } from "./walkway/WalkwayPanel.js";
import { ZoneList } from "./walkway/ZoneList.js";
import { SegmentInspector } from "./walkway/SegmentInspector.js";
import { useWalkwayStore } from "./walkway/walkwayStore.js";
import { MapOverlayToggles } from "./components/MapOverlayToggles.js";
import { IconPin } from "./components/icons.js";
import { OVERPASS_PRESETS } from "./overpass/presets.js";
import { STUDY_AREA } from "./studyArea.js";
import { useAppStore } from "./state.js";

type View = "map" | "table" | "analysis";

export function App() {
  const fetchPreset = useAppStore((s) => s.fetchPreset);
  const [view, setView] = useState<View>("map");

  useEffect(() => {
    // Fired without awaiting: a slow Overpass query must never hold the UI.
    for (const preset of OVERPASS_PRESETS) void fetchPreset(preset.id);
    // The walkway scores and zones are computed with no input from anyone.
    void useWalkwayStore.getState().load();
  }, [fetchPreset]);

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
            <WalkwayPanel />
            <ZoneList />
            <SegmentInspector />
            <BasemapPicker />
            <LayerPanel />
            <section aria-labelledby="limites" className="card">
              <h2 id="limites" className="card-title">
                Limites
              </h2>
              <p className="text-xs text-slate-500">
                Tout est calcule automatiquement a partir de donnees ouvertes ; les valeurs estimees sont des hypotheses a verifier sur le terrain. Cet outil ne
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
            <Dashboard />
          </div>

          <StatusBar />
        </main>

      </div>
    </div>
  );
}
