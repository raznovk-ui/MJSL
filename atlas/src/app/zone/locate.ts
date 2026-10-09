/**
 * Where the person is, to place a report at their position.
 *
 * 1. The browser's own geolocation (free, no key). It asks the person's permission, and only
 *    works on HTTPS or localhost.
 * 2. Google's Geolocation API, as a fallback, only when a key is configured
 *    (VITE_GOOGLE_GEOLOCATION_KEY). It needs billing on the Google Cloud project, and it sends
 *    nearby Wi-Fi and cell identifiers, plus the IP address, to Google.
 *
 * Positions are rounded to about 10 m before they are used: enough to say which street, not
 * which door, and what is stored is never more precise than that.
 */

export interface Location {
  lon: number;
  lat: number;
  /** Radius, in metres, within which the true position probably lies. */
  accuracyM: number;
  source: "browser" | "google";
}

/** 4 decimals of a degree is about 11 m of latitude. */
export const roundForPrivacy = (n: number): number => Math.round(n * 1e4) / 1e4;

export function locateWithBrowser(timeoutMs = 15_000): Promise<Location> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("La geolocalisation n'est pas disponible dans ce navigateur."));
      return;
    }
    if (!window.isSecureContext) {
      reject(new Error("La geolocalisation demande une connexion HTTPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lon: roundForPrivacy(p.coords.longitude),
          lat: roundForPrivacy(p.coords.latitude),
          accuracyM: Math.round(p.coords.accuracy),
          source: "browser",
        }),
      (e) => reject(new Error(e.code === 1 ? "Autorisation de localisation refusee." : "Position introuvable.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Google's Geolocation API. `fetchImpl` is injected so the answer can be tested without a network. */
export async function locateWithGoogle(key: string, fetchImpl: typeof fetch = fetch): Promise<Location> {
  const response = await fetchImpl(`https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ considerIp: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google Geolocation : erreur ${response.status}.`);
  const body = (await response.json()) as { location?: { lat: number; lng: number }; accuracy?: number };
  if (!body.location) throw new Error("Google Geolocation n'a pas renvoye de position.");
  return {
    lon: roundForPrivacy(body.location.lng),
    lat: roundForPrivacy(body.location.lat),
    accuracyM: Math.round(body.accuracy ?? 0),
    source: "google",
  };
}

/** The browser first; Google only if a key is configured and the browser cannot answer. */
export async function locate(googleKey = import.meta.env.VITE_GOOGLE_GEOLOCATION_KEY as string | undefined): Promise<Location> {
  try {
    return await locateWithBrowser();
  } catch (error) {
    if (!googleKey) throw error;
    return locateWithGoogle(googleKey);
  }
}
