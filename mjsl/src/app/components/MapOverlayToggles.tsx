import { useId } from "react";
import { Layers3Icon } from "lucide-react";
import { DIMENSION_KEYS, ZONE_CONFIG, dimension as meta, reportKind } from "../../domain/zone/index.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { OSM_KINDS, OSM_STYLE } from "../map/osmStyle.js";
import { useAppStore } from "../state.js";
import { GRADIENT } from "../zone/zoneLayers.js";
import { useZoneStore } from "../zone/zoneStore.js";
import { REPORT_KINDS, REPORT_STYLE, SHAPE_PATH } from "../zone/reportStyle.js";

const PERSONA: Record<string, string> = {
  physical: "mobilite reduite",
  sensory: "malvoyant.e / neurodivergent.e",
  cognitive: "allophone",
  economic: "faibles revenus",
  socio_cultural: "co-presence",
  political: "co-participation",
};

/** Map overlays are kept close to the map, but stay out of the way until requested. */
export function MapOverlayToggles() {
  const ids = useId();
  const presets = useAppStore((s) => s.presets);
  const visible = useZoneStore((s) => s.visible);
  const reportsVisible = useZoneStore((s) => s.reportsVisible);
  const zoneCount = useZoneStore((s) => s.zones.length);
  const layer = useZoneStore((s) => s.layer);
  const reportKinds = useZoneStore((s) => s.reportKinds);
  const reports = useZoneStore((s) => s.reports);
  const setLayer = useZoneStore((s) => s.setLayer);

  const osmVisible = Object.values(presets).some((preset) => preset.visible);
  const allHidden = !visible && !osmVisible && !reportsVisible;
  const layerOptions = [
    ["combined", "Score combine (profil choisi)"],
    ...DIMENSION_KEYS.map((key) => [key, `${meta(key).mjslCode} ${meta(key).label} — ${PERSONA[key]}`]),
  ] as const;

  const setOsm = (nextVisible: boolean) =>
    useAppStore.setState((state) => ({
      presets: Object.fromEntries(Object.entries(state.presets).map(([id, preset]) => [id, { ...preset, visible: nextVisible }])),
    }));

  const setAll = (nextVisible: boolean) => {
    setOsm(nextVisible);
    useZoneStore.setState({ visible: nextVisible, reportsVisible: nextVisible && reportsVisible });
  };

  return (
    <div className="absolute top-3 left-3 z-10">
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="outline" className="bg-background/95 shadow-sm backdrop-blur" />}>
          <Layers3Icon data-icon="inline-start" />
          Calques
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3">
          <PopoverHeader>
            <PopoverTitle>Calques de la carte</PopoverTitle>
            <PopoverDescription>Choisissez le score et les informations affichees.</PopoverDescription>
          </PopoverHeader>

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${ids}-layer`}>Couche affichee</FieldLabel>
              <NativeSelect id={`${ids}-layer`} value={layer} onChange={(event) => setLayer(event.target.value as typeof layer)} className="w-full">
                {layerOptions.map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>
                ))}
              </NativeSelect>
              <div>
                <div className="h-2 rounded-sm" aria-hidden="true" style={{ background: `linear-gradient(to right, ${GRADIENT.map(([value, colour]) => `${colour} ${value * 100}%`).join(", ")})` }} />
                <div className="mt-1 flex justify-between gap-2 text-muted-foreground"><span>Obstacles</span><span>Peu d&apos;obstacles</span></div>
              </div>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Afficher</FieldLegend>
              <FieldGroup className="gap-3">
                <Field orientation="horizontal" data-disabled={zoneCount === 0 || undefined}>
                  <Checkbox id={`${ids}-zones`} checked={visible && zoneCount > 0} disabled={zoneCount === 0} onCheckedChange={() => useZoneStore.getState().toggleVisible()} />
                  <FieldContent>
                    <FieldLabel htmlFor={`${ids}-zones`}>Scores par zone</FieldLabel>
                    {zoneCount === 0 && <FieldDescription>Calcul en cours.</FieldDescription>}
                  </FieldContent>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id={`${ids}-reports`} checked={reportsVisible} onCheckedChange={() => useZoneStore.getState().toggleReports()} />
                  <FieldLabel htmlFor={`${ids}-reports`}>Signalements des habitants</FieldLabel>
                </Field>
                {reportsVisible && (
                  <Accordion>
                    <AccordionItem value="report-kinds">
                      <AccordionTrigger>Filtrer les types de signalement</AccordionTrigger>
                      <AccordionContent>
                        <FieldGroup className="gap-3">
                          {REPORT_KINDS.map((kind) => {
                            const style = REPORT_STYLE[kind];
                            const count = reports.filter((report) => reportKind(report.type, ZONE_CONFIG) === kind).length;
                            return (
                              <Field key={kind} orientation="horizontal">
                                <Checkbox id={`${ids}-${kind}`} checked={reportKinds[kind]} onCheckedChange={() => useZoneStore.getState().toggleReportKind(kind)} />
                                <FieldContent>
                                  <FieldLabel htmlFor={`${ids}-${kind}`} className="items-center">
                                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="shrink-0">
                                      <path d={SHAPE_PATH[style.shape]} fill={style.colour} stroke="#111827" strokeWidth="1" strokeLinejoin="round" />
                                    </svg>
                                    {style.label} <span className="tabular-nums text-muted-foreground">({count})</span>
                                  </FieldLabel>
                                  {style.feeds && <FieldDescription>Alimente {style.feeds}</FieldDescription>}
                                </FieldContent>
                              </Field>
                            );
                          })}
                        </FieldGroup>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
                <Field orientation="horizontal">
                  <Checkbox id={`${ids}-osm`} checked={osmVisible} onCheckedChange={(checked) => setOsm(checked)} />
                  <FieldLabel htmlFor={`${ids}-osm`}>Indices OpenStreetMap</FieldLabel>
                </Field>
                {osmVisible && (
                  <Accordion>
                    <AccordionItem value="osm-symbols">
                      <AccordionTrigger>Voir les symboles OSM</AccordionTrigger>
                      <AccordionContent>
                        <ul className="flex flex-col gap-2">
                          {OSM_KINDS.map((kind) => {
                            const style = OSM_STYLE[kind];
                            return (
                              <li key={kind} className="flex items-center gap-2 text-muted-foreground">
                                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="shrink-0">
                                  <path d={style.glyph.d} fill={style.colour} fillRule={style.glyph.fillRule ?? "nonzero"} />
                                </svg>
                                {style.label}
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </FieldGroup>
            </FieldSet>
          </FieldGroup>

          <Button type="button" variant="outline" className="w-full" onClick={() => setAll(allHidden)}>
            {allHidden ? "Tout afficher" : "Carte seule"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
