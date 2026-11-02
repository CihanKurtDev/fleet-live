import type { GeocodeHit } from "@fleet-live/shared";

import { config } from "../config";
import { AppError } from "./errors";

/** Same query again within a day: from memory, not from the service. */
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
/** The public Nominatim allows one request per second; a little more to be safe. */
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 8000;
const HITS = 5;

let endpoint = config.geocoderUrl;
const cache = new Map<string, { at: number; hits: GeocodeHit[] }>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

export const geocoderEnabled = () => endpoint.trim() !== "";

/** Tests point the search at a local stub (or switch it off with ""). */
export function setGeocoderEndpointForTests(url: string) {
    endpoint = url;
    cache.clear();
    lastRequestAt = 0;
}

type NominatimRow = { display_name?: unknown; lat?: unknown; lon?: unknown };

function toHits(body: unknown): GeocodeHit[] {
    if (!Array.isArray(body)) {
        return [];
    }

    return (body as NominatimRow[])
        .map((row) => ({
            label: typeof row.display_name === "string" ? row.display_name : "",
            latitude: Number(row.lat),
            longitude: Number(row.lon),
        }))
        .filter(
            (hit) =>
                hit.label !== "" &&
                Number.isFinite(hit.latitude) &&
                Number.isFinite(hit.longitude),
        )
        .slice(0, HITS);
}

async function ask(query: string): Promise<GeocodeHit[]> {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();

    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(HITS));
    url.searchParams.set("accept-language", "de");

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { "User-Agent": config.geocoderUserAgent, Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new AppError(502, "GEOCODER_FAILED", "Die Adresssuche antwortet gerade nicht. Ort auf der Karte anklicken.");
    }

    if (!response.ok) {
        throw new AppError(502, "GEOCODER_FAILED", "Die Adresssuche antwortet gerade nicht. Ort auf der Karte anklicken.");
    }

    return toHits(await response.json().catch(() => null));
}

/**
 * An address typed by a dispatcher, looked up once when they press „Suchen“
 * (never while typing). All requests of the process go one after another,
 * at most one per second, and a repeated query comes from the cache.
 */
export async function geocode(query: string): Promise<GeocodeHit[]> {
    if (!geocoderEnabled()) {
        throw new AppError(503, "GEOCODER_OFF", "Die Adresssuche ist nicht eingerichtet. Ort auf der Karte anklicken.");
    }

    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
        return cached.hits;
    }

    const result = queue.then(() => ask(query.trim()));
    queue = result.catch(() => undefined);
    const hits = await result;

    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
            cache.delete(oldest);
        }
    }
    cache.set(key, { at: Date.now(), hits });
    return hits;
}
