# Atlas MJSL

Carte d'accessibilite du littoral marseillais. **Aucune saisie** : tout est calcule
automatiquement a partir de donnees ouvertes, au demarrage.

## Ce que fait l'application

1. Charge les cheminements pietons (OpenStreetMap via Overpass, cache 7 jours).
2. Remplit seule les indicateurs : bruit (carte officielle Metropole AMP, estimation
   a defaut), pente (altitudes IGN RGE ALTI), largeur (valeur par defaut estimee).
   Chaque valeur garde sa source : mesure, OSM, officiel ou estime.
3. Note chaque troncon pour deux profils (fauteuil roulant, deficience visuelle) :
   obstacles → dimensions → score, avec blocages eliminatoires.
4. Detecte les **zones prioritaires** (troncons rouges ou bloques, regroupes),
   classees par gravite, avec leur cause et la part de valeurs estimees.
5. Permet de choisir un profil, de tracer un itineraire entre deux points
   (avec detour si bloque) et d'exporter (GeoJSON, zip).

Tous les seuils et poids sont dans `src/domain/walkway/walkway.config.json`.

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
npm run data:noise   # re-telecharge la carte de bruit
npm run data:osm     # prepare les donnees OpenStreetMap (voir ci-dessous)
```

L'ancien outil de saisie (observations, photos, ruptures, cellules H3) a ete retire ;
il reste dans l'historique git.

## Presentation devant un jury : fonctionner sans Overpass

Overpass (le serveur public d'OpenStreetMap) est parfois indisponible. Pour ne pas
en dependre le jour J, prepare une copie des donnees **une fois**, quand il repond :

```bash
npm run data:osm        # 10 a 30 min ; peut etre relance, il reprend ou il s'est arrete
git add public/data     # la copie fait partie du projet
npm run build && npm run preview   # lancer l'app sans serveur de dev
```

L'application lit d'abord `public/data/osm/*.geojson.gz` ; elle ne contacte Overpass que
si ces fichiers manquent, ou si on clique « Rafraichir depuis Overpass ». Les altitudes IGN
sont, elles, mises en cache dans le navigateur apres le premier chargement : ouvre l'app
une fois en ligne avant la presentation.

## Sources

OpenStreetMap (ODbL) via Overpass · Carte de bruit routier, Metropole Aix-Marseille-Provence
(Licence Ouverte 2.0) · IGN RGE ALTI.
