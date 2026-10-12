# MJSL

An accessibility map of Marseille built on the **Matrice de Justice Spatiale Littorale**
(MJSL): every zone of the city (the 393 IRIS) is scored on six dimensions (physical,
sensory, cognitive, economic, social, political) for four kinds of people, entirely from
open data (OpenStreetMap, the Aix-Marseille-Provence Metropole, the official noise map,
IGN altitudes) plus citizens' reports.

Developed for a TPFE (final-year architecture thesis, ENA Rabat). The app is in French.

## Quick start

```bash
cd mjsl
npm ci
npm run dev
```

Then open http://localhost:5173. Requires Node 22. All datasets are committed under
`mjsl/public/data/`, so nothing else needs downloading.

## Where to look

| | |
|---|---|
| [`doc/DEVELOPER_GUIDE.md`](doc/DEVELOPER_GUIDE.md) | **Start here if you will work on the code**: architecture, scoring model, data, recipes, pitfalls |
| [`doc/SCORING_MATH.md`](doc/SCORING_MATH.md) | The mathematics of the score, formula by formula, with a worked example |
| [`mjsl/README.md`](mjsl/README.md) | What the app shows and how to use it (French) |
| [`mjsl/src/domain/zone/zone.config.json`](mjsl/src/domain/zone/zone.config.json) | Every threshold, weight and profile: the file to edit to tune the scores |
| [`doc/research/`](doc/research/) | The research behind the method: the hand-over note (French) |

## Deployment

Pushing to `main` tests, builds and publishes `mjsl/` to GitHub Pages
(`.github/workflows/static.yml`).

## Licence and data

Code: CC0 1.0 (public domain), see [`LICENSE`](LICENSE). Data: OpenStreetMap contributors (ODbL); Metropole
Aix-Marseille-Provence (Licence Ouverte 2.0); IGN RGE ALTI; "Galere pietons" (Marsactu),
reuse licence to be confirmed.
