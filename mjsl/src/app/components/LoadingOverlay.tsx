import { useEffect, useState } from "react";
import { Waves, Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { useZoneStore } from "../zone/zoneStore.js";
import { useAppStore } from "../state.js";
import { Button } from "@/components/ui/button";

const INSIGHTS = [
  "Analyse de 94 000+ aménagements piétons (trottoirs, passages, rampes, bancs) sur Marseille.",
  "Calcul en direct de l'accessibilité selon 4 profils : moteur, visuel, auditif et cognitif.",
  "Intégration du modèle altimétrique IGN et de la cartographie acoustique métropolitaine.",
  "Cartographie citoyenne : chaque signalement d'obstacle actualise instantanément les indices.",
];

export function LoadingOverlay() {
  const loadState = useZoneStore((s) => s.loadState);
  const loadProgress = useZoneStore((s) => s.loadProgress);
  const error = useZoneStore((s) => s.error);
  const load = useZoneStore((s) => s.load);
  const status = useAppStore((s) => s.status);

  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);

  // Cycle tips every 2.8 seconds to entertain/distract during load
  useEffect(() => {
    const timer = setInterval(() => {
      setInsightIndex((i) => (i + 1) % INSIGHTS.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  // Smooth fade-out when loading completes
  useEffect(() => {
    if (loadState === "ready") {
      setFading(true);
      const timeout = setTimeout(() => {
        setVisible(false);
      }, 500);
      return () => clearTimeout(timeout);
    } else {
      setVisible(true);
      setFading(false);
    }
  }, [loadState]);

  if (!visible) return null;

  // Calculate percentage
  let percent = 0;
  if (loadProgress && loadProgress.total > 0) {
    percent = Math.min(100, Math.round((loadProgress.done / loadProgress.total) * 100));
  } else if (loadState === "ready") {
    percent = 100;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chargement de l'application"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md transition-all duration-500 ease-out ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="relative mx-4 flex w-full max-w-md flex-col items-center overflow-hidden rounded-2xl border border-border/80 bg-card/95 p-6 text-center shadow-2xl backdrop-blur-xl sm:p-8">
        {/* Soft background ambient gradient glows */}
        <div className="pointer-events-none absolute -top-20 -left-20 size-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 size-44 rounded-full bg-primary/10 blur-3xl" />

        {/* Brand spinner / animated icon */}
        <div className="relative mb-4 flex size-20 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping opacity-40" />
          <div className="size-20 rounded-full border-4 border-muted border-t-primary border-r-primary/60 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-primary">
            <Waves className="size-8 animate-pulse" />
          </div>
        </div>

        {/* Title & subtitle */}
        <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
          Matrice de Justice Spatiale Littorale
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Marseille · Accessibilité & Équité Territoriale
        </p>

        {/* Error state */}
        {error ? (
          <div className="mt-5 flex w-full flex-col items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="mt-2 gap-2"
              onClick={() => void load({ forceRefresh: true })}
            >
              <RefreshCw className="size-3.5" />
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            {/* Progress Bar & Status */}
            <div className="mt-6 w-full space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate pr-2 font-medium text-foreground/90">
                  {status || "Initialisation des données..."}
                </span>
                <span className="shrink-0 tabular-nums font-semibold">{percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* Distraction: Didactic insights carousel */}
            <div className="mt-5 flex w-full items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-left text-xs text-muted-foreground">
              <Sparkles className="size-4 shrink-0 text-primary mt-0.5" />
              <p className="min-h-9 transition-all duration-300 leading-relaxed">
                {INSIGHTS[insightIndex]}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

