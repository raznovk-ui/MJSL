import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ZONE_CONFIG, DIMENSION_KEYS, dimension as meta, dimensionScoreOf } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { shortArrondissement } from "../zone/labels.js";
import { useZoneStore } from "../zone/zoneStore.js";

const PAGE = 50;

/**
 * The non-map view the accessibility requirement calls for: every zone, its score and
 * its six dimension scores, reachable without a pointer or a visual channel.
 */
export function DataTable() {
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const select = useZoneStore((s) => s.selectZone);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("fr-FR"));

  const rows = useMemo(
    () =>
      zones
        .map((zone) => ({ zone, score: scores[profileId]?.[zone.id] }))
        .sort((a, b) => (a.score?.score ?? 2) - (b.score?.score ?? 2)),
    [zones, scores, profileId],
  );
  const filteredRows = useMemo(
    () =>
      deferredQuery
        ? rows.filter(({ zone }) => `${zone.name} ${shortArrondissement(zone)}`.toLocaleLowerCase("fr-FR").includes(deferredQuery))
        : rows,
    [deferredQuery, rows],
  );

  useEffect(() => setLimit(PAGE), [deferredQuery, profileId]);

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">Aucune zone chargee pour l&apos;instant.</CardContent>
        </Card>
      </div>
    );
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Toutes les zones</CardTitle>
          <CardDescription>{rows.length} zones classees de la plus basse a la plus haute pour le profil « {ZONE_CONFIG.profiles[profileId]?.label ?? profileId} ».</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="zone-search">Rechercher une zone</FieldLabel>
            <Input id="zone-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom ou arrondissement" />
          </Field>
          <p className="text-muted-foreground" role="status">{filteredRows.length} zone{filteredRows.length > 1 ? "s" : ""} correspondante{filteredRows.length > 1 ? "s" : ""}.</p>

          {filteredRows.length === 0 ? (
            <p className="rounded-md bg-muted p-3 text-muted-foreground">Aucune zone ne correspond a cette recherche.</p>
          ) : (
            <Table className="min-w-[900px]">
              <TableCaption className="sr-only">Scores par zone et par dimension</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Zone</TableHead>
                  <TableHead scope="col">Arrondissement</TableHead>
                  <TableHead scope="col">Score</TableHead>
                  {DIMENSION_KEYS.map((dimension) => (
                    <TableHead key={dimension} scope="col">{meta(dimension).mjslCode}</TableHead>
                  ))}
                  <TableHead scope="col">Calcul</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.slice(0, limit).map(({ zone, score }) => (
                  <TableRow key={zone.id}>
                    <th scope="row" className="p-2 text-left font-medium whitespace-nowrap">{zone.name}</th>
                    <TableCell className="text-muted-foreground">{shortArrondissement(zone)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(score?.score)}</TableCell>
                    {DIMENSION_KEYS.map((dimension) => (
                      <TableCell key={dimension} className="tabular-nums text-muted-foreground">{fmt(dimensionScoreOf(score, dimension))}</TableCell>
                    ))}
                    <TableCell><Button type="button" variant="outline" size="xs" onClick={() => select(zone.id)}>Voir</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {limit < filteredRows.length && (
            <Button type="button" variant="outline" className="self-start" onClick={() => setLimit((current) => current + PAGE)}>
              Afficher {Math.min(PAGE, filteredRows.length - limit)} zones de plus
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
