import { useId, useState } from "react";
import { CrosshairIcon, MapPinPlusIcon, Trash2Icon } from "lucide-react";
import { REPORT_TYPE_OPTIONS } from "./reportStyle.js";
import { useZoneStore } from "./zoneStore.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * Lets a person add a citizen report from the map: switch the mode on, click the map, choose
 * the type, save. The report is counted in the zone it falls in, like the existing ones, and
 * the scores update. Reports are kept on this device only, and can be removed here.
 */
export function ReportForm() {
  const ids = useId();
  const loadState = useZoneStore((s) => s.loadState);
  const addMode = useZoneStore((s) => s.addMode);
  const pending = useZoneStore((s) => s.pending);
  const own = useZoneStore((s) => s.ownReports);
  const toggleAddMode = useZoneStore((s) => s.toggleAddMode);
  const locating = useZoneStore((s) => s.locating);
  const locateMe = useZoneStore((s) => s.locateMe);
  const target = useZoneStore((s) => s.target);
  const cancelPending = useZoneStore((s) => s.cancelPending);
  const saveOwnReport = useZoneStore((s) => s.saveOwnReport);
  const removeOwnReport = useZoneStore((s) => s.removeOwnReport);
  const [type, setType] = useState(REPORT_TYPE_OPTIONS[0]!);
  const ready = loadState === "ready";
  // Accuracy is shown only for a point that came from "Me localiser", not for a manual click.
  const accuracy = target && pending && target.lon === pending.lon && target.lat === pending.lat ? target.accuracyM : null;

  return (
    <section aria-labelledby={`${ids}-h`}>
      <Card size="sm">
        <CardHeader>
          <CardTitle id={`${ids}-h`} role="heading" aria-level={2}>Signaler un obstacle</CardTitle>
          <CardDescription>Le signalement compte dans le score de sa zone et reste sur cet appareil.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button type="button" variant="secondary" className="w-full" onClick={() => void locateMe()} disabled={!ready || locating}>
            <CrosshairIcon data-icon="inline-start" />
            {locating ? "Localisation…" : "Utiliser ma position"}
          </Button>
          <Button type="button" variant={addMode ? "default" : "outline"} className="w-full" aria-pressed={addMode} disabled={!ready} onClick={toggleAddMode}>
            <MapPinPlusIcon data-icon="inline-start" />
            {addMode ? "Cliquez sur la carte…" : "Placer un point sur la carte"}
          </Button>

          {pending && (
            <div className="rounded-md bg-muted p-3">
              <p className="mb-3 font-medium" role="status">Point place{accuracy !== null ? ` (precision ± ${accuracy} m)` : ""}.</p>
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor={`${ids}-type`}>Type de signalement</FieldLabel>
                  <NativeSelect id={`${ids}-type`} value={type} onChange={(e) => setType(e.target.value)} className="w-full">
                    {REPORT_TYPE_OPTIONS.map((option) => (
                      <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void saveOwnReport(type)}>Enregistrer</Button>
                  <Button type="button" variant="outline" onClick={cancelPending}>Annuler</Button>
                </div>
              </FieldGroup>
            </div>
          )}
        </CardContent>

        {own.length > 0 && (
          <CardFooter className="flex-col items-stretch gap-2 border-t">
            <p className="font-medium">Sur cet appareil <span className="tabular-nums text-muted-foreground">({own.length})</span></p>
            <ul className="flex flex-col gap-2">
              {own.map((r) => {
                const date = new Date(r.addedAt).toLocaleDateString("fr-FR");
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">{r.type} · {date}</span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={() => void removeOwnReport(r.id)}
                      aria-label={`Supprimer le signalement « ${r.type} » du ${date}`}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Supprimer
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
