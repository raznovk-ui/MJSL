/**
 * Place names for a zone, from OSM's Nominatim reverse geocoder.
 *
 * Follows https://operations.osmfoundation.org/policies/nominatim/ :
 *  - at most one request per second, from one queue, never in parallel;
 *  - only on demand (a person selects a zone), never in bulk over all zones;
 *  - results are cached, so the same place is never asked twice;
 *  - no autocomplete; a browser cannot set a User-Agent, so it identifies the app
 *    through the Referer it sends automatically;
 *  - OpenStreetMap is credited on the map and in exports.
 */
import { readCache, writeCache } from "../overpass/cache.js";

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const MIN_GAP_MS = 1100;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

export interface PlaceName {
  /** e.g. "Quartier de Endoume, 7e Arrondissement". */
  label: string;
}

/** Rounded to about 100 m so nearby zones share a cache entry. */
const cacheKey = (lat: number, lon: number) => `nominatim:${lat.toFixed(3)},${lon.toFixed(3)}`;

export function labelFromAddress(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  const parts = [
    address.neighbourhood ?? address.quarter ?? address.suburb,
    address.city_district ?? (address.suburb && address.neighbourhood ? address.suburb : undefined),
  ].filter((v, i, all): v is string => !!v && all.indexOf(v) === i);
  return parts.length ? parts.join(", ") : (address.road ?? address.city ?? null);
}

export async function reversePlace(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PlaceName | null> {
  const key = cacheKey(lat, lon);
  const cached = await readCache<PlaceName | null>(key);
  if (cached && now() - cached.timestamp < CACHE_TTL_MS) return cached.payload;

  const run = async (): Promise<PlaceName | null> => {
    const wait = lastRequestAt + MIN_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    const url = new URL(ENDPOINT);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "16");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "fr");
    url.searchParams.set("lat", lat.toFixed(5));
    url.searchParams.set("lon", lon.toFixed(5));
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const body = (await response.json()) as { address?: Record<string, string> };
    const label = labelFromAddress(body.address);
    return label ? { label } : null;
  };

  // Chained so two quick selections still go out one second apart.
  const result = queue.then(run, run) as Promise<PlaceName | null>;
  queue = result.catch(() => undefined);
  const place = await result;
  await writeCache(key, place);
  return place;
}
