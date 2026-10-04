# MJSL Atlas

A local-first web app for the Matrice de Justice Spatiale Littorale: import or
capture accessibility evidence for the Marseille littoral, score it across six
dimensions, and surface the corridors that need it most.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 109 tests
npm run typecheck
npm run build       # tsc --noEmit + production bundle
npm run demo        # headless CLI report on the scoring engine, no browser
```

## What's built (all 8 steps of the original plan)

1. **Domain model + scoring engine** (`src/domain/`) — pure, no UI, no network.
   H3 cell assignment with distance decay, per-dimension weighted means,
   rupture ceilings/penalties, confidence, red-zone detection.
2. **Map shell** — MapLibre GL JS, two open raster basemaps, one Overpass
   preset (steps/elevators/kerbs/tactile paving), cached in IndexedDB.
3. **Import + rating + persistence** — GeoJSON and CSV import with a mapping
   wizard, click-to-drop points, a rating form driven by `rubric.json`,
   everything persisted in IndexedDB with undoable deletes.
4. **Photos** — EXIF-derived GPS/time/bearing, manual placement when EXIF is
   missing, thumbnails, a lightbox, EXIF stripped on export.
5. **Rupture points** — a distinct capture flow for hard blocks vs. friction,
   with the scoring consequence stated in plain language as you edit it.
6. **Aggregation on the map** — H3 choropleth (global score or any one
   dimension), both aggregation modes exposed as a toggle, red zones dissolved
   and ranked, a cell inspector showing the full breakdown.
7. **Dashboard + export** — synthesis tiles, per-dimension bar chart, score
   histogram, ranked red-zone table, rupture inventory, and export as a full
   `.zip` (round-trippable `project.json`, CSV, GeoJSON for QGIS) or any file
   on its own.
8. **Accessibility** — audited with axe-core (0 violations across all three
   views and the lightbox); contrast measured directly, WCAG 2.2 target sizes
   fixed globally, layout reflows at 320px.

Plus, after the 8 steps: **CSV import** (`src/app/import/parseCsv.ts`), closing
a gap the GeoJSON-only wizard left — a spreadsheet is how a field survey
actually gets filled in.

## Settings in force

| Knob | Value | Why |
|---|---|---|
| Rating scale | 0–3, configurable | Keeps `grille_scoring_mjsl.csv`, the QGIS expressions and the mémoire valid. 0–5 is one config change in `src/domain/config.ts`. |
| H3 resolution | 10 (~76 m edge) | The MJSL protocol asks for 25–50 m segments; res 9 (~170 m) would swallow whole sequences of the Corniche. |
| Global mode | `weakest_link` by default, `weighted_average` available | Exposed as a toggle in the Analyse panel, not buried in config — which one you use is an argument about what counts as accessible. |
| Red-zone threshold | 2.0 | Starting point, not a truth. |
| Contributors | single-author | No auth, no roles, no conflict resolution. |
| Palette | viridis, not the MJSL red/orange/yellow/green | That ramp is red-green, the pair most colour-blind readers can't separate; viridis is also monotonic in luminance, so a greyscale planche still reads. One constant in `src/app/analysis/palette.ts` reverts it. |

## Rules the tests pin down

- **Absence of data is never a bad score.** An unrated dimension stays `null`
  and is excluded from the global score, rather than counting as zero.
- **Recency reads `observedAt` only**, never `createdAt`. An import's
  typed-in date is not an observation date; falling back to it let undated
  evidence score as fresh.
- **A hard block dominates.** Rupture ceilings apply *after* the weighted
  mean, not as one more sample inside it.
- **Confidence is separate from score**, and depends on source diversity and
  recency, not just count. A single-source, undated batch is mathematically
  capped below the default confidence threshold (0.25) no matter how many
  points it has — measured directly against the 1393-point
  `data/raw/signalements_voirie_marseille.geojson` import: 0 sufficient cells
  and 0 red zones until it's given a date, then 225 cells and 97 zones.
- **Disagreement is shown, not smoothed.** Every dimension carries `min`/`max`
  and per-observation `share`.

## Severity direction

`RupturePoint.severity` runs 0..scaleMax with **higher meaning worse**, matching
the `gravite` column already in `mjsl_points_rupture`, not the build spec's
score-like reading. The conversion to a ceiling happens in
`domain/scoring/ruptures.ts`.

## Data

- `../site/data/*.geojson` — the seven scored MJSL layers (single source of
  truth; `src/app/import/mjslLayers.ts` reads them at build time, not a copy).
  All 14 features are currently placeholders with empty `date_obs`.
- `data/raw/` — external datasets, not MJSL-scored. Currently one: 1393
  citizen-reported street issues across Marseille (see its README for the
  category breakdown and why it produces zero red zones as imported).
- `data/templates/fiche_releve_terrain.csv` — a fillable field-survey template
  matching the current schema, importable as-is via the CSV path.

No field survey data exists yet beyond what's listed above. Everything the
scoring engine and dashboard show right now is either empty (correctly, for
lack of evidence) or built on scores invented for demonstration during
development — not real assessments.

## Known approximations

- Polygon → cell assignment uses `polygonToCells` (cell centres inside the
  ring) with a centroid fallback, not exact turf intersection areas. Good to
  about one cell at the boundary.
- The red-zone severity index has no population term.
- `LAYER_FIELD_DIMENSIONS` in `mjsl/import.ts` is an interpretation of which
  legacy score column feeds which dimension. Needs checking against the
  mémoire.

## Not verified

**MapLibre rendering has never been confirmed working.** The environment used
to build this could not run MapLibre's worker/geojson pipeline — a bare test
map with two hardcoded points also failed to fire `load` there. Data flow into
every map source is verified (console-inspected, not eyeballed); the actual
pixels — the OSM overlay, the choropleth, red-zone outlines, map clicks — are
not. Open `npm run dev` in Chrome, Firefox or Edge and look before trusting it.

## Decided against, for now

- **Line/polygon drawing on the map.** Only point-click capture exists; lines
  and polygons still come in via import. Revisit once a real survey is
  underway and someone wants to trace a segment by hand.
- **Photo clustering.** With a handful of test photos, there's no crowding
  problem yet to solve.
- KML, GPX and shapefile import remain unsupported (GeoJSON and CSV only).

## Walkway profiles (per-segment scoring by type of person)

A second, separate score next to the H3 cell scoring above: each stretch of walkway
gets a score per profile (wheelchair user, blind person, ...). Code in
`src/domain/walkway/`, panel in `src/app/walkway/`.

- **Change numbers in ONE file:** `src/domain/walkway/walkway.config.json`
  (thresholds, weights, surface table, vetoes, noise-estimate rule, colour classes).
  It is checked when the app starts, with plain-language errors (e.g. "weights add up to 1.2").
  To add a profile (elderly, stroller, ...) copy a block in `profiles` — see `_howToAddProfile`.
- **Score:** barriers 0..1 per indicator, averaged per dimension over the indicators that
  have data, then `score = 0 if a veto applies, else product of (1 - barrier)^weight`.
  A missing value is left out (weights rescaled), never counted as 0; a segment with
  nothing to score is "no data", not 1.
- **Route:** weakest segment on the shortest path; vetoed segments are removed to find a
  detour and its extra length. **What-if:** `whatIf(segments, changes, config, route?)`.
- **Data:** loaded on demand from Overpass (`overpass/walkwayPreset.ts`). Width and slope
  are rarely tagged in OSM, so most segments score from the few indicators that exist;
  noise is *estimated* from major roads. The panel lists how much of each indicator is real.
- **Export:** the project `.zip` gains `troncons_scores.geojson` (score, class, veto and the
  source of each indicator) when segments are loaded.
- Tests: `src/domain/walkway/__tests__/` (includes the field worked example).

### Automatic data (nothing to type by hand)

When the walkway segments are loaded, the program fills in the indicators itself and
labels every value with its source (`measured` / `osm` / `official` / `estimated`):

| Indicator | Filled in from | Notes |
|---|---|---|
| Noise | Official road-noise map (Lden 24 h, Metropole Aix-Marseille-Provence, Licence Ouverte 2.0), shipped trimmed in `public/data/noise_lden_road.geojson` | Where the map has no band for a segment but a major road is within `gapFallbackRoadM`, the road-distance estimate is used and labelled `estimated`: the map has gaps along parts of the Corniche. A 24 h average, not a midday dB(A). |
| Slope | IGN altimetry (RGE ALTI, free, no key) at the two ends of each segment | Segments under 20 m, and steps, stay "no data". Altitudes are cached for good in IndexedDB, so only the first load calls IGN. |
| Width | OSM `width` tag, else a typical value per kind of path (`autoData.widthDefaults`) | The default is a guess: labelled `estimated`, and it can lower a score but **never** trigger the width veto. |
| Rest, economic, surface | OSM | Benches and terraces/parking must exist in the loaded data. |

A value you measure yourself always wins over all of these. Refresh the noise file with
`npm run data:noise`. All of these settings are in `walkway.config.json` under `autoData`.
