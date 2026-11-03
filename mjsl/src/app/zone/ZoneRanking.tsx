import { ZONE_CONFIG } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { shortArrondissement } from "./labels.js";
import { useZoneStore } from "./zoneStore.js";

/** The zones with the lowest score for the chosen profile, worst first. */
export function ZoneRanking() {
  const ranking = useZoneStore((s) => s.ranking);
  const loadState = useZoneStore((s) => s.loadState);
  const profileId = useZoneStore((s) => s.profileId);
  const selected = useZoneStore((s) => s.selectedZoneId);
  const select = useZoneStore((s) => s.selectZone);
  const profile = ZONE_CONFIG.profiles[profileId];
  const top = ranking.slice(0, Math.min(5, ZONE_CONFIG.ranking.topN));

  return (
    <section aria-labelledby="zones-title">
      <Card size="sm">
        <CardHeader>
          <CardTitle id="zones-title" role="heading" aria-level={2}>Zones prioritaires</CardTitle>
          <CardDescription>Les scores les plus bas pour le profil « {profile?.label ?? profileId} ».</CardDescription>
          <CardAction className="tabular-nums text-xs text-muted-foreground">{ranking.length}</CardAction>
        </CardHeader>
        <CardContent>
          {loadState !== "ready" ? (
            <p className="text-muted-foreground">{loadState === "error" ? "Calcul impossible." : "Calcul en cours..."}</p>
          ) : top.length === 0 ? (
            <p className="text-muted-foreground">Aucune zone notee.</p>
          ) : (
            <ol className="divide-y divide-border">
              {top.map((r) => (
                <li key={r.zone.id}>
                  <Button
                    type="button"
                    variant={selected === r.zone.id ? "secondary" : "ghost"}
                    className="h-auto w-full flex-col items-start whitespace-normal px-0 py-2 text-left hover:bg-transparent"
                    onClick={() => select(selected === r.zone.id ? null : r.zone.id)}
                    aria-pressed={selected === r.zone.id}
                  >
                    <span className="font-medium">#{r.rank} · {r.zone.name} <span className="font-normal text-muted-foreground">({shortArrondissement(r.zone)})</span></span>
                    <span className="text-muted-foreground">{r.summary}</span>
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
        {ranking.length > top.length && (
          <CardFooter className="border-t text-muted-foreground">Top {top.length} sur {ranking.length}. Liste complete dans l&apos;onglet Tableau.</CardFooter>
        )}
      </Card>
    </section>
  );
}
