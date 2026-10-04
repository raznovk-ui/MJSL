import type { Feature, FeatureCollection } from "geojson";
import type { Observation, RupturePoint } from "../../domain/types.js";
import type { RedZone } from "../../domain/scoring/redzones.js";
import type { ScoringConfig } from "../../domain/config.js";
import { DIMENSION_KEYS } from "../../domain/dimensions.js";

export const PROJECT_FORMAT = "mjsl-atlas-project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: string;
  config: ScoringConfig;
  observations: Observation[];
  ruptures: RupturePoint[];
  /** Photo ids present in the archive, so a reader knows what is missing. */
  photoIds: string[];
  attribution: string[];
}

export const ATTRIBUTION = [
  "Fonds de carte et indices : OpenStreetMap contributors (ODbL).",
  "Requetes : Overpass API.",
  "Bruit routier (Lden 24 h) : Metropole d'Aix-Marseille-Provence, etude Impedance Ingenierie, Licence Ouverte 2.0.",
  "Altitudes (pentes) : IGN, RGE ALTI, Licence Ouverte 2.0.",
  "Releves et notations MJSL : produits par l'auteur du projet.",
  "Les notes sont des jugements situes, pas des mesures.",
];

export function buildProject(input: {
  config: ScoringConfig;
  observations: Observation[];
  ruptures: RupturePoint[];
  photoIds: string[];
  now?: string;
}): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: input.now ?? new Date().toISOString(),
    config: input.config,
    observations: input.observations,
    ruptures: input.ruptures,
    photoIds: input.photoIds,
    attribution: ATTRIBUTION,
  };
}

export interface ParsedProject {
  project: ProjectFile;
  warnings: string[];
}

/** Reads a project file back, refusing anything that is not one. */
export function parseProject(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Fichier de projet illisible (JSON invalide).");
  }

  const value = raw as Partial<ProjectFile>;
  if (!value || value.format !== PROJECT_FORMAT) {
    throw new Error("Ce fichier n'est pas un projet Atlas MJSL.");
  }

  const warnings: string[] = [];
  if (typeof value.version !== "number" || value.version > PROJECT_VERSION) {
    warnings.push(
      `Projet en version ${String(value.version)}, lu par une application en version ${PROJECT_VERSION}. Certains champs peuvent etre ignores.`,
    );
  }

  const observations = Array.isArray(value.observations) ? value.observations : [];
  const ruptures = Array.isArray(value.ruptures) ? value.ruptures : [];
  if (observations.length === 0 && ruptures.length === 0) {
    warnings.push("Le projet ne contient ni observation ni rupture.");
  }

  return {
    project: {
      format: PROJECT_FORMAT,
      version: typeof value.version === "number" ? value.version : PROJECT_VERSION,
      exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
      config: value.config as ScoringConfig,
      observations,
      ruptures,
      photoIds: Array.isArray(value.photoIds) ? value.photoIds : [],
      attribution: Array.isArray(value.attribution) ? value.attribution : ATTRIBUTION,
    },
    warnings,
  };
}

/** Observations and ruptures as one FeatureCollection, for QGIS. */
export function toGeojson(observations: Observation[], ruptures: RupturePoint[]): FeatureCollection {
  const observationFeatures: Feature[] = observations.map((observation) => ({
    type: "Feature",
    id: observation.id,
    properties: {
      kind: "observation",
      id: observation.id,
      title: observation.title,
      description: observation.description ?? "",
      source: observation.source,
      observed_at: observation.observedAt ?? "",
      tags: (observation.tags ?? []).join(";"),
      ...Object.fromEntries(
        DIMENSION_KEYS.map((key) => [
          key,
          observation.ratings.find((r) => r.dimension === key)?.score ?? null,
        ]),
      ),
    },
    geometry: observation.geometry,
  }));

  const ruptureFeatures: Feature[] = ruptures.map((rupture) => ({
    type: "Feature",
    id: rupture.id,
    properties: {
      kind: "rupture",
      id: rupture.id,
      severity: rupture.severity,
      blocking: rupture.blocking,
      dimensions: rupture.dimensions.join(";"),
      comment: rupture.comment ?? "",
      suggested_fix: rupture.suggestedFix ?? "",
      observed_at: rupture.observedAt ?? "",
    },
    geometry: rupture.geometry,
  }));

  return { type: "FeatureCollection", features: [...observationFeatures, ...ruptureFeatures] };
}

export function redZonesGeojson(zones: RedZone[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((zone, index) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        rank: index + 1,
        severity_index: Number(zone.severityIndex.toFixed(3)),
        mean_deficit: Number(zone.meanDeficit.toFixed(3)),
        cells: zone.areaCells,
        blocking_ruptures: zone.blockingRuptureIds.length,
        mean_confidence: Number(zone.meanConfidence.toFixed(3)),
        dominant_dimensions: zone.dominantDimensions.join(";"),
        summary: zone.summary,
      },
      geometry: zone.geometry.geometry,
    })),
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function observationsCsv(observations: Observation[]): string {
  const header = [
    "id", "title", "description", "source", "observed_at", "geometry_type", "lon", "lat", "tags",
    ...DIMENSION_KEYS,
  ];
  const rows = observations.map((observation) => {
    // A line or polygon has no single coordinate; the CSV records the first
    // vertex and the geometry type, and the GeoJSON export carries the real shape.
    const flat = JSON.stringify(observation.geometry.coordinates).match(/-?\d+(\.\d+)?/g) ?? [];
    return [
      observation.id,
      observation.title,
      observation.description ?? "",
      observation.source,
      observation.observedAt ?? "",
      observation.geometry.type,
      flat[0] ?? "",
      flat[1] ?? "",
      (observation.tags ?? []).join(";"),
      ...DIMENSION_KEYS.map((key) => observation.ratings.find((r) => r.dimension === key)?.score ?? ""),
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}
