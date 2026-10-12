/**
 * The six dimensions of the Matrice de Justice Spatiale Littorale.
 *
 * The keys are the code's names; `mjslCode` ties each one back to the D1..D6 codes of
 * the memoire (doc/research/), so the two vocabularies stay reconcilable. The order is
 * the memoire's, and is the order used everywhere a list of dimensions is shown.
 */
export const DIMENSIONS = [
  {
    key: "physical",
    mjslCode: "D1",
    label: "Physique et continuite",
    colour: "#9e2f2f",
  },
  {
    key: "sensory",
    mjslCode: "D2",
    label: "Sensorielle et ambiances",
    colour: "#d9822b",
  },
  {
    key: "cognitive",
    mjslCode: "D3",
    label: "Cognitive et previsibilite",
    colour: "#d7b84f",
  },
  {
    key: "economic",
    mjslCode: "D4",
    label: "Economique et couts",
    colour: "#3c8b5a",
  },
  {
    key: "socio_cultural",
    mjslCode: "D5",
    label: "Sociale et legitimite",
    colour: "#277da1",
  },
  {
    key: "political",
    mjslCode: "D6",
    label: "Participation democratique",
    colour: "#6a4c93",
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
