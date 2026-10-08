# Donnees brutes externes

Ce dossier contient des jeux de donnees externes, non produits par l'application,
distincts des couches MJSL deja notees dans `../../site/data/`.

## signalements_voirie_marseille.geojson

1393 signalements citoyens ponctuels sur la voirie marseillaise (les 16
arrondissements, pas seulement le corridor MJSL Vieux-Port -> Statue de David).

Champs : `name` (identifiant), `Types` (categorie), `Texte` (description libre),
`codepostal`, `adresse`, `arr` (arrondissement), `X_oum_location_image`.

Categories et correspondance indicative avec les dimensions MJSL :

| Types                          | Nombre | Dimension MJSL indicative |
|---------------------------------|-------:|---------------------------|
| Stationnement genant frequent    |    531 | D1 physique (obstruction) |
| Trottoir etroit ou absent        |    392 | D1 physique               |
| Autre                            |    248 | -                         |
| Chantier/peril                   |     79 | D1 physique               |
| Encombrants frequents             |     69 | D1/D2                     |
| Terrasses, mobilier               |     67 | D1/D4 (privatisation)     |
| (vide)                           |      7 | -                         |

Ce n'est PAS un fichier note MJSL (pas de champs `d1_physique`..`d6_democratique`,
pas de `score_mjsl`) : c'est un signalement brut, une seule categorie par point,
sans note 0-3. Il est lu par `npm run data:reports` (`scripts/prepareReports.mjs`), qui en tire
`public/data/reports.json` ; l'application compte ensuite les signalements par zone
et par type (stationnement, trottoir etroit, chantier/encombrants, terrasses).
Source : « Galere pietons » (Marsactu) ; licence de reutilisation a verifier.

## Comment l'utiliser dans l'atlas

Le fichier est un GeoJSON standard (EPSG:4326, points) : il s'importe tel quel
via l'assistant d'import de l'application (`npm run dev` -> panneau "Import" ->
"Importer un fichier GeoJSON"), qui propose alors de mapper `Types`/`Texte` sur
titre/description et d'attribuer des notes MJSL en bloc ou au cas par cas.

Aucune notation n'est fournie ici : les scores 0-3 restent un jugement a
produire, pas une conversion automatique du texte libre.
