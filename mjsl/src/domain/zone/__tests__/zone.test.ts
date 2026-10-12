import { describe, expect, it } from "vitest";
import type { Feature, FeatureCollection } from "geojson";
import rawConfig from "../zone.config.json";
import {
  DIMENSION_KEYS,
  ZONE_CONFIG as config,
  ZoneConfigError,
  buildAmpIndex,
  buildNoiseIndex,
  buildZones,
  classify,
  computeBarriers,
  dimensionScores,
  linearBarrier,
  rankZones,
  reportKind,
  scoreAllProfiles,
  scoreZone,
  terrainPoints,
  validateZoneConfig,
  withSlope,
  zonesToGeojson,
  type Zone,
} from "../index.js";
import { areaAndCentroid } from "../zoneGeometry.js";

const clone = () => JSON.parse(JSON.stringify(rawConfig));
const loose = () => {
  const c = clone();
  c.autoData.minStreetKm = 0.05;
  c.autoData.minTaggedWays = 2;
  return validateZoneConfig(c);
};

// Two neighbouring squares of about 0.9 km2 each (0.01 degree is about 810 m east-west and 1105 m north-south).
const LAT0 = 43.28;
const square = (lng0: number, id: string, props: Record<string, unknown> = {}): Feature => ({
  type: "Feature",
  properties: { id, name: `Zone ${id}`, arr: "Marseille 1er Arrondissement", households: 1000, ...props },
  geometry: { type: "Polygon", coordinates: [[[lng0, LAT0], [lng0 + 0.01, LAT0], [lng0 + 0.01, LAT0 + 0.01], [lng0, LAT0 + 0.01], [lng0, LAT0]]] },
});
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features }) as FeatureCollection;
const ZONES = fc([square(5.35, "A", { poverty: 30 }), square(5.36, "B", { poverty: 10 })]);

const way = (id: string, tags: Record<string, string>, coords: [number, number][]): Feature => ({
  type: "Feature",
  properties: { osm_id: id, highway: "footway", ...tags },
  geometry: { type: "LineString", coordinates: coords },
});
const node = (lng: number, lat: number, tags: Record<string, string>): Feature => ({
  type: "Feature",
  properties: tags,
  geometry: { type: "Point", coordinates: [lng, lat] },
});
// A 400 m street across the middle of zone A (0.005 degree is about 405 m).
const streetA = (tags: Record<string, string> = {}) => way("w1", tags, [[5.352, LAT0 + 0.005], [5.357, LAT0 + 0.005]]);
const inA = (dx = 0.005, dy = 0.005) => [5.35 + dx, LAT0 + dy] as const;

const build = (osm: Feature[], extra: Partial<Parameters<typeof buildZones>[0]> = {}, cfg = loose()) =>
  buildZones({ zones: ZONES, osm: fc(osm), ...extra }, cfg);
const zoneOf = (zones: Zone[], id: string) => zones.find((z) => z.id === id)!;

describe("barriers and scores", () => {
  it("a linear barrier runs from 0 to 1 between its two thresholds, in either direction, and is clamped", () => {
    expect(linearBarrier(1.35, 1.8, 0.9)).toBeCloseTo(0.5, 6);
    expect(linearBarrier(70, 55, 85)).toBeCloseTo(0.5, 6);
    expect(linearBarrier(2, 2, 0)).toBe(0);
    expect(linearBarrier(-9, 2, 0)).toBe(1);
  });

  it("missing data gives a null barrier, never 0, and is left out of the dimension and the score", () => {
    const only = { id: "z", values: { noise: 70 }, sources: { noise: "official" as const } };
    const barriers = computeBarriers(only, config);
    expect(barriers.find((b) => b.indicator === "noise")!.barrier).toBeCloseTo(0.5, 6);
    expect(barriers.find((b) => b.indicator === "steps")!.barrier).toBeNull();
    const s = scoreZone(only, "blind", config);
    expect(s.dimensionBarriers).toEqual({ sensory: expect.closeTo(0.5, 6) });
    expect(s.score).toBeCloseTo(0.5, 6); // weights rescaled over the one dimension that has data
    expect(s.dimensionsMissing).toContain("physical");
    expect(scoreZone({ id: "z", values: {}, sources: {} }, "blind", config).score).toBeNull();
  });

  it("barriers compound: the score is the product of (1 - barrier) ^ weight", () => {
    // physical barrier 0.5 (slope 8 %), sensory barrier 0.5 (noise 70 dB); blind weights 0.15 and 0.30, rescaled to 1/3 and 2/3.
    const z = { id: "z", values: { slope: 8, noise: 70 }, sources: { slope: "official" as const, noise: "official" as const } };
    expect(scoreZone(z, "blind", config).score).toBeCloseTo(Math.pow(0.5, 1 / 3) * Math.pow(0.5, 2 / 3), 6);
  });

  it("citizens' reports compound on top of the other indicators and can only make a dimension worse", () => {
    const sources = { slope: "official" as const, parkingReports: "reported" as const };
    const base = { id: "z", values: { slope: 8 }, sources }; // physical barrier 0.5 from the slope alone
    const none = scoreZone({ ...base, values: { slope: 8, parkingReports: 0 } }, "wheelchair", config);
    expect(none.dimensionBarriers.physical).toBeCloseTo(0.5, 6); // no report: nothing changes
    // 2 reports per km: barrier 0.5 -> physical = 1 - (1 - 0.5) * (1 - 0.5) = 0.75
    const some = scoreZone({ ...base, values: { slope: 8, parkingReports: 2 } }, "wheelchair", config);
    expect(some.dimensionBarriers.physical).toBeCloseTo(0.75, 6);
    // a mild report load must never lift a zone whose other indicators are worse
    const worse = scoreZone({ id: "z", values: { slope: 12, parkingReports: 0.4 }, sources }, "wheelchair", config);
    expect(worse.dimensionBarriers.physical!).toBeGreaterThanOrEqual(1 - 1e-9);
    // reports alone are enough to give the dimension a value
    expect(scoreZone({ id: "z", values: { parkingReports: 4 }, sources }, "wheelchair", config).dimensionBarriers.physical).toBe(1);
  });

  it("a dimension at its worst does not zero the whole score: its barrier is capped", () => {
    const z = { id: "z", values: { noise: 85, slope: 4 }, sources: { noise: "official" as const, slope: "official" as const } };
    const s = scoreZone(z, "blind", config);
    expect(s.dimensionBarriers.sensory).toBe(1);
    expect(s.score).toBeGreaterThan(0);
    const uncapped = clone();
    uncapped.scoring.dimensionBarrierCap = 1;
    expect(scoreZone(z, "blind", validateZoneConfig(uncapped)).score).toBe(0);
  });

  it("classes follow the thresholds, and no score is its own class", () => {
    expect(classify(null, config)).toBe("none");
    expect(classify(config.classes.redBelow - 0.01, config)).toBe("red");
    expect(classify(config.classes.orangeBelow - 0.01, config)).toBe("orange");
    expect(classify(config.classes.orangeBelow, config)).toBe("green");
  });

  it("every profile weights the six dimensions and adds up to 1", () => {
    for (const p of Object.values(config.profiles)) {
      expect(Object.values(p.weights).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 6);
    }
    for (const d of DIMENSION_KEYS) expect(Object.values(config.indicators).some((i) => i.dimension === d)).toBe(true);
  });
});

describe("config validation", () => {
  it("accepts the shipped config", () => {
    expect(() => validateZoneConfig(rawConfig)).not.toThrow();
  });

  it("says what is wrong, in plain words, all at once", () => {
    const c = clone();
    c.profiles.blind.weights.physical = 0.9;
    c.indicators.noise.noProblemAt = c.indicators.noise.totalObstacleAt;
    c.indicators.noise.dimension = "smell";
    c.classes.redBelow = 0.9;
    let message = "";
    try { validateZoneConfig(c); } catch (e) { expect(e).toBeInstanceOf(ZoneConfigError); message = (e as Error).message; }
    expect(message).toMatch(/Profile "blind": the weights add up to/);
    expect(message).toMatch(/noProblemAt" and "totalObstacleAt" must be different/);
    expect(message).toMatch(/dimension" must be one of/);
    expect(message).toMatch(/redBelow" must be smaller than "classes.orangeBelow/);
  });

  it("insists every dimension has an indicator", () => {
    const c = clone();
    delete c.indicators.civic;
    delete c.indicators.participation;
    expect(() => validateZoneConfig(c)).toThrow(/Dimension "political" has no indicator/);
  });
});

describe("zone geometry", () => {
  it("measures the area and the centroid of a zone", () => {
    const g = square(5.35, "A").geometry as Parameters<typeof areaAndCentroid>[0];
    const { areaKm2, centroid } = areaAndCentroid(g);
    expect(areaKm2).toBeCloseTo(0.81 * 1.1054, 1); // 810 m x 1105 m
    expect(centroid[0]).toBeCloseTo(5.355, 4);
    expect(centroid[1]).toBeCloseTo(LAT0 + 0.005, 4);
  });

  it("subtracts a hole", () => {
    const g = {
      type: "Polygon" as const,
      coordinates: [
        [[5.35, LAT0], [5.36, LAT0], [5.36, LAT0 + 0.01], [5.35, LAT0 + 0.01], [5.35, LAT0]],
        [[5.353, LAT0 + 0.003], [5.353, LAT0 + 0.007], [5.357, LAT0 + 0.007], [5.357, LAT0 + 0.003], [5.353, LAT0 + 0.003]],
      ],
    };
    const full = areaAndCentroid({ type: "Polygon", coordinates: [g.coordinates[0]!] }).areaKm2;
    expect(areaAndCentroid(g).areaKm2).toBeCloseTo(full * (1 - (0.004 * 0.004) / (0.01 * 0.01)), 3);
  });
});

describe("building the zones from the data", () => {
  it("gives each object to the zone it lies in, and counts the street per zone", () => {
    const zones = build([streetA(), way("w2", {}, [[5.362, LAT0 + 0.005], [5.364, LAT0 + 0.005]])]);
    expect(zoneOf(zones, "A").streetKm).toBeCloseTo(0.405, 1);
    expect(zoneOf(zones, "B").streetKm).toBeCloseTo(0.162, 1);
    expect(zoneOf(zones, "A").values.poverty).toBe(30);
    expect(zoneOf(zones, "A").sources.poverty).toBe("official");
  });

  it("leaves trails out of the street network", () => {
    const zones = build([streetA(), way("t", { highway: "path", name: "Sentier des Douaniers" }, [[5.352, LAT0 + 0.002], [5.357, LAT0 + 0.002]])]);
    expect(zoneOf(zones, "A").streetKm).toBeCloseTo(0.405, 1);
  });

  it("densities are per km of street and left out when there is too little street", () => {
    const bench = (dx: number) => node(...inA(dx, 0.006), { amenity: "bench" });
    const zones = build([streetA(), bench(0.002), bench(0.003)]);
    expect(zoneOf(zones, "A").values.rest).toBeCloseTo(2 / 0.405, 0);
    expect(zoneOf(zones, "A").sources.rest).toBe("osm");
    // zone B has no street at all: no density, so no data (not 0 benches per km)
    expect(zoneOf(zones, "B").values.rest).toBeUndefined();
    // and with the shipped minimum of one kilometre, a 400 m street is too little
    expect(zoneOf(build([streetA(), bench(0.002)], {}, config), "A").values.rest).toBeUndefined();
  });

  it("sorts citizen reports into kinds and counts them per km of street", () => {
    expect(reportKind("Stationnement gênant fréquent", config)).toBe("parking");
    expect(reportKind("Trottoir étroit ou absent", config)).toBe("narrow");
    expect(reportKind("Chantier/péril", config)).toBe("works");
    expect(reportKind("Encombrants fréquents", config)).toBe("works");
    expect(reportKind("Terrasses, mobilier", config)).toBe("furniture");
    expect(reportKind("Autre", config)).toBe("other");
    expect(reportKind("", config)).toBe("other");
    const reports = [
      { lon: 5.353, lat: LAT0 + 0.004, type: "Stationnement gênant fréquent" },
      { lon: 5.354, lat: LAT0 + 0.004, type: "Stationnement gênant fréquent" },
      { lon: 5.355, lat: LAT0 + 0.004, type: "Trottoir étroit ou absent" },
      { lon: 5.50, lat: LAT0, type: "Stationnement gênant fréquent" }, // in no zone
    ];
    const a = zoneOf(build([streetA()], { reports }), "A");
    expect(a.values.parkingReports).toBeCloseTo(2 / 0.405, 0);
    expect(a.values.narrowReports).toBeCloseTo(1 / 0.405, 0);
    expect(a.sources.parkingReports).toBe("reported");
    expect(a.counts.reportsParking).toBe(2);
    expect(zoneOf(build([streetA()], {}), "A").values.parkingReports).toBeUndefined(); // no reports file: no data
  });

  it("counts steps with no ramp, but not steps with one", () => {
    const flight = (id: string, tags: Record<string, string>) => way(id, { highway: "steps", ...tags }, [[5.353, LAT0 + 0.002], [5.3531, LAT0 + 0.002]]);
    const a = zoneOf(build([streetA(), flight("s1", {}), flight("s2", { ramp: "yes" })]), "A");
    expect(a.counts.steps).toBe(1);
  });

  it("crossings: the share without lights or tactile paving", () => {
    const c = (tags: Record<string, string>) => node(...inA(0.003, 0.004), { highway: "crossing", ...tags });
    const a = zoneOf(build([streetA(), c({ crossing: "traffic_signals" }), c({ tactile_paving: "yes" }), c({ crossing: "marked" }), c({})]), "A");
    expect(a.values.crossings).toBeCloseTo(0.5, 6);
    expect(zoneOf(build([streetA()]), "A").values.crossings).toBeUndefined();
  });

  it("free versus private places, and a paying toilet is not free", () => {
    const places = [node(...inA(0.002, 0.003), { amenity: "bench" }), node(...inA(0.003, 0.003), { amenity: "cafe" }), node(...inA(0.004, 0.003), { amenity: "toilets", fee: "yes" })];
    expect(zoneOf(build([streetA(), ...places]), "A").values.publicPrivate).toBeCloseTo(0.5, 6);
  });

  it("co-presence needs enough tagged widths, and counts the narrow ones", () => {
    const w = (id: string, width: string) => way(id, { width }, [[5.352, LAT0 + 0.003], [5.353, LAT0 + 0.003]]);
    expect(zoneOf(build([w("a", "1.2")]), "A").values.coPresence).toBeUndefined(); // one tagged way is not enough (minimum 2 in the test config)
    const a = zoneOf(build([w("a", "1.2"), w("b", "2"), w("c", "1.0"), w("d", "1.8")]), "A");
    expect(a.values.coPresence).toBeCloseTo(0.5, 6); // two of four narrower than 1.5 m
  });

  it("noise is the mean of the official map over the zone, and below-map areas read as below the threshold", () => {
    const band = { type: "Feature" as const, properties: { isophone: 65 }, geometry: { type: "Polygon" as const, coordinates: [[[5.35, LAT0], [5.355, LAT0], [5.355, LAT0 + 0.01], [5.35, LAT0 + 0.01], [5.35, LAT0]]] } };
    const noiseIndex = buildNoiseIndex(fc([band]));
    const zones = build([streetA()], { noiseIndex });
    // half of zone A is in the 65 dB band (67.5 dB), the other half below the map (52.5 dB)
    expect(zoneOf(zones, "A").values.noise).toBeCloseTo((67.5 + 52.5) / 2, 0);
    expect(zoneOf(zones, "B").values.noise).toBeCloseTo(52.5, 6);
    expect(zoneOf(zones, "A").sources.noise).toBe("official");
  });

  it("transit counts the MODES with a stop in the zone, and the co-participation share is the area outside every device", () => {
    const amp = buildAmpIndex({
      transit: [
        { lon: 5.352, lat: LAT0 + 0.002, mode: "bus" },
        { lon: 5.353, lat: LAT0 + 0.002, mode: "bus" },
        { lon: 5.354, lat: LAT0 + 0.002, mode: "tram" },
      ],
      qpv: fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[5.35, LAT0], [5.355, LAT0], [5.355, LAT0 + 0.01], [5.35, LAT0 + 0.01], [5.35, LAT0]]] } }]),
    });
    const zones = build([streetA()], { amp });
    expect(zoneOf(zones, "A").values.transit).toBe(2);
    expect(zoneOf(zones, "B").values.transit).toBe(0);
    expect(zoneOf(zones, "A").values.participation).toBeCloseTo(config.autoData.participation.outsideBarrier * 0.5, 1);
    expect(zoneOf(zones, "B").values.participation).toBeCloseTo(config.autoData.participation.outsideBarrier, 6);
  });

  it("infoCentres and civic: distance from the centre of the zone", () => {
    const zones = build([streetA(), node(5.355, LAT0 + 0.005 + 0.009, { amenity: "townhall" })]);
    expect(zoneOf(zones, "A").values.civic).toBeGreaterThan(900);
    expect(zoneOf(zones, "A").values.civic).toBeLessThan(1100);
    expect(zoneOf(build([streetA()]), "A").values.civic).toBeUndefined();
  });
});

describe("slope from the altitude grid", () => {
  it("is the mean slope between neighbouring grid points of a zone", () => {
    const zones = build([streetA()]);
    const points = terrainPoints(ZONES, config);
    expect(points.length).toBeGreaterThan(10);
    // a tilted plane: 10 m of rise per 200 m eastwards = 5 %
    const altitudes = Object.fromEntries(points.map((p) => [`${p[0].toFixed(6)},${p[1].toFixed(6)}`, (p[0] * 81_000 / 200) * 10]));
    const a = zoneOf(withSlope(zones, ZONES, altitudes, config), "A");
    // East neighbours rise 5 %, north neighbours 0 %: the mean sits between, nearer 2.5 % (a few more
    // north pairs than east pairs in a tall zone pull it a little below).
    expect(a.values.slope).toBeGreaterThan(2.2);
    expect(a.values.slope).toBeLessThan(2.6);
    expect(a.sources.slope).toBe("official");
    expect(zoneOf(withSlope(zones, ZONES, {}, config), "A").values.slope).toBeUndefined();
  });
});

describe("dimension scores, ranking and export", () => {
  const z = (id: string, areaKm2: number, values: Record<string, number>): Zone =>
    ({ id, name: id, zoneType: "habitat", arrondissement: "Marseille 1er Arrondissement", geometry: { type: "Polygon", coordinates: [] }, areaKm2, centroid: [0, 0], streetKm: 2, households: 0, values, sources: Object.fromEntries(Object.keys(values).map((k) => [k, "osm" as const])), counts: {} });
  const zs = [z("a", 3, { slope: 4 }), z("b", 1, { slope: 12 }), z("c", 5, {})];
  const scores = Object.fromEntries(zs.map((x) => [x.id, scoreAllProfiles(x, config)["wheelchair"]!]));

  it("a dimension score is the area-weighted mean over the zones that have data", () => {
    const d = dimensionScores(zs, scores);
    expect(d.physical.score).toBeCloseTo((3 * 1 + 1 * 0) / 4, 6);
    expect(d.physical.coverage).toBeCloseTo(4 / 9, 6);
    expect(d.political.score).toBeNull();
  });

  it("ranks the lowest scores first and never ranks a zone with no score", () => {
    const ranking = rankZones(zs, scores, config);
    expect(ranking.map((r) => r.zone.id)).toEqual(["b", "a"]);
    expect(ranking[0]!.rank).toBe(1);
    expect(ranking[0]!.drivers[0]!.indicator).toBe("slope");
    expect(ranking[0]!.summary).toMatch(/Cause principale : pente moyenne/);
  });

  it("ranks only the zones where people live", () => {
    const park = { ...z("park", 4, { slope: 12 }), zoneType: "divers" as const };
    const all = [...zs, park];
    const sc = Object.fromEntries(all.map((x) => [x.id, scoreAllProfiles(x, config)["wheelchair"]!]));
    expect(rankZones(all, sc, config).map((r) => r.zone.id)).toEqual(["b", "a"]); // the park scores worst but is not ranked
  });

  it("exports every indicator with its source, and the score of every profile", () => {
    const [f] = zonesToGeojson([zs[0]!], config).features;
    expect(f!.properties!.v_slope).toBe(4);
    expect(f!.properties!.src_slope).toBe("osm");
    expect(Object.keys(f!.properties!)).toEqual(expect.arrayContaining(["score_wheelchair", "score_blind", "score_allophone", "score_low_income", "dim_physical", "dim_political"]));
  });
});
