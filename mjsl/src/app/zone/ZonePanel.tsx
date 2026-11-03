import { useId, useMemo } from "react";
import { ZONE_CONFIG, type ValueSource } from "../../domain/zone/index.js";
import { SOURCE_LABEL } from "./labels.js";
import { useZoneStore } from "./zoneStore.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const { redBelow, orangeBelow, colours } = ZONE_CONFIG.classes;

/** The profile, the legend with the number of zones per class, and how much data each indicator has. */
export function ZonePanel() {
  const ids = useId();
  const loadState = useZoneStore((s) => s.loadState);
  const error = useZoneStore((s) => s.error);
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const reports = useZoneStore((s) => s.reports);
  const profileId = useZoneStore((s) => s.profileId);
  const visible = useZoneStore((s) => s.visible);
  const auto = useZoneStore((s) => s.auto);
  const load = useZoneStore((s) => s.load);
  const setProfile = useZoneStore((s) => s.setProfile);
  const toggleVisible = useZoneStore((s) => s.toggleVisible);

  const counts = useMemo(() => {
    const out = { red: 0, orange: 0, green: 0, none: 0 };
    for (const score of Object.values(scores[profileId] ?? {})) out[score.cls] += 1;
    return out;
  }, [scores, profileId]);

  // How many zones have each indicator, and from which source. The colours are only as
  // good as this: an indicator with no basis in the data is left out, never counted as 0.
  const coverage = useMemo(
    () =>
      Object.entries(ZONE_CONFIG.indicators).map(([key, c]) => {
        const bySource: Record<string, number> = {};
        let known = 0;
        for (const z of zones) {
          if (z.values[key] === undefined) continue;
          known += 1;
          const source = z.sources[key] ?? "osm";
          bySource[source] = (bySource[source] ?? 0) + 1;
        }
        const detail = (Object.keys(SOURCE_LABEL) as ValueSource[]).filter((s) => bySource[s]).map((s) => `${SOURCE_LABEL[s]} ${bySource[s]}`).join(", ");
        return { key, label: c.label, known, detail };
      }),
    [zones],
  );
  const loading = loadState === "loading";
  const slopeStatus =
    auto.slope === "running"
      ? `altitudes IGN en cours${auto.slopeProgress?.total ? ` (${auto.slopeProgress.done} / ${auto.slopeProgress.total} points)` : "..."}`
      : auto.slope === "done"
        ? "calculee a partir des altitudes IGN (grille de 200 m)"
        : auto.slope === "partial"
          ? "partielle (altitudes IGN incompletes)"
          : auto.slope === "error"
            ? `indisponible (${auto.slopeError ?? "erreur"})`
            : "en attente";

  return (
    <section aria-labelledby={`${ids}-h`}>
      <Card size="sm">
        <CardHeader>
          <CardTitle id={`${ids}-h`} role="heading" aria-level={2}>Explorer les zones</CardTitle>
          <CardDescription>Score d&apos;accessibilite par IRIS de Marseille.</CardDescription>
          <CardAction className="tabular-nums text-xs text-muted-foreground">{zones.length} IRIS</CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button type="button" variant="outline" className="w-full" onClick={() => void load({ forceRefresh: loadState === "ready" })} disabled={loading}>
            {loading ? "Chargement..." : loadState === "ready" ? "Rafraichir les donnees" : "Charger les zones"}
          </Button>
          {error && <p className="callout-warning">{error}</p>}

          {loadState === "ready" && (
            <>
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor={`${ids}-profile`}>Profil</FieldLabel>
                  <NativeSelect id={`${ids}-profile`} value={profileId} onChange={(e) => setProfile(e.target.value)} className="w-full">
                    {Object.entries(ZONE_CONFIG.profiles).map(([id, p]) => (
                      <NativeSelectOption key={id} value={id}>{p.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id={`${ids}-zones-visible`} checked={visible} onCheckedChange={() => toggleVisible()} />
                  <FieldContent>
                    <FieldLabel htmlFor={`${ids}-zones-visible`}>Afficher le score sur la carte</FieldLabel>
                    <FieldDescription>Masquez-le pour comparer avec le fond de carte.</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-border py-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: colours.red, outline: "2px dashed #7f1d1d", outlineOffset: -2 }} />Rouge</span><span className="tabular-nums text-muted-foreground">{counts.red}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: colours.orange }} />Orange</span><span className="tabular-nums text-muted-foreground">{counts.orange}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: colours.green }} />Vert</span><span className="tabular-nums text-muted-foreground">{counts.green}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: colours.none }} />Sans donnee</span><span className="tabular-nums text-muted-foreground">{counts.none}</span></div>
              </div>

              <Accordion>
                <AccordionItem value="sources">
                  <AccordionTrigger>Sources et couverture</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-3">
                      <p>IRIS de la Metropole, {reports.length} signalements d&apos;habitants, carte de bruit AMP et altitudes IGN.</p>
                      <p>Pente : {slopeStatus}.</p>
                      <div>
                        <p className="mb-1 font-medium text-foreground">Donnees disponibles par indicateur</p>
                        <ul className="flex flex-col gap-1 text-muted-foreground">
                          {coverage.map((c) => (
                            <li key={c.key}>{c.label} : {c.known} / {zones.length}{c.detail ? ` (${c.detail})` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
