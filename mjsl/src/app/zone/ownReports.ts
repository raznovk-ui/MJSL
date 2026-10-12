import { openDb, REPORTS } from "../persistence/db.js";
import { PolygonIndex, type Report, type Zone } from "../../domain/zone/index.js";

/** A citizen report added on this device. Its id is random, so nothing identifies the person. */
export interface OwnReport extends Report {
  id: string;
  addedAt: string;
}

/** Reads this device's reports. An unreadable store means none, never a failed load. */
export async function readOwnReports(): Promise<OwnReport[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<OwnReport[]>((resolve, reject) => {
      const request = db.transaction(REPORTS, "readonly").objectStore(REPORTS).getAll();
      request.onsuccess = () => resolve(request.result as OwnReport[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  } catch (error) {
    console.warn("Signalements locaux illisibles.", error);
    return [];
  }
}

/** Replaces the device's reports with `list`. If storage is unavailable they are simply not kept. */
export async function writeOwnReports(list: OwnReport[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(REPORTS, "readwrite");
      const store = transaction.objectStore(REPORTS);
      store.clear();
      for (const r of list) store.put(r);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) {
    console.warn("Signalements locaux non enregistres.", error);
  }
}

/** The zone a point falls in, or undefined when it is outside the city. */
export function zoneContaining(zones: Zone[], lon: number, lat: number): Zone | undefined {
  const index = new PolygonIndex({
    type: "FeatureCollection",
    features: zones.map((z) => ({ type: "Feature" as const, properties: { id: z.id }, geometry: z.geometry })),
  });
  const hit = index.at([lon, lat])[0];
  return hit ? zones.find((z) => z.id === String(hit.id)) : undefined;
}
