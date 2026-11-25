import JSZip from "jszip";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

const ATTRIBUTION = [
  "Donnees OpenStreetMap (c) contributeurs OpenStreetMap, licence ODbL.",
  "Interrogees via Overpass API.",
  "Bruit : carte de bruit routier (Lden), Metropole Aix-Marseille-Provence, Licence Ouverte 2.0 (data.gouv.fr).",
  "Altitudes : IGN RGE ALTI.",
  "Zones, transports, offices de tourisme, QPV et projets urbains : Metropole Aix-Marseille-Provence, Licence Ouverte 2.0.",
  "Revenus et pauvrete : INSEE FiLoSoFi 2021 (IRIS), Licence Ouverte 2.0 ; revenus 2014 en secours.",
  "Loyers observes : Observatoire local des loyers 13 / ADIL13 via Metropole Aix-Marseille-Provence, Licence Ouverte 2.0.",
  "Loyers d'annonce : Carte des loyers 2025, ANIL / ministere de la Transition ecologique, Licence Ouverte 2.0.",
  "Espaces publics : OpenStreetMap (ODbL), methode UN-Habitat 11.7.1.",
  "Signalements des habitants : \"Galere pietons\" (Marsactu) ; licence de reutilisation a verifier.",
];

const README = `MJSL - export

zones.geojson  Les zones de Marseille (IRIS) avec chaque indicateur, sa source, et le score
               de chaque profil et de chaque dimension.

Tout est calcule automatiquement a partir de donnees ouvertes. Les seuils sont
des valeurs de depart, a confirmer sur le terrain.

${ATTRIBUTION.join("\n")}
`;

/** One archive with the scored zones and the attribution. */
export async function buildArchive(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  zip.file("LISEZ-MOI.txt", README);
  return zip.generateAsync({ type: "blob" });
}
