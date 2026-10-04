/**
 * The six dimensions of the Matrice de Justice Spatiale Littorale.
 *
 * The keys are the spec's generic names; `mjslCode` ties each one back to the
 * D1..D6 codes used throughout doc/ and the QGIS layers, so the two vocabularies
 * stay reconcilable.
 */
export const DIMENSIONS = [
  {
    key: "physical",
    mjslCode: "D1",
    label: "Physique et continuite",
    colour: "#9e2f2f",
    icon: "steps",
    description: "Largeur utile, pente, revetement, obstacles, alternatives aux escaliers, repos.",
    hints: "Gradients, largeurs, obstacles, revetements, bordures, portes, transferts.",
  },
  {
    key: "sensory",
    mjslCode: "D2",
    label: "Sensorielle et ambiances",
    colour: "#d9822b",
    icon: "ear",
    description: "Signaletique, contrastes visuels, guidage tactile, bruit, reperes sensoriels.",
    hints: "Eclairage, contraste, guidage tactile, bruit, lisibilite de la signaletique, indices sonores.",
  },
  {
    key: "cognitive",
    mjslCode: "D3",
    label: "Cognitive et previsibilite",
    colour: "#d7b84f",
    icon: "compass",
    description: "Lisibilite du parcours, reperes stables, zones de retrait, gradation des seuils.",
    hints: "Clarte du guidage, previsibilite, densite d'information, charge linguistique.",
  },
  {
    key: "economic",
    mjslCode: "D4",
    label: "Economique et couts",
    colour: "#3c8b5a",
    icon: "coin",
    description: "Terrasses payantes, assises gratuites, eau, toilettes, cout de la chaine de deplacement.",
    hints: "Tarifs, droits d'entree, acces conditionne a l'achat, distance comme cout, horaires vs travail poste.",
  },
  {
    key: "socio_cultural",
    mjslCode: "D5",
    label: "Sociale et legitimite",
    colour: "#277da1",
    icon: "people",
    description: "Seuils filtrants, surveillance, qualite differenciee, copresence, invisibilisation.",
    hints: "Sentiment de securite, usages genres, stigmatisation, design excluant, qui est present.",
  },
  {
    key: "political",
    mjslCode: "D6",
    label: "Participation democratique",
    colour: "#6a4c93",
    icon: "megaphone",
    description: "Concertation accessible, information lisible, co-conception, reversibilite.",
    hints: "Qui decide, canaux de participation, application des droits, espace conteste ou securise.",
  },
] as const;

export type Dimension = (typeof DIMENSIONS)[number]["key"];

export const DIMENSION_KEYS: readonly Dimension[] = DIMENSIONS.map((d) => d.key);

const BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));

export function dimension(key: Dimension) {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`Unknown dimension: ${key}`);
  return found;
}
