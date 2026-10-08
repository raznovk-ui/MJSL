import { coordKey, type LngLat } from "../../domain/zone/index.js";
import { readCache, writeCache } from "../overpass/cache.js";

/**
 * Altitudes from IGN's open altimetry service (RGE ALTI, about 1 m resolution
 * in France). Free, no key. Limits: a few hundred points per request and about
 * 5 requests per second, hence the batching and the pause between batches.
 */
const ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const NO_DATA = -99999;
const CACHE_KEY = "altitude:ign_rge_alti";

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  batchSize?: number;
  /** Pause between requests, to stay under the service's rate limit. */
  delayMs?: number;
  onProgress?: (done: number, total: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Altitudes for the given points, keyed by coordKey. Points the service cannot answer are left out. */
export async function fetchAltitudes(
  coords: LngLat[],
  { fetchImpl = fetch, batchSize = 200, delayMs = 250, onProgress }: FetchOptions = {},
  into: Record<string, number> = {},
): Promise<Record<string, number>> {
  const unique = [...new Map(coords.map((c) => [coordKey(c), c])).values()];
  for (let start = 0; start < unique.length; start += batchSize) {
    const batch = unique.slice(start, start + batchSize);
    const url =
      `${ENDPOINT}?lon=${batch.map((c) => c[0].toFixed(6)).join("|")}` +
      `&lat=${batch.map((c) => c[1].toFixed(6)).join("|")}&resource=ign_rge_alti_wld&zonly=true`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`IGN altimetry HTTP ${response.status}`);
    const { elevations } = (await response.json()) as { elevations?: number[] };
    if (!Array.isArray(elevations) || elevations.length !== batch.length) {
      throw new Error("IGN altimetry returned an unexpected answer.");
    }
    batch.forEach((c, i) => {
      const z = elevations[i]!;
      if (Number.isFinite(z) && z > NO_DATA / 2) into[coordKey(c)] = z;
    });
    onProgress?.(Math.min(start + batch.length, unique.length), unique.length);
    if (start + batchSize < unique.length) await sleep(delayMs);
  }
  return into;
}

/**
 * Altitudes are permanent facts, so they are cached for good and only the
 * missing points are requested. Progress is saved even if a later batch fails,
 * so the next try carries on instead of starting over.
 */
export async function getAltitudes(
  coords: LngLat[],
  options: FetchOptions = {},
): Promise<{ altitudes: Record<string, number>; complete: boolean; error?: string }> {
  const cached = (await readCache<Record<string, number>>(CACHE_KEY))?.payload ?? {};
  const altitudes = { ...cached };
  const missing = coords.filter((c) => altitudes[coordKey(c)] === undefined);
  if (missing.length === 0) return { altitudes, complete: true };

  try {
    await fetchAltitudes(missing, options, altitudes);
    return { altitudes, complete: true };
  } catch (error) {
    return { altitudes, complete: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await writeCache(CACHE_KEY, altitudes);
  }
}
