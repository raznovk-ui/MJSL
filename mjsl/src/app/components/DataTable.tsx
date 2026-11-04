import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ZONE_CONFIG, DIMENSION_KEYS, dimension as meta, dimensionScoreOf } from "../../domain/zone/index.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { shortArrondissement } from "../zone/labels.js";
import { useZoneStore } from "../zone/zoneStore.js";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [20, 25, 50];

/**
 * The non-map view the accessibility requirement calls for: every zone, its score and
 * its six dimension scores, reachable without a pointer or a visual channel.
 */
export function DataTable() {
  const zones = useZoneStore((s) => s.zones);
  const scores = useZoneStore((s) => s.scores);
  const profileId = useZoneStore((s) => s.profileId);
  const select = useZoneStore((s) => s.selectZone);

  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
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

  useEffect(() => setLimit(pageSize), [deferredQuery, profileId, pageSize]);

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">Aucune zone chargée pour l&apos;instant.</CardContent>
        </Card>
      </div>
    );
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));
  const currentCount = Math.min(limit, filteredRows.length);

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Toutes les zones</CardTitle>
          <CardDescription>
            {rows.length} zones classées de la plus basse à la plus haute pour le profil « {ZONE_CONFIG.profiles[profileId]?.label ?? profileId} ».
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Field className="flex-1 max-w-md">
              <FieldLabel htmlFor="zone-search">Rechercher une zone</FieldLabel>
              <Input
                id="zone-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nom ou arrondissement"
              />
            </Field>

            <div className="flex items-center gap-2 self-start sm:self-end">
              <label htmlFor="page-size-select" className="text-xs text-muted-foreground whitespace-nowrap">
                Par page :
              </label>
              <NativeSelect
                id="page-size-select"
                size="sm"
                value={pageSize}
                onChange={(e) => {
                  const nextSize = Number(e.target.value);
                  setPageSize(nextSize);
                  setLimit(nextSize);
                }}
                className="w-20"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <NativeSelectOption key={size} value={size}>
                    {size}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground" role="status">
            <span>
              {filteredRows.length === 0
                ? "Aucune zone correspondante."
                : `Affichage de 1 à ${currentCount} sur ${filteredRows.length} zone${filteredRows.length > 1 ? "s" : ""}.`}
            </span>
          </div>

          {filteredRows.length === 0 ? (
            <p className="rounded-md bg-muted p-3 text-muted-foreground text-sm">
              Aucune zone ne correspond à cette recherche.
            </p>
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

          {filteredRows.length > pageSize && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {limit < filteredRows.length && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((current) => current + pageSize)}
                >
                  Afficher {Math.min(pageSize, filteredRows.length - limit)} zones de plus
                </Button>
              )}
              {limit < filteredRows.length && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit(filteredRows.length)}
                >
                  Tout afficher ({filteredRows.length})
                </Button>
              )}
              {limit > pageSize && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit(pageSize)}
                >
                  Réduire à {pageSize}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
