import { DIMENSIONS, ZONE_CONFIG, dimensionScores } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DimensionBars } from "./DimensionBars.js";
import { SOURCE_LABEL, shortArrondissement } from "./labels.js";
import { useZoneStore } from "./zoneStore.js";

/** Shows every step behind a selected zone's score without permanently occupying the sidebar. */
export function ZoneInspector() {
  const id = useZoneStore((s) => s.selectedZoneId);
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const select = useZoneStore((s) => s.selectZone);
  const zone = zones.find((z) => z.id === id);
  const score = id ? scores[profileId]?.[id] : undefined;
  const profile = ZONE_CONFIG.profiles[profileId];

  if (!zone || !score || !profile) return null;

  const rentLevel = zone.counts.rentLevel;
  const rentMonthly = zone.counts.rentMonthly;
  const rentZone = zone.counts.rentZone;
  const rentPlr = zone.counts.rentPlr;
  const rentAsking = zone.counts.rentAsking;
  const rentBurden = zone.values.rentBurden;
  const publicSpaceShare = zone.values.publicSpaceShare;
  const publicSpaceLow = zone.counts.publicSpaceLow;
  const num = (v: number | undefined, digits = 1) => (v === undefined ? "—" : v.toFixed(digits));

  return (
    <Sheet open onOpenChange={(open) => { if (!open) select(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" showCloseButton={false}>
        <SheetHeader className="border-b pr-14">
          <SheetTitle>{zone.name}</SheetTitle>
          <SheetDescription>
            {shortArrondissement(zone)} · {zone.zoneType !== "habitat" ? `zone ${zone.zoneType === "activite" ? "d'activite" : "diverse"} · ` : ""}{zone.areaKm2.toFixed(2)} km² · {zone.streetKm.toFixed(1)} km de rue
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-6">
          <section>
            <h3 className="mb-2 text-xs font-medium">Signalements d&apos;habitants</h3>
            <p className="text-muted-foreground">
              Stationnement {zone.counts.reportsParking ?? 0} · trottoir / poteau {zone.counts.reportsNarrow ?? 0} · chantier / encombrants {zone.counts.reportsWorks ?? 0} · terrasses / mobilier {zone.counts.reportsFurniture ?? 0}.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium">Loyer et espaces publics</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-muted-foreground">
              <dt>Loyer médian observé (OLL 2025)</dt>
              <dd className="text-right tabular-nums">{rentLevel === undefined ? "pas de donnee" : `${num(rentLevel, 1)} €/m²`}</dd>
              <dt>Loyer mensuel médian</dt>
              <dd className="text-right tabular-nums">{rentMonthly === undefined ? "pas de donnee" : `${Math.round(rentMonthly)} €`}</dd>
              <dt>Taux d&apos;effort</dt>
              <dd className="text-right tabular-nums">{rentBurden === undefined ? "pas de donnee" : `${num(rentBurden, 1)} % du revenu`}</dd>
              <dt>Loyer d&apos;annonce (arrondissement)</dt>
              <dd className="text-right tabular-nums">{rentAsking === undefined ? "pas de donnee" : `${num(rentAsking, 1)} €/m²`}</dd>
              <dt>Espaces publics (UN-Habitat 11.7.1)</dt>
              <dd className="text-right tabular-nums">{publicSpaceShare === undefined ? "pas de donnee" : `${num(publicSpaceShare * 100, 1)} % de la surface bâtie`}</dd>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {rentZone ? `Zone OLL ${rentZone}` : "Loyer non disponible"} · {rentPlr === 1 ? "parc locatif restreint" : rentPlr === 0 ? "parc locatif suffisant" : "qualite inconnue"}.
              {publicSpaceLow === 1 ? " Espaces publics : échantillon bâti trop faible." : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Sources : OLL 13 / ADIL13 2025, INSEE FiLoSoFi 2021, Carte des loyers 2025, OpenStreetMap.</p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium">Score par dimension</h3>
            <p className="mb-3 text-muted-foreground">0 = obstacle total, 1 = aucun obstacle.</p>
            <DimensionBars scores={dimensionScores([zone], { [zone.id]: score })} />
          </section>

          <section className="overflow-x-auto">
            <h3 className="mb-2 text-xs font-medium">1. Valeur vers obstacle</h3>
            <table className="w-full min-w-[38rem] border-collapse text-left">
              <caption className="sr-only">Valeur, source, regle et obstacle par indicateur</caption>
              <thead className="border-y border-border text-muted-foreground"><tr><th scope="col" className="py-2 font-medium">Indicateur</th><th scope="col" className="py-2 font-medium">Valeur</th><th scope="col" className="py-2 font-medium">Source</th><th scope="col" className="py-2 font-medium">Regle</th><th scope="col" className="py-2 font-medium">Obstacle</th></tr></thead>
              <tbody>
                {score.barriers.map((b) => {
                  const c = ZONE_CONFIG.indicators[b.indicator]!;
                  const v = zone.values[b.indicator];
                  return (
                    <tr key={b.indicator} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 font-medium">{c.label}</th>
                      <td className="py-2 pr-3 tabular-nums">{v === undefined ? "—" : `${Number(v.toFixed(2))} ${c.unit}`}</td>
                      <td className="py-2 pr-3">{b.source ? SOURCE_LABEL[b.source] : "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.kind === "share" ? "deja un obstacle (0 a 1)" : `${c.kind === "evidence" ? "s'ajoute aux autres : " : ""}0 a ${c.noProblemAt}, 1 a ${c.totalObstacleAt}`}</td>
                      <td className="py-2 tabular-nums">{b.barrier === null ? "pas de donnee" : b.barrier.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto">
            <h3 className="mb-2 text-xs font-medium">2. Profil « {profile.label} »</h3>
            <table className="w-full min-w-[30rem] border-collapse text-left">
              <caption className="sr-only">Moyenne par dimension, poids et facteur du profil selectionne</caption>
              <thead className="border-y border-border text-muted-foreground"><tr><th scope="col" className="py-2 font-medium">Dimension</th><th scope="col" className="py-2 font-medium">Obstacle moyen</th><th scope="col" className="py-2 font-medium">Poids</th><th scope="col" className="py-2 font-medium">Facteur</th></tr></thead>
              <tbody>
                {DIMENSIONS.filter((d) => (profile.weights[d.key] ?? 0) > 0).map((d) => {
                  const b = score.dimensionBarriers[d.key];
                  const w = profile.weights[d.key]!;
                  const sum = DIMENSIONS.reduce((t, x) => t + (score.dimensionBarriers[x.key] !== undefined ? profile.weights[x.key] ?? 0 : 0), 0);
                  const capped = b === undefined ? undefined : Math.min(b, ZONE_CONFIG.scoring.dimensionBarrierCap);
                  return (
                    <tr key={d.key} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 font-medium">{d.label}</th>
                      <td className="py-2 pr-3 tabular-nums">{b === undefined ? "pas de donnee (ignoree)" : b.toFixed(2) + (capped !== b ? ` (plafonne a ${capped!.toFixed(2)})` : "")}</td>
                      <td className="py-2 pr-3 tabular-nums">{w}</td>
                      <td className="py-2 tabular-nums">{capped === undefined ? "—" : Math.pow(1 - capped, w / sum).toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="rounded-md bg-muted p-3">
            <h3 className="mb-1 text-xs font-medium">3. Resultat</h3>
            <p>{score.score === null ? "Pas assez de donnees pour noter." : `Produit des facteurs = ${score.score.toFixed(3)} (${score.cls === "red" ? "rouge" : score.cls === "orange" ? "orange" : "vert"}).`}</p>
            <p className="mt-2 text-muted-foreground">Seuils : rouge sous {ZONE_CONFIG.classes.redBelow}, orange sous {ZONE_CONFIG.classes.orangeBelow}.</p>
          </section>
        </div>

        <SheetFooter className="border-t">
          <SheetClose render={<Button type="button" variant="outline" className="w-full" />}>Fermer le calcul</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
