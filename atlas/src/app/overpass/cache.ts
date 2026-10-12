/**
 * Overpass responses are cached in IndexedDB, not localStorage: a corridor-wide
 * query runs to several megabytes, past localStorage's ~5 MB cap, and its
 * synchronous write would block the first paint.
 */
import { openDb, OVERPASS as STORE } from "../persistence/db.js";

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedResponse<T> {
  timestamp: number;
  payload: T;
}

export async function readCache<T>(key: string): Promise<CachedResponse<T> | null> {
  try {
    const db = await openDb();
    const value = await new Promise<CachedResponse<T> | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value && typeof value.timestamp === "number" ? value : null;
  } catch (error) {
    console.warn("Cache Overpass illisible, il sera reconstruit.", error);
    return null;
  }
}

export async function writeCache<T>(key: string, payload: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ timestamp: Date.now(), payload }, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) {
    // Storage unavailable or over quota: carry on without a cache.
    console.warn("Cache Overpass non enregistre.", error);
  }
}

export function ageLabel(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}
