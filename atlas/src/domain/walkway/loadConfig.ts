import { DIMENSION_KEYS, type Dimension } from "../dimensions.js";
import rawConfig from "./walkway.config.json";

export interface LinearIndicatorConfig {
  dimension: Dimension;
  noProblemAt: number;
  totalObstacleAt: number;
}

export interface ProfileConfig {
  label: string;
  weights: Partial<Record<Dimension, number>>;
  vetoes: { stepsWithoutRamp?: boolean; widthBelowM?: number; kerbRaised?: boolean };
}

export interface WalkwayConfig {
  indicators: {
    width: LinearIndicatorConfig;
    noise: LinearIndicatorConfig;
    slope: LinearIndicatorConfig;
    rest: LinearIndicatorConfig;
    surface: { dimension: Dimension; scores: Record<string, number> };
    economic: { dimension: Dimension; bufferM: number };
    lighting: { dimension: Dimension };
    publicPrivate: { dimension: Dimension };
    landmarks: LinearIndicatorConfig;
    activities: LinearIndicatorConfig;
    civic: LinearIndicatorConfig;
  };
  noiseEstimate: {
    roadBaseDb: Record<string, number>;
    defaultSpeedKmh: number;
    referenceSpeedKmh: number;
    dbPer10KmhAboveReference: number;
    referenceDistanceM: number;
    dbDropPerDoubling: number;
    floorDb: number;
  };
  kerbAttachM: number;
  zones: { scoreBelow: number; mergeGapM: number; minLengthM: number; maxLengthM: number; maxSegmentM: number; splitCellM: number };
  autoData: {
    noiseMap: { bandMidpointOffsetDb: number; belowThresholdDb: number; sampleSpacingM: number; gapFallbackRoadM: number };
    slope: { minBaselineM: number };
    /** OSM highway value -> typical width in metres. */
    widthDefaults: Record<string, number>;
    excludeTrails: { tags: string[]; nameStartsWith: string[]; unpavedSurfaces: string[] };
    /** Which OpenStreetMap places count, and how close "near" is. */
    places: {
      landmarkRadiusM: number;
      publicPrivateRadiusM: number;
      freeAmenities: string[];
      freeLeisure: string[];
      privateAmenities: string[];
      lampRadiusM: number;
      activityAmenities: string[];
      activityLeisure: string[];
      civicAmenities: string[];
    };
  };
  classes: {
    redBelow: number;
    orangeBelow: number;
    colours: { red: string; orange: string; green: string; none: string };
  };
  profiles: Record<string, ProfileConfig>;
}

/** Thrown with every problem found, worded for a non-developer. */
export class WalkwayConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`walkway.config.json has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    this.name = "WalkwayConfigError";
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateWalkwayConfig(raw: unknown): WalkwayConfig {
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
  const dimensionOf = (block: Json, path: string): Dimension => {
    const d = block.dimension;
    need(
      typeof d === "string" && (DIMENSION_KEYS as readonly string[]).includes(d),
      `"${path}dimension" must be one of: ${DIMENSION_KEYS.join(", ")}.`,
    );
    return d as Dimension;
  };
  const linear = (parent: Json, key: string): LinearIndicatorConfig => {
    const path = `indicators.${key}.`;
    const block = section(parent, key, "indicators.");
    need(isNumber(block.noProblemAt), `"${path}noProblemAt" must be a number.`);
    need(isNumber(block.totalObstacleAt), `"${path}totalObstacleAt" must be a number.`);
    need(
      block.noProblemAt !== block.totalObstacleAt,
      `"${path}noProblemAt" and "totalObstacleAt" must be different numbers.`,
    );
    return {
      dimension: dimensionOf(block, path),
      noProblemAt: block.noProblemAt as number,
      totalObstacleAt: block.totalObstacleAt as number,
    };
  };

  const indicators = section(root, "indicators", "");
  const surface = section(indicators, "surface", "indicators.");
  const scores = isObject(surface.scores) ? surface.scores : {};
  need(isObject(surface.scores), `"indicators.surface.scores" is missing.`);
  for (const [name, value] of Object.entries(scores)) {
    if (name.startsWith("_")) continue;
    need(isNumber(value) && value >= 0 && value <= 1, `Surface "${name}" must be a number between 0 and 1.`);
  }
  const economic = section(indicators, "economic", "indicators.");
  need(isNumber(economic.bufferM) && (economic.bufferM as number) > 0, `"indicators.economic.bufferM" must be a number above 0.`);

  const lightingBlock = section(indicators, "lighting", "indicators.");
  const lightingDimension = dimensionOf(lightingBlock, "indicators.lighting.");
  const publicPrivateBlock = section(indicators, "publicPrivate", "indicators.");
  const publicPrivateDimension = dimensionOf(publicPrivateBlock, "indicators.publicPrivate.");
  const landmarks = linear(indicators, "landmarks");
  const activities = linear(indicators, "activities");
  const civic = linear(indicators, "civic");

  const noise = section(root, "noiseEstimate", "");
  for (const key of ["defaultSpeedKmh", "referenceSpeedKmh", "dbPer10KmhAboveReference", "referenceDistanceM", "dbDropPerDoubling", "floorDb"]) {
    need(isNumber(noise[key]), `"noiseEstimate.${key}" must be a number.`);
  }
  const roadBase = isObject(noise.roadBaseDb) ? noise.roadBaseDb : {};
  need(Object.keys(roadBase).some((k) => !k.startsWith("_")), `"noiseEstimate.roadBaseDb" needs at least one road type.`);

  need(isNumber(root.kerbAttachM), `"kerbAttachM" must be a number.`);

  const zones = section(root, "zones", "");
  need(isNumber(zones.scoreBelow) && (zones.scoreBelow as number) > 0 && (zones.scoreBelow as number) <= 1, `"zones.scoreBelow" must be a number above 0 and at most 1.`);
  need(isNumber(zones.mergeGapM) && (zones.mergeGapM as number) >= 0, `"zones.mergeGapM" must be a number of metres, 0 or more.`);
  need(isNumber(zones.minLengthM) && (zones.minLengthM as number) >= 0, `"zones.minLengthM" must be a number of metres, 0 or more.`);

  const auto = section(root, "autoData", "");
  const noiseMap = section(auto, "noiseMap", "autoData.");
  for (const key of ["bandMidpointOffsetDb", "belowThresholdDb"]) {
    need(isNumber(noiseMap[key]), `"autoData.noiseMap.${key}" must be a number.`);
  }
  need(isNumber(noiseMap.sampleSpacingM) && (noiseMap.sampleSpacingM as number) > 0, `"autoData.noiseMap.sampleSpacingM" must be a number above 0.`);
  need(isNumber(noiseMap.gapFallbackRoadM) && (noiseMap.gapFallbackRoadM as number) >= 0, `"autoData.noiseMap.gapFallbackRoadM" must be a number of metres, 0 or more.`);
  const slopeAuto = section(auto, "slope", "autoData.");
  need(isNumber(slopeAuto.minBaselineM) && (slopeAuto.minBaselineM as number) > 0, `"autoData.slope.minBaselineM" must be a number above 0.`);
  const widthDefaults = section(auto, "widthDefaults", "autoData.");
  for (const [kind, value] of Object.entries(widthDefaults)) {
    if (kind.startsWith("_")) continue;
    need(isNumber(value) && value > 0, `"autoData.widthDefaults.${kind}" must be a width in metres, above 0.`);
  }

  const places = section(auto, "places", "autoData.");
  for (const key of ["landmarkRadiusM", "lampRadiusM", "publicPrivateRadiusM"]) {
    need(isNumber(places[key]) && (places[key] as number) > 0, `"autoData.places.${key}" must be a number of metres above 0.`);
  }
  const list = (key: string): string[] => {
    const v = places[key];
    need(Array.isArray(v) && v.every((x) => typeof x === "string"), `"autoData.places.${key}" must be a list of OpenStreetMap values in quotes.`);
    return Array.isArray(v) ? (v as string[]) : [];
  };
  const activityAmenities = list("activityAmenities");
  const activityLeisure = list("activityLeisure");
  const civicAmenities = list("civicAmenities");
  const freeAmenities = list("freeAmenities");
  const freeLeisure = list("freeLeisure");
  const privateAmenities = list("privateAmenities");

  need(isNumber(zones.maxLengthM) && (zones.maxLengthM as number) > 0, `"zones.maxLengthM" must be a number of metres above 0.`);
  need(isNumber(zones.maxSegmentM) && (zones.maxSegmentM as number) > 0, `"zones.maxSegmentM" must be a number of metres above 0.`);
  need(isNumber(zones.splitCellM) && (zones.splitCellM as number) > 0, `"zones.splitCellM" must be a number of metres above 0.`);
  const trails = section(auto, "excludeTrails", "autoData.");
  const trailList = (key: string): string[] => {
    const v = trails[key];
    need(Array.isArray(v) && v.every((x) => typeof x === "string"), `"autoData.excludeTrails.${key}" must be a list of words in quotes (it can be empty).`);
    return Array.isArray(v) ? (v as string[]) : [];
  };
  const trailTags = trailList("tags");
  const trailNames = trailList("nameStartsWith");
  const trailSurfaces = trailList("unpavedSurfaces");

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

  const profilesRaw = section(root, "profiles", "");
  const profiles: Record<string, ProfileConfig> = {};
  for (const [id, value] of Object.entries(profilesRaw)) {
    if (id.startsWith("_")) continue;
    const path = `profiles.${id}.`;
    need(isObject(value), `Profile "${id}" must be a block with label, weights and vetoes.`);
    const block = isObject(value) ? value : {};
    need(typeof block.label === "string" && block.label.length > 0, `"${path}label" is missing.`);
    const weightsRaw = isObject(block.weights) ? block.weights : {};
    need(isObject(block.weights), `"${path}weights" is missing.`);
    const weights: Partial<Record<Dimension, number>> = {};
    let sum = 0;
    for (const [dim, w] of Object.entries(weightsRaw)) {
      if (dim.startsWith("_")) continue;
      need((DIMENSION_KEYS as readonly string[]).includes(dim), `"${path}weights" has an unknown dimension "${dim}". Use: ${DIMENSION_KEYS.join(", ")}.`);
      need(isNumber(w) && w >= 0, `"${path}weights.${dim}" must be a number, 0 or more.`);
      if (isNumber(w)) {
        weights[dim as Dimension] = w;
        sum += w;
      }
    }
    need(Math.abs(sum - 1) < 1e-6, `Profile "${id}": the weights add up to ${Math.round(sum * 1000) / 1000}, they must add up to 1.`);
    const vetoesRaw = isObject(block.vetoes) ? block.vetoes : {};
    need(isObject(block.vetoes), `"${path}vetoes" is missing (use {} for none).`);
    const vetoes: ProfileConfig["vetoes"] = {};
    for (const [rule, v] of Object.entries(vetoesRaw)) {
      if (rule.startsWith("_")) continue;
      if (rule === "stepsWithoutRamp" || rule === "kerbRaised") {
        need(typeof v === "boolean", `"${path}vetoes.${rule}" must be true or false.`);
        vetoes[rule] = v === true;
      } else if (rule === "widthBelowM") {
        need(isNumber(v), `"${path}vetoes.widthBelowM" must be a number of metres.`);
        vetoes.widthBelowM = v as number;
      } else {
        problems.push(`"${path}vetoes" has an unknown rule "${rule}". Use: stepsWithoutRamp, widthBelowM, kerbRaised.`);
      }
    }
    profiles[id] = { label: String(block.label ?? id), weights, vetoes };
  }
  need(Object.keys(profiles).length > 0, `"profiles" needs at least one profile.`);

  // Checked before the throw below: these were previously validated only while
  // building the result, so a bad width/noise/slope/rest threshold slipped through.
  const width = linear(indicators, "width");
  const noiseIndicator = linear(indicators, "noise");
  const slope = linear(indicators, "slope");
  const rest = linear(indicators, "rest");

  if (problems.length > 0) throw new WalkwayConfigError(problems);

  return {
    indicators: {
      width,
      noise: noiseIndicator,
      slope,
      rest,
      surface: { dimension: surface.dimension as Dimension, scores: stripNotes(scores) as Record<string, number> },
      economic: { dimension: economic.dimension as Dimension, bufferM: economic.bufferM as number },
      lighting: { dimension: lightingDimension },
      publicPrivate: { dimension: publicPrivateDimension },
      landmarks,
      activities,
      civic,
    },
    noiseEstimate: {
      roadBaseDb: stripNotes(roadBase) as Record<string, number>,
      defaultSpeedKmh: noise.defaultSpeedKmh as number,
      referenceSpeedKmh: noise.referenceSpeedKmh as number,
      dbPer10KmhAboveReference: noise.dbPer10KmhAboveReference as number,
      referenceDistanceM: noise.referenceDistanceM as number,
      dbDropPerDoubling: noise.dbDropPerDoubling as number,
      floorDb: noise.floorDb as number,
    },
    kerbAttachM: root.kerbAttachM as number,
    zones: {
      scoreBelow: zones.scoreBelow as number,
      mergeGapM: zones.mergeGapM as number,
      minLengthM: zones.minLengthM as number,
      maxLengthM: zones.maxLengthM as number,
      maxSegmentM: zones.maxSegmentM as number,
      splitCellM: zones.splitCellM as number,
    },
    autoData: {
      noiseMap: {
        bandMidpointOffsetDb: noiseMap.bandMidpointOffsetDb as number,
        belowThresholdDb: noiseMap.belowThresholdDb as number,
        sampleSpacingM: noiseMap.sampleSpacingM as number,
        gapFallbackRoadM: noiseMap.gapFallbackRoadM as number,
      },
      slope: { minBaselineM: slopeAuto.minBaselineM as number },
      widthDefaults: stripNotes(widthDefaults) as Record<string, number>,
      excludeTrails: { tags: trailTags, nameStartsWith: trailNames, unpavedSurfaces: trailSurfaces },
      places: {
        landmarkRadiusM: places.landmarkRadiusM as number,
        lampRadiusM: places.lampRadiusM as number,
        publicPrivateRadiusM: places.publicPrivateRadiusM as number,
        freeAmenities,
        freeLeisure,
        privateAmenities,
        activityAmenities,
        activityLeisure,
        civicAmenities,
      },
    },
    classes: {
      redBelow: classes.redBelow as number,
      orangeBelow: classes.orangeBelow as number,
      colours: colours as WalkwayConfig["classes"]["colours"],
    },
    profiles,
  };
}

function stripNotes(block: Json): Json {
  return Object.fromEntries(Object.entries(block).filter(([k]) => !k.startsWith("_")));
}

/** The settings shipped in walkway.config.json, validated once at load. */
export const WALKWAY_CONFIG: WalkwayConfig = validateWalkwayConfig(rawConfig);
