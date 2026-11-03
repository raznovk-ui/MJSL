import { useEffect, useState } from "react";
import { MapView } from "./map/MapView.js";
import { MapDataSettings } from "./components/MapDataSettings.js";
import { DataTable } from "./components/DataTable.js";
import { StatusBar } from "./components/StatusBar.js";
import { Dashboard } from "./components/Dashboard.js";
import { ZonePanel } from "./zone/ZonePanel.js";
import { ReportForm } from "./zone/ReportForm.js";
import { ZoneRanking } from "./zone/ZoneRanking.js";
import { ZoneInspector } from "./zone/ZoneInspector.js";
import { useZoneStore } from "./zone/zoneStore.js";
import { MapOverlayToggles } from "./components/MapOverlayToggles.js";
import { IconPin } from "./components/icons.js";
import { OVERPASS_PRESETS } from "./overpass/presets.js";
import { STUDY_AREA } from "./studyArea.js";
import { useAppStore } from "./state.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type View = "map" | "table" | "analysis";

export function App() {
  const fetchPreset = useAppStore((s) => s.fetchPreset);
  const [view, setView] = useState<View>("map");

  useEffect(() => {
    // Fired without awaiting: a slow Overpass query must never hold the UI.
    for (const preset of OVERPASS_PRESETS) void fetchPreset(preset.id);
    // The zones and their scores are computed with no input from anyone.
    void useZoneStore.getState().load();
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
              MJSL — accessibilite multi-dimensionnelle
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
            <ZonePanel />
            <ReportForm />
            <ZoneRanking />
            <ZoneInspector />
            <MapDataSettings />
            <section aria-labelledby="limites" className="card">
              <h2 id="limites" className="card-title">
                Limites
              </h2>
              <p className="text-xs text-slate-500">
                Tout est calcule automatiquement a partir de donnees ouvertes ; les seuils sont des valeurs de depart a verifier sur le terrain. Cet outil ne
                remplace pas la consultation des personnes handicapees et des habitants concernes.
              </p>
            </section>
          </div>
        </aside>

        <main id="contenu" className="flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0" style={{ background: "var(--surface-alt)" }}>
          <Tabs
            value={view}
            onValueChange={(value) => {
              if (value === "map" || value === "table" || value === "analysis") setView(value);
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <nav aria-label="Mode d'affichage" className="border-b border-border bg-background px-4 py-2">
              <TabsList variant="line" aria-label="Mode d'affichage">
                <TabsTrigger value="map">Carte</TabsTrigger>
                <TabsTrigger value="table">Tableau</TabsTrigger>
                <TabsTrigger value="analysis">Analyse</TabsTrigger>
              </TabsList>
            </nav>

            {/* The map stays mounted so MapLibre keeps its WebGL context. */}
            <TabsContent value="map" keepMounted className="relative min-h-0 min-w-0 flex-1 data-hidden:hidden">
              <MapView />
              <MapOverlayToggles />
            </TabsContent>
            <TabsContent value="table" keepMounted className="min-h-0 min-w-0 flex-1 overflow-y-auto data-hidden:hidden">
              <DataTable />
            </TabsContent>
            <TabsContent value="analysis" keepMounted className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 data-hidden:hidden">
              <Dashboard />
            </TabsContent>

            <StatusBar />
          </Tabs>
        </main>

      </div>
    </div>
  );
}
