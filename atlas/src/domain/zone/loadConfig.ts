import { DIMENSION_KEYS, type Dimension } from "../dimensions.js";
import rawConfig from "./zone.config.json";
import type { ReportKind } from "./types.js";

export interface IndicatorConfig {
  label: string;
  unit: string;
  dimension: Dimension;
  kind: "linear" | "share";
  /** Linear only: the value that gives barrier 0, and the one that gives barrier 1. */
  noProblemAt?: number;
  totalObstacleAt?: number;
}

export interface ProfileConfig {
  label: string;
  weights: Partial<Record<Dimension, number>>;
}

export interface ZoneConfig {
  indicators: Record<string, IndicatorConfig>;
  /** Report kind -> words that identify it in the type the citizen chose. */
  reports: Record<Exclude<ReportKind, "other">, string[]>;
  autoData: {
    minStreetKm: number;
    minTaggedWays: number;
    coPresenceWidthM: number;
    sampleGridM: number;
    terrainGridM: number;
    noiseMap: { bandMidpointOffsetDb: number; belowThresholdDb: number };
    participation: { outsideBarrier: number };
    streetHighways: string[];
    excludeTrails: { tags: string[]; nameStartsWith: string[]; unpavedSurfaces: string[] };
    surfaceRoughness: Record<string, number>;
    surfaceGlare: Record<string, number>;
    places: {
      freeAmenities: string[];
      freeLeisure: string[];
      privateAmenities: string[];
      freeServiceAmenities: string[];
      activityAmenities: string[];
      activityLeisure: string[];
      civicAmenities: string[];
      signageInformation: string[];
      notLandmarks: string[];
    };
  };
  classes: {
    redBelow: number;
    orangeBelow: number;
    colours: { red: string; orange: string; green: string; none: string };
  };
  ranking: { topN: number };
  scoring: { dimensionBarrierCap: number };
  profiles: Record<string, ProfileConfig>;
}

/** Thrown with every problem found, worded for a non-developer. */
export class ZoneConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`zone.config.json has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    this.name = "ZoneConfigError";
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const stripNotes = (block: Json): Json => Object.fromEntries(Object.entries(block).filter(([k]) => !k.startsWith("_")));

export function validateZoneConfig(raw: unknown): ZoneConfig {
  const problems: string[] = [];
  const root = isObject(raw) ? raw : {};
  const need = (cond: boolean, message: string) => {
    if (!cond) problems.push(message);
  };
  const section = (parent: Json, key: string, path: string): Json => {
    const value = parent[key];
    need(isObject(value), `"${path}${key}" is missing.`);
    return isObject(value) ? value : {};
  };
  const list = (parent: Json, key: string, path: string): string[] => {
    const v = parent[key];
    need(Array.isArray(v) && v.every((x) => typeof x === "string"), `"${path}${key}" must be a list of words in quotes (it can be empty).`);
    return Array.isArray(v) ? (v as string[]) : [];
  };
  const table = (parent: Json, key: string, path: string): Record<string, number> => {
    const block = stripNotes(section(parent, key, path));
    for (const [name, value] of Object.entries(block)) {
      need(isNumber(value) && value >= 0 && value <= 1, `"${path}${key}.${name}" must be a number between 0 and 1.`);
    }
    return block as Record<string, number>;
  };

  const indicators: Record<string, IndicatorConfig> = {};
  for (const [key, value] of Object.entries(stripNotes(section(root, "indicators", "")))) {
    const path = `indicators.${key}.`;
    if (!isObject(value)) {
      problems.push(`"indicators.${key}" must be a block of settings.`);
      continue;
    }
    need(typeof value.label === "string" && value.label.length > 0, `"${path}label" is missing.`);
    need(
      typeof value.dimension === "string" && (DIMENSION_KEYS as readonly string[]).includes(value.dimension),
      `"${path}dimension" must be one of: ${DIMENSION_KEYS.join(", ")}.`,
    );
    need(value.kind === "linear" || value.kind === "share", `"${path}kind" must be "linear" or "share".`);
    if (value.kind === "linear") {
      need(isNumber(value.noProblemAt), `"${path}noProblemAt" must be a number.`);
      need(isNumber(value.totalObstacleAt), `"${path}totalObstacleAt" must be a number.`);
      need(value.noProblemAt !== value.totalObstacleAt, `"${path}noProblemAt" and "totalObstacleAt" must be different numbers.`);
    }
    indicators[key] = {
      label: String(value.label ?? key),
      unit: String(value.unit ?? ""),
      dimension: value.dimension as Dimension,
      kind: value.kind as "linear" | "share",
      ...(value.kind === "linear" ? { noProblemAt: value.noProblemAt as number, totalObstacleAt: value.totalObstacleAt as number } : {}),
    };
  }
  need(Object.keys(indicators).length > 0, `"indicators" needs at least one indicator.`);
  for (const d of DIMENSION_KEYS) {
    need(Object.values(indicators).some((i) => i.dimension === d), `Dimension "${d}" has no indicator.`);
  }

  const reportsBlock = section(root, "reports", "");
  const reports = {
    parking: list(reportsBlock, "parking", "reports."),
    narrow: list(reportsBlock, "narrow", "reports."),
    works: list(reportsBlock, "works", "reports."),
    furniture: list(reportsBlock, "furniture", "reports."),
  };

  const auto = section(root, "autoData", "");
  for (const key of ["minStreetKm", "coPresenceWidthM", "sampleGridM", "terrainGridM"]) {
    need(isNumber(auto[key]) && (auto[key] as number) > 0, `"autoData.${key}" must be a number above 0.`);
  }
  need(isNumber(auto.minTaggedWays) && (auto.minTaggedWays as number) >= 1, `"autoData.minTaggedWays" must be a number, 1 or more.`);
  const noiseMap = section(auto, "noiseMap", "autoData.");
  for (const key of ["bandMidpointOffsetDb", "belowThresholdDb"]) need(isNumber(noiseMap[key]), `"autoData.noiseMap.${key}" must be a number.`);
  const participation = section(auto, "participation", "autoData.");
  need(isNumber(participation.outsideBarrier) && (participation.outsideBarrier as number) >= 0 && (participation.outsideBarrier as number) <= 1, `"autoData.participation.outsideBarrier" must be a number between 0 and 1.`);
  const trails = section(auto, "excludeTrails", "autoData.");
  const places = section(auto, "places", "autoData.");
  const placeList = (key: string) => list(places, key, "autoData.places.");
  const autoData = {
    minStreetKm: auto.minStreetKm as number,
    minTaggedWays: auto.minTaggedWays as number,
    coPresenceWidthM: auto.coPresenceWidthM as number,
    sampleGridM: auto.sampleGridM as number,
    terrainGridM: auto.terrainGridM as number,
    noiseMap: { bandMidpointOffsetDb: noiseMap.bandMidpointOffsetDb as number, belowThresholdDb: noiseMap.belowThresholdDb as number },
    participation: { outsideBarrier: participation.outsideBarrier as number },
    streetHighways: list(auto, "streetHighways", "autoData."),
    excludeTrails: {
      tags: list(trails, "tags", "autoData.excludeTrails."),
      nameStartsWith: list(trails, "nameStartsWith", "autoData.excludeTrails."),
      unpavedSurfaces: list(trails, "unpavedSurfaces", "autoData.excludeTrails."),
    },
    surfaceRoughness: table(auto, "surfaceRoughness", "autoData."),
    surfaceGlare: table(auto, "surfaceGlare", "autoData."),
    places: {
      freeAmenities: placeList("freeAmenities"),
      freeLeisure: placeList("freeLeisure"),
      privateAmenities: placeList("privateAmenities"),
      freeServiceAmenities: placeList("freeServiceAmenities"),
      activityAmenities: placeList("activityAmenities"),
      activityLeisure: placeList("activityLeisure"),
      civicAmenities: placeList("civicAmenities"),
      signageInformation: placeList("signageInformation"),
      notLandmarks: placeList("notLandmarks"),
    },
  };

  const classes = section(root, "classes", "");
  need(isNumber(classes.redBelow) && isNumber(classes.orangeBelow), `"classes.redBelow" and "classes.orangeBelow" must be numbers.`);
  need(
    !isNumber(classes.redBelow) || !isNumber(classes.orangeBelow) || classes.redBelow < classes.orangeBelow,
    `"classes.redBelow" must be smaller than "classes.orangeBelow".`,
  );
  const colours = isObject(classes.colours) ? classes.colours : {};
  for (const key of ["red", "orange", "green", "none"]) {
    need(typeof colours[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(colours[key] as string), `"classes.colours.${key}" must look like #b91c1c.`);
  }

  const scoring = section(root, "scoring", "");
  need(isNumber(scoring.dimensionBarrierCap) && (scoring.dimensionBarrierCap as number) > 0 && (scoring.dimensionBarrierCap as number) <= 1, `"scoring.dimensionBarrierCap" must be a number above 0 and at most 1.`);
  const ranking = section(root, "ranking", "");
  need(isNumber(ranking.topN) && (ranking.topN as number) >= 1, `"ranking.topN" must be a number, 1 or more.`);

  const profilesRaw = section(root, "profiles", "");
  const profiles: Record<string, ProfileConfig> = {};
  for (const [id, value] of Object.entries(stripNotes(profilesRaw))) {
    const path = `profiles.${id}.`;
    if (!isObject(value)) {
      problems.push(`"profiles.${id}" must be a block of settings.`);
      continue;
    }
    const weightsRaw = isObject(value.weights) ? value.weights : {};
    need(isObject(value.weights), `"${path}weights" is missing.`);
    const weights: Partial<Record<Dimension, number>> = {};
    let total = 0;
    for (const [dim, w] of Object.entries(weightsRaw)) {
      if (dim.startsWith("_")) continue;
      if (!(DIMENSION_KEYS as readonly string[]).includes(dim)) {
        problems.push(`Profile "${id}": "${dim}" is not a dimension. Use: ${DIMENSION_KEYS.join(", ")}.`);
        continue;
      }
      if (!isNumber(w) || w < 0) {
        problems.push(`Profile "${id}": the weight of "${dim}" must be a number, 0 or more.`);
        continue;
      }
      weights[dim as Dimension] = w;
      total += w;
    }
    need(Math.abs(total - 1) < 1e-6, `Profile "${id}": the weights add up to ${Number(total.toFixed(6))}, they must add up to 1.`);
    profiles[id] = { label: String(value.label ?? id), weights };
  }
  need(Object.keys(profiles).length > 0, `"profiles" needs at least one profile.`);

  if (problems.length > 0) throw new ZoneConfigError(problems);

  return {
    indicators,
    reports,
    autoData,
    classes: {
      redBelow: classes.redBelow as number,
      orangeBelow: classes.orangeBelow as number,
      colours: colours as ZoneConfig["classes"]["colours"],
    },
    ranking: { topN: ranking.topN as number },
    scoring: { dimensionBarrierCap: scoring.dimensionBarrierCap as number },
    profiles,
  };
}

export const ZONE_CONFIG: ZoneConfig = validateZoneConfig(rawConfig);
