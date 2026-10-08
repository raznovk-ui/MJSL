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

export const ATTRIBUTION = [
  "Donnees OpenStreetMap (c) contributeurs OpenStreetMap, licence ODbL.",
  "Interrogees via Overpass API.",
  "Bruit : carte de bruit routier (Lden), Metropole Aix-Marseille-Provence, Licence Ouverte 2.0 (data.gouv.fr).",
  "Altitudes : IGN RGE ALTI.",
  "Zones, revenus et pauvrete (IRIS 2014), transports, offices de tourisme, QPV et projets urbains : Metropole Aix-Marseille-Provence, Licence Ouverte 2.0.",
  "Signalements des habitants : \"Galere pietons\" (Marsactu) ; licence de reutilisation a verifier.",
];

const README = `Atlas MJSL - export

zones.geojson  Les zones de Marseille (IRIS) avec chaque indicateur, sa source, et le score
               de chaque profil et de chaque dimension.

Tout est calcule automatiquement a partir de donnees ouvertes. Les valeurs
marquees "estimees" sont des hypotheses, a confirmer sur le terrain.

${ATTRIBUTION.join("\n")}
`;

/** One archive with the scored zones and the attribution. */
export async function buildArchive(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  zip.file("LISEZ-MOI.txt", README);
  return zip.generateAsync({ type: "blob" });
}
