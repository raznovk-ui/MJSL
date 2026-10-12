import type { ValueSource, Zone } from "../../domain/zone/index.js";

/** Where a value came from, as shown to people. */
export const SOURCE_LABEL: Record<ValueSource, string> = { osm: "OSM", official: "officiel", reported: "signalements" };

/** "Marseille 6e Arrondissement" -> "6e Arrondissement". */
export const shortArrondissement = (zone: Pick<Zone, "arrondissement">) => zone.arrondissement.replace("Marseille ", "");
