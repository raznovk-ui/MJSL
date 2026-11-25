/**
 * The part of a territory that the scoring engine needs: which properties of the
 * zone features hold the id, the name, the type and the income. Marseille is the
 * only complete territory today; Rabat-Salé will be added as a second pack once
 * its data and the urban agency access are confirmed.
 */
export interface TerritoryConfig {
  id: string;
  label: string;
  /** "iris" in France; "arrondissement" or "commune" in Morocco. */
  zoneUnit: string;
  zoneProperties: {
    id: string;
    name: string;
    type: string;
    arrondissement: string;
    households: string;
    /** 2014 fallback, only used when the 2021 income file is missing for the zone. */
    poverty: string;
    /** 2014 fallback, only used when the 2021 income file is missing for the zone. */
    median: string;
  };
}

export const MARSEILLE_TERRITORY: TerritoryConfig = {
  id: "marseille",
  label: "Marseille",
  zoneUnit: "iris",
  zoneProperties: {
    id: "id",
    name: "name",
    type: "type",
    arrondissement: "arr",
    households: "households",
    poverty: "poverty",
    median: "median",
  },
};
