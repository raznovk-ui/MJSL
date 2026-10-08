# Atlas MJSL

Carte d'accessibilite de Marseille, **par zone**. Aucune saisie : tout est calcule
automatiquement a partir de donnees ouvertes, au demarrage.

## Ce que fait l'application

1. **Les zones** : tous les IRIS de Marseille (393, plus petite unite statistique
   officielle, qui couvrent toute la terre de la commune, parcs et Calanques compris),
   taillees a la terre avec les contours des arrondissements ; donnees ouvertes de la Metropole Aix-Marseille-Provence.
2. **Chaque zone recoit ses indicateurs**, comptes automatiquement a partir de :
   - OpenStreetMap (rues, bancs, escaliers, passages pietons, abris, commerces...),
   - les **signalements des habitants** (« Galere pietons », 1393 points : stationnement
     genant, trottoir etroit ou absent, chantiers, encombrants, terrasses),
   - la carte de bruit officielle, les altitudes IGN (pente), les transports en commun,
     les offices de tourisme, la pauvrete des menages (IRIS), les quartiers prioritaires
     et les perimetres de projets urbains.
   Chaque valeur garde sa source (OSM, officiel, signalements). Une donnee absente est
   ignoree, jamais comptee comme 0. Les densites sont par km de rue.
3. **Six dimensions** (celles du memoire) : physique, sensorielle, cognitive, economique,
   sociale, politique. Chaque indicateur devient un obstacle de 0 a 1 ; chaque dimension
   en fait la moyenne ; le score d'une zone pour un profil est le produit des
   (1 − obstacle) ponderes. Quatre profils : mobilite reduite, malvoyant·e ou
   neurodivergent·e, allophone, faibles revenus.
4. **La carte** montre une couche par dimension, plus le score combine, sur une meme
   echelle vert → rouge. Les zones rouges ont un contour pointille (la couleur n'est
   jamais le seul indice). Un clic sur une zone detaille chaque etape du calcul.
5. **Zones prioritaires** : les zones au score le plus bas pour le profil choisi, avec
   leur cause principale. L'onglet Tableau liste toutes les zones, l'onglet Analyse
   donne la synthese de la ville et l'export (GeoJSON, zip).

Tous les seuils et poids sont dans `src/domain/zone/zone.config.json`.

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build && npm run preview
```

## Donnees (a preparer une fois)

```bash
npm run data:zones     # zones (taillees a la cote), transports, offices de tourisme, QPV, projets
npm run data:reports   # signalements des habitants -> public/data/reports.json
npm run data:noise     # carte de bruit officielle
npm run data:osm       # OpenStreetMap, copie locale (10 a 30 min, reprenable)
```

L'application lit d'abord ces fichiers dans `public/data/` ; elle ne contacte Overpass que
si la copie OSM manque, ou si on clique « Rafraichir depuis Overpass ». Pour une
presentation, lance `npm run build && npm run preview` et ouvre l'app une fois en ligne
avant (les altitudes IGN sont mises en cache dans le navigateur).

## Limites

- Les seuils sont des valeurs de depart, calibrees sur la repartition des zones de
  Marseille : les couleurs disent « pire que la plupart de la ville », pas « inutilisable ».
- La pauvrete decrit la zone, pas ses rues. Les indicateurs cognitifs, sociaux et
  politiques sont des approximations tirees de donnees ouvertes.
- Les signalements sont un echantillon de signalements d'habitants, pas un recensement.

## Sources

OpenStreetMap (ODbL) via Overpass · Metropole Aix-Marseille-Provence, Licence Ouverte 2.0
(zones et revenus IRIS, bruit, transports, QPV, projets, offices de tourisme) · IGN RGE ALTI ·
« Galere pietons » (Marsactu), licence de reutilisation a verifier.
