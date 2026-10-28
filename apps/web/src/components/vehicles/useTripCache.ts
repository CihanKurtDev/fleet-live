import type { Trip } from "@fleet-live/shared";
import { useCallback, useMemo, useRef } from "react";

import { getVehicleTripById } from "../../api/vehicles";

type Cache = {
    vehicleId: number | null;
    trips: Map<number, Trip>;
    loading: Set<number>;
};

/**
 * Closed trips of one vehicle, kept once loaded, so a picked trip is on the
 * map at once: the row under the pointer (or with focus) loads ahead, and a
 * trip seen before comes from here. A closed trip's line never changes; the
 * page still reloads the picked trip, since its warnings may have been
 * resolved meanwhile. One request per row someone points at, not per page.
 */
export const useTripCache = (vehicleId: number | null) => {
    const cacheRef = useRef<Cache>({
        vehicleId,
        trips: new Map(),
        loading: new Set(),
    });

    const current = useCallback(() => {
        if (cacheRef.current.vehicleId !== vehicleId) {
            cacheRef.current = { vehicleId, trips: new Map(), loading: new Set() };
        }

        return cacheRef.current;
    }, [vehicleId]);

    const get = useCallback(
        (tripId: number) => current().trips.get(tripId) ?? null,
        [current],
    );

    const remember = useCallback(
        (trip: Trip | null) => {
            if (trip && trip.ended_at !== null) {
                current().trips.set(trip.id, trip);
            }
        },
        [current],
    );

    const prefetch = useCallback(
        (tripId: number) => {
            const cache = current();

            if (
                vehicleId === null ||
                cache.trips.has(tripId) ||
                cache.loading.has(tripId)
            ) {
                return;
            }

            cache.loading.add(tripId);
            getVehicleTripById(vehicleId, tripId)
                .then((response) => {
                    if (cacheRef.current === cache) {
                        remember(response.data);
                    }
                })
                // The click loads it again and shows the error there.
                .catch(() => undefined)
                .finally(() => cache.loading.delete(tripId));
        },
        [current, remember, vehicleId],
    );

    /** After a resolve: the warnings of every kept trip may have changed. */
    const clear = useCallback(() => current().trips.clear(), [current]);

    return useMemo(
        () => ({ get, remember, prefetch, clear }),
        [get, remember, prefetch, clear],
    );
};
