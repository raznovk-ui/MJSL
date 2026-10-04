import JSZip from "jszip";
import type { RedZone } from "../../domain/scoring/redzones.js";
import type { ScoringConfig } from "../../domain/config.js";
import type { Observation, RupturePoint } from "../../domain/types.js";
import type { StoredPhoto } from "../persistence/db.js";
import { stripExif } from "../photos/image.js";
import {
  ATTRIBUTION,
  buildProject,
  observationsCsv,
  redZonesGeojson,
  toGeojson,
} from "./project.js";

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

const README = `Atlas MJSL - export de projet

project.json      Projet complet, reimportable dans l'application.
observations.csv  Une ligne par observation, une colonne par dimension.
mjsl.geojson      Observations et ruptures, pretes pour QGIS.
zones_rouges.geojson  Zones rouges dissoutes et classees.
photos/           Images re-encodees SANS metadonnees EXIF.

Les notes sont des jugements situes, pas des mesures. Chaque agregat doit etre
lu avec sa confiance : une cellule grise n'est pas une mauvaise note, c'est une
cellule sans releve suffisant.

${ATTRIBUTION.join("\n")}
`;

export interface ExportInput {
  config: ScoringConfig;
  observations: Observation[];
  ruptures: RupturePoint[];
  redZones: RedZone[];
  photos: StoredPhoto[];
  /** Photos are re-encoded without EXIF unless the user opts out. */
  keepExif?: boolean;
  /** Extra text files to add as-is, by file name (e.g. the scored walkway segments). */
  extraFiles?: Record<string, string>;
}

/**
 * One archive with everything. Photos are re-encoded through a canvas by
 * default, which discards the location and time embedded by the camera: an
 * export leaves the machine, and a street photo carries people.
 */
export async function buildArchive(input: ExportInput): Promise<Blob> {
  const zip = new JSZip();

  zip.file(
    "project.json",
    JSON.stringify(
      buildProject({
        config: input.config,
        observations: input.observations,
        ruptures: input.ruptures,
        photoIds: input.photos.map((p) => p.id),
      }),
      null,
      2,
    ),
  );
  zip.file("observations.csv", observationsCsv(input.observations));
  zip.file("mjsl.geojson", JSON.stringify(toGeojson(input.observations, input.ruptures), null, 2));
  zip.file("zones_rouges.geojson", JSON.stringify(redZonesGeojson(input.redZones), null, 2));
  zip.file("LISEZ-MOI.txt", README);
  for (const [name, content] of Object.entries(input.extraFiles ?? {})) zip.file(name, content);

  const folder = zip.folder("photos");
  for (const photo of input.photos) {
    try {
      const bytes = input.keepExif ? photo.original : await stripExif(photo.original);
      const name = input.keepExif ? photo.filename : photo.filename.replace(/\.[^.]+$/, "") + ".jpg";
      folder?.file(`${photo.id}-${name}`, bytes);
    } catch (error) {
      // A single unreadable image must not lose the rest of the export.
      console.warn(`Photo non exportee : ${photo.filename}`, error);
    }
  }

  return zip.generateAsync({ type: "blob" });
}
