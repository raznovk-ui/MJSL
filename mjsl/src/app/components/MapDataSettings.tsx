import { useId } from "react";
import { BASEMAPS } from "../map/basemaps.js";
import { ageLabel } from "../overpass/cache.js";
import { OVERPASS_PRESETS } from "../overpass/presets.js";
import { useAppStore } from "../state.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Secondary map presentation and OpenStreetMap source controls. */
export function MapDataSettings() {
  const ids = useId();
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const presets = useAppStore((s) => s.presets);
  const togglePreset = useAppStore((s) => s.togglePreset);
  const fetchPreset = useAppStore((s) => s.fetchPreset);
  const currentBasemap = BASEMAPS.find((option) => option.id === basemap) ?? BASEMAPS[0]!;

  return (
    <section aria-labelledby={`${ids}-h`}>
      <Card size="sm">
        <CardHeader>
          <CardTitle id={`${ids}-h`} role="heading" aria-level={2}>Fond et donnees</CardTitle>
          <CardDescription>Reglages secondaires de la carte.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion>
            <AccordionItem value="basemap">
              <AccordionTrigger>
                <span>Fond de carte <span className="font-normal text-muted-foreground">· {currentBasemap.label}</span></span>
              </AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor={`${ids}-basemap`}>Fond de carte</FieldLabel>
                    <NativeSelect id={`${ids}-basemap`} value={basemap} onChange={(event) => setBasemap(event.target.value)} className="w-full">
                      {BASEMAPS.map((option) => (
                        <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{currentBasemap.description}</FieldDescription>
                  </Field>
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="osm">
              <AccordionTrigger>Indices OpenStreetMap</AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="gap-4">
                  {OVERPASS_PRESETS.map((preset) => {
                    const layer = presets[preset.id]!;
                    const status =
                      layer.state === "loading"
                        ? "Chargement..."
                        : layer.state === "ready"
                          ? `${layer.geojson?.features.length ?? 0} objets${layer.timestamp ? ` · ${layer.fromCache ? `cache du ${ageLabel(layer.timestamp)}` : "Overpass"}` : ""}`
                          : layer.state === "error"
                            ? `Erreur : ${layer.error}`
                            : "Non charge.";
                    return (
                      <div key={preset.id} className="flex flex-col gap-2">
                        <Field orientation="horizontal">
                          <Checkbox id={`${ids}-${preset.id}`} checked={layer.visible} onCheckedChange={() => togglePreset(preset.id)} />
                          <FieldContent>
                            <FieldLabel htmlFor={`${ids}-${preset.id}`}>{preset.label}</FieldLabel>
                            <FieldDescription>{preset.description}</FieldDescription>
                          </FieldContent>
                        </Field>
                        <p className={layer.state === "error" ? "text-destructive" : "text-muted-foreground"}>{status}</p>
                        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => fetchPreset(preset.id, { forceRefresh: true })} disabled={layer.state === "loading"}>
                          Rafraichir depuis Overpass
                        </Button>
                      </div>
                    );
                  })}
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </section>
  );
}
