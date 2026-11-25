/**
 * The economic data joined by IRIS: observed rents (OLL 13), income (INSEE
 * FiLoSoFi 2021), asking rents (Carte des loyers, cross-check) and the public-space
 * share computed by scripts/computePublicSpace.ts.
 *
 * Everything is optional: a missing file means "no data" for the indicators that
 * depend on it, never 0.
 */
export interface RentRecord {
  /** OLL zone (8 groups for Marseille), for display and quality. */
  zone: string;
  /** Median observed rent, euros per square metre per month. */
  sMed: number;
  /** Median observed monthly rent, euros. */
  mMed: number;
  sQ1?: number;
  sQ3?: number;
  surface?: number;
  nbEnq?: number;
  /** The OLL flags an IRIS with a restricted private rental stock. */
  plr: boolean;
}

export interface AskingRentRecord {
  median: number;
  low?: number;
  high?: number;
  observations?: number;
}

export interface IncomeRecord {
  /** Median disposable income per consumption unit, euros per year. */
  median: number;
  /** Poverty rate, % of households. */
  poverty?: number;
  q1?: number;
  q3?: number;
}

export interface PublicSpaceRecord {
  /** (public open spaces + streets) / built-up area, 0..1. */
  share?: number;
  builtUpSamples?: number;
  publicSamples?: number;
  parkSamples?: number;
  streetSamples?: number;
  builtUpM2?: number;
  publicM2?: number;
  gridM?: number;
  /** "osm", "no-natural" or "low". */
  quality?: string;
}

export interface EconomicData {
  rent?: {
    observed?: Record<string, RentRecord>;
    askingCrossCheck?: { byArrondissement?: Record<string, AskingRentRecord> };
  };
  income?: { iris?: Record<string, IncomeRecord> };
  publicSpace?: { iris?: Record<string, PublicSpaceRecord> };
}

export interface EconomicIndex {
  rent: Map<string, RentRecord>;
  askingByArrondissement: Map<string, AskingRentRecord>;
  income: Map<string, IncomeRecord>;
  publicSpace: Map<string, PublicSpaceRecord>;
}

export function buildEconomicIndex(data: EconomicData | undefined): EconomicIndex | undefined {
  if (!data) return undefined;
  const hasAny = data.rent || data.income || data.publicSpace;
  if (!hasAny) return undefined;
  return {
    rent: new Map(Object.entries(data.rent?.observed ?? {})),
    askingByArrondissement: new Map(Object.entries(data.rent?.askingCrossCheck?.byArrondissement ?? {})),
    income: new Map(Object.entries(data.income?.iris ?? {})),
    publicSpace: new Map(Object.entries(data.publicSpace?.iris ?? {})),
  };
}
