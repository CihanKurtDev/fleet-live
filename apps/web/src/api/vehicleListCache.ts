import type { VehicleListQuery, VehicleListResponse } from "@fleet-live/shared";
import { serializeVehicleListQuery } from "@fleet-live/shared";
import { listVehicles } from "./vehicles";

const STALE_MS = 15_000;

type CacheEntry = {
    data: VehicleListResponse;
    timestamp: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<VehicleListResponse>>();

export function vehicleQueryKey(query: VehicleListQuery): string {
    return serializeVehicleListQuery(query).toString();
}

export function invalidateVehicleListCache() {
    cache.clear();
    inflight.clear();
}

export function getCachedVehicleList(query: VehicleListQuery) {
    return cache.get(vehicleQueryKey(query));
}

function followUntilAborted<T>(
    promise: Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    if (!signal) {
        return promise;
    }

    if (signal.aborted) {
        return Promise.reject(
            signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
    }

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
            );
        };

        signal.addEventListener("abort", onAbort, { once: true });

        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

export function fetchVehicleList(
    query: VehicleListQuery,
    signal?: AbortSignal,
): Promise<VehicleListResponse> {
    const key = vehicleQueryKey(query);
    let pending = inflight.get(key);

    if (!pending) {
        // Der HTTP-Request hängt nicht am Component-AbortSignal.
        // StrictMode bricht den ersten Effect ab; der Request soll
        // trotzdem durchlaufen, damit der zweite Mount ihn mitbenutzen kann.
        pending = listVehicles(query)
            .then((data) => {
                cache.set(key, { data, timestamp: Date.now() });
                return data;
            })
            .finally(() => {
                inflight.delete(key);
            });

        inflight.set(key, pending);
    }

    return followUntilAborted(pending, signal);
}

export function isVehicleListFresh(query: VehicleListQuery) {
    const entry = cache.get(vehicleQueryKey(query));
    return Boolean(entry && Date.now() - entry.timestamp < STALE_MS);
}

export function prefetchVehicleList(query: VehicleListQuery) {
    if (isVehicleListFresh(query)) {
        return;
    }

    void fetchVehicleList(query).catch(() => undefined);
}
