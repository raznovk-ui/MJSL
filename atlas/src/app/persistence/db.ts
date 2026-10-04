/**
 * Browser database, used only as a cache for downloaded open data (Overpass
 * responses, IGN altitudes). Nothing a person types is stored: the app has no
 * data entry.
 *
 * VERSION stays at 4 on purpose. Earlier versions of the app also created
 * "observations", "photos" and "ruptures" stores; they are no longer read or
 * written, and are left alone in browsers that already have them rather than
 * silently deleting what someone may have stored there.
 */
const DB_NAME = "mjsl-atlas";
const VERSION = 4;
export const OVERPASS = "overpass";

/**
 * The single opener for the app's database. Opening the same database at a lower
 * version from another module throws a VersionError, so it lives in one place.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OVERPASS)) db.createObjectStore(OVERPASS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
