# Document de passation - TPFE MJSL Marseille
**Date de creation : 26 juin 2026**
**A utiliser pour reprendre le travail avec un autre assistant IA.**

---

## Contexte du projet

Tu travailles sur un TPFE de 6eme annee en architecture a l'Ecole Nationale d'Architecture de Rabat (ENA Rabat). Le sujet porte sur Marseille et specifiquement son littoral du Vieux-Port jusqu'a la fin de la Corniche Kennedy, en passant par Malmousque et le Vallon des Auffes.

Le concept central est la **Matrice de Justice Spatiale Littorale (MJSL)** : un outil de diagnostic en 6 dimensions qui permet de lire l'exclusion spatiale sur le littoral marseillais, non pas comme une serie de non-conformites techniques, mais comme un systeme qui hiérarchise implicitement les corps et les presences admis sur le littoral.

---

## Les 3 terrains d'etude

1. **Vieux-Port** (point de depart)
2. **Vallon des Auffes** + **Malmousque** (secteur pilote)
3. **Corniche Kennedy** jusqu'a la **Statue de David** (fin du trace)

Lineaire total : environ 5 km le long du littoral marseillais.

---

## Les 6 dimensions de la MJSL

Chaque segment ou point du terrain est evalue sur une echelle **0 a 3** :
- `0` = excluant (bloque, humiliant, impossible)
- `1` = faible (possible seulement avec effort ou aide)
- `2` = acceptable (praticable mais imparfait)
- `3` = capacitant (confortable, digne, ouvert)

| Code | Dimension | Ce qu'elle mesure |
|------|-----------|-------------------|
| D1 | Physique et continuite | Largeur utile, pente, revetement, obstacles, alternatives aux escaliers, repos |
| D2 | Sensorielle et ambiances | Signaletique, contrastes visuels, guidage tactile, bruit, reperes sensoriels |
| D3 | Cognitive et previsibilite | Lisibilite du parcours, reperes stables, zones de retrait, gradation des seuils |
| D4 | Economique et couts | Terrasses payantes, assises gratuites, eau, toilettes, cout de la chaine de deplacement |
| D5 | Sociale et legitimite | Seuils filtrants, surveillance, qualite differenciee, copresence, invisibilisation |
| D6 | Participation democratique | Concertation accessible, information lisible, co-conception, reversibilite |

**Score global** = moyenne des 6 dimensions.

**Classes MJSL** :
- `score < 1.0` : excluant (rouge)
- `score < 2.0` : faible (orange)
- `score < 2.6` : acceptable (jaune)
- `score >= 2.6` : capacitant (vert)

**3 categories d'exclusion interdependantes** :
1. **Fragmentation geometrique/topographique** (D1 ou D2 ou D3 <= 1)
2. **Rupture de la chaine metropolitaine** (D1 <= 1 ET D6 <= 1)
3. **Gentrification, privatisation, invisibilisation** (D4 <= 1 OU D5 <= 1)

---

## Ce qui a ete cree aujourd'hui

Tout est dans le dossier : `C:\Users\Setup Game\Desktop\qgis\mjsl_qgis\`

### Structure complete du dossier

```
mjsl_qgis/
|
|-- README_MJSL_QGIS.md              Guide principal de l'outil
|-- PASSATION_TPFE_MJSL.md           Ce document
|-- ouvrir_webapp_mjsl.bat           Double-cliquer pour lancer l'application web
|-- start_webapp_mjsl.ps1            Serveur local PowerShell (port 8766)
|
|-- data/                            Couches QGIS de depart (7 fichiers GeoJSON)
|   |-- mjsl_segments_cheminement.geojson
|   |-- mjsl_points_rupture.geojson
|   |-- mjsl_amenites_repos.geojson
|   |-- mjsl_ambiances.geojson
|   |-- mjsl_seuils_legitimite.geojson
|   |-- mjsl_transport_metropolitain.geojson
|   |-- mjsl_participation.geojson
|
|-- templates/                       Grilles et formules
|   |-- grille_scoring_mjsl.csv      Grille complete des 6 dimensions (30 criteres)
|   |-- schema_couches_qgis.csv      Structure des couches QGIS
|   |-- fiche_releve_terrain_mjsl.csv  Fiche terrain au format tableur
|   |-- test_pilote_vallon_malmousque.csv  5 sous-segments du test pilote
|   |-- expressions_qgis_mjsl.md     Formules a coller dans QGIS
|
|-- docs/                            Documentation
|   |-- fiche_releve_terrain_mjsl.md  Fiche terrain imprimable
|   |-- test_pilote_vallon_malmousque.md  Protocole du test pilote
|   |-- cartes_synthese_mjsl.md      Comment faire les cartes finales
|   |-- checklist_rendu_tpfe_mjsl.md  Planches a produire pour le TPFE
|
|-- webapp/                          Application web interactive
    |-- index.html                   Page principale (ouvrir dans le navigateur)
    |-- styles.css                   Styles de l'interface
    |-- app.js                       Logique cartographique (690 lignes)
    |-- data.js                      Donnees GeoJSON injectees (autonome)
    |-- README_WEBAPP.md             Mode d'emploi de la webapp
```

---

## Ce que fait l'application web (`webapp/`)

C'est une carte interactive Leaflet qui fonctionne directement dans le navigateur.

**Fonctionnalites implementees :**
- Carte centree sur le littoral marseillais (Vieux-Port a Statue de David)
- Chargement automatique des 7 couches MJSL depuis `data.js` (aucun serveur requis)
- Tentative de chargement fetch depuis les GeoJSON locaux (avec fallback sur data.js)
- Requete OSM/Overpass en ligne pour charger : bancs, escaliers, arrets de bus, toilettes, fontaines, restaurants, cafes, belvederes, traversees
- Import de fichiers GeoJSON ou CSV geolocalises depuis le terrain
- Scoring MJSL calcule cote navigateur (score global + classe + 3 categories)
- Filtres par couche, par dimension (D1 a D6), par classe et par categorie
- Popup de diagnostic au clic sur chaque objet
- Panneau de details avec tous les attributs
- Boutons de zoom rapide vers chaque secteur
- Export GeoJSON enrichi pour reimporter dans QGIS

**Palette de couleurs constante :**
- Rouge = excluant
- Orange = faible
- Jaune = acceptable
- Vert = capacitant
- Bleu pointille = indice OSM a verifier sur terrain

---

## Probleme non resolu a ce jour : le chargement automatique des GeoJSON

**Symptome :** Quand on ouvre `index.html` directement dans le navigateur (sans serveur), le navigateur bloque le chargement des fichiers `.geojson` locaux pour des raisons de securite (politique CORS / same-origin).

**Solution de contournement deja implementee :** Le fichier `webapp/data.js` contient les donnees de toutes les couches injectees directement comme variable JavaScript (`window.MJSL_DATA`). Ce fichier est charge avant `app.js` dans `index.html`.

**Ce qui manque encore :** La fonction `loadMjslData()` dans `app.js` essaie d'abord un `fetch()` qui echoue, mais ne bascule pas encore automatiquement sur `window.MJSL_DATA`. Il faut modifier cette fonction pour qu'elle utilise `window.MJSL_DATA` quand le fetch echoue.

---

## Tache prioritaire a faire (a reprendre en premier)

### Corriger `loadMjslData()` dans `webapp/app.js`

Remplacer la fonction actuelle (lignes 325-350) :

```javascript
async function loadMjslData() {
  setStatus("Chargement des couches MJSL...");
  let loaded = 0;

  for (const dataset of DATASETS) {
    try {
      const response = await fetch(dataset.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const geojson = await response.json();
      addDataset(dataset, geojson);
      loaded += 1;
    } catch (error) {
      console.warn(`Impossible de charger ${dataset.url}`, error);
    }
  }

  renderLayerFilters();
  renderMap();

  if (loaded === 0) {
    setStatus("Chargement automatique bloque. Lance le serveur local ou importe les GeoJSON manuellement.");
  } else {
    setStatus(`${loaded} couches MJSL chargees.`);
    fitAllVisible();
  }
}
```

Par cette version qui utilise `window.MJSL_DATA` en fallback :

```javascript
async function loadMjslData() {
  setStatus("Chargement des couches MJSL...");
  let loaded = 0;

  for (const dataset of DATASETS) {
    // Essayer d'abord fetch (si serveur local disponible)
    let geojson = null;
    try {
      const response = await fetch(dataset.url);
      if (response.ok) {
        geojson = await response.json();
      }
    } catch (_) {
      // fetch bloque par CORS ou navigateur : on utilise les donnees injectees
    }

    // Fallback sur window.MJSL_DATA (data.js)
    if (!geojson && window.MJSL_DATA && window.MJSL_DATA[dataset.key]) {
      geojson = window.MJSL_DATA[dataset.key];
    }

    if (geojson) {
      addDataset(dataset, geojson);
      loaded += 1;
    }
  }

  renderLayerFilters();
  renderMap();

  if (loaded === 0) {
    setStatus("Aucune donnee chargee. Importe un fichier GeoJSON ou CSV manuellement.");
  } else {
    setStatus(`${loaded} couches MJSL chargees.`);
    fitAllVisible();
  }
}
```

Apres cette correction, l'application fonctionnera en ouvrant `webapp/index.html` directement dans le navigateur, sans serveur local, sans PowerShell.

---

## Ce qui reste a faire apres cette correction

### 1. Ajouter de vrais releves terrain
- Remplir les fiches dans `templates/fiche_releve_terrain_mjsl.csv`
- Decouvrir les vrais segments sur le terrain (largeurs, escaliers, bruit...)
- Remplacer les scores indicatifs par les scores reels
- Regenener `webapp/data.js` avec les donnees mises a jour

### 2. Enrichir les couches QGIS
- Ouvrir les `.geojson` du dossier `data/` dans QGIS
- Numeriser les vrais segments de 25 a 50 m sur la Corniche
- Remplir les champs `d1_physique`, `d2_sensoriel`, etc. dans la table attributaire
- Utiliser les formules de `templates/expressions_qgis_mjsl.md` pour calculer automatiquement `score_mjsl` et `classe_mjsl`

### 3. Charger les donnees OSM dans l'application
- Ouvrir `webapp/index.html` dans le navigateur
- Cliquer sur "Charger les indices OSM" (necessite internet)
- Verifier les bancs, escaliers, arrets de bus, restaurants sur le terrain

### 4. Produire les cartes pour le TPFE
Voir `docs/cartes_synthese_mjsl.md` et `docs/checklist_rendu_tpfe_mjsl.md` pour la liste des 8 planches a produire.

---

## Instructions pour le prochain assistant IA

1. **Lire ce document en entier** avant toute action.
2. **Ne pas recreer les fichiers qui existent deja** : toute la structure est en place.
3. **La premiere tache est de corriger `loadMjslData()`** dans `webapp/app.js` (correction donnee ci-dessus).
4. Apres cette correction, **tester en ouvrant `webapp/index.html`** directement dans Brave ou Chrome : les 7 couches MJSL doivent s'afficher automatiquement.
5. Ensuite continuer avec les releves terrain et l'enrichissement des donnees.

---

## Points cles pour le memoire

La **MJSL n'est pas une carte PMR**. Elle croise :
- la continuite physique (escaliers, pentes, revetements)
- les ambiances (bruit, surcharge sensorielle)
- la previsibilite cognitive (reperes, seuils, transitions)
- les couts economiques (terrasses, gratuité du confort)
- la legitimite sociale (seuils filtrants, surveillance, copresence)
- la participation democratique (concertation, information, reversibilite)

Un espace peut etre **techniquement praticable** et rester **injuste** : bruyant, privatisant, socialement filtrant, ou inaccessible depuis les quartiers nord de Marseille.

La MJSL permet de passer du constat au projet : elle **designe les lieux, seuils et chaines a transformer**, ce qui est la base de ta proposition architecturale et urbaine en Partie 03 du memoire.
