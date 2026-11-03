import { useEffect, useState } from "react";
import { MapPinIcon } from "lucide-react";
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
    <div className="flex min-h-screen flex-col bg-muted/30 text-foreground antialiased lg:h-screen">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>

      <header className="border-b border-border bg-background">
        <div className="flex min-w-0 items-center gap-3 px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
            <MapPinIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-balance">Matrice de Justice Spatiale Littorale</h1>
            <p className="truncate text-xs text-muted-foreground">Accessibilite multi-dimensionnelle - {STUDY_AREA.name}</p>
          </div>
        </div>
      </header>

      {/* Stacks below lg so the page reflows at 320px without sideways scrolling
          (WCAG 1.4.10), which also makes it usable on a phone in the field. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className="w-full shrink-0 overflow-y-auto border-b border-border bg-muted/20 p-4 lg:w-80 lg:border-b-0 lg:border-r"
          aria-label="Explorer Marseille"
        >
          <div className="flex flex-col gap-4">
            <ZonePanel />
            <ReportForm />
            <ZoneRanking />
            <ZoneInspector />
            <MapDataSettings />
            <p className="px-1 text-xs text-muted-foreground">
              Les seuils sont des valeurs de depart a verifier sur le terrain. Cet outil ne remplace pas la consultation des personnes handicapees et des habitants concernes.
            </p>
          </div>
        </aside>

        <main id="contenu" className="flex min-h-[70vh] min-w-0 flex-1 flex-col bg-muted/30 lg:min-h-0">
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
