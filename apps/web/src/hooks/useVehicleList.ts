import { useEffect, useState } from "react";
import type {
    Vehicle,
    VehicleListQuery,
    VehicleListResponse,
} from "@fleet-live/shared";
import {
    fetchVehicleList,
    getCachedVehicleList,
} from "../api/vehicleListCache";
import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { rememberVehicles } from "../api/vehicleCache";
import {
    clearTelemetryFocus,
    setTelemetryFocus,
} from "../api/telemetryFocus";
import { useVehicles } from "../context/vehiclesContext";

const applyOverrides = (
    rows: Vehicle[],
    overrides: Record<number, Partial<Vehicle>>,
): Vehicle[] => {
    if (Object.keys(overrides).length === 0) {
        return rows;
    }

    return rows.map((row) => {
        const patch = overrides[row.id];
        return patch ? { ...row, ...patch } : row;
    });
};

export const useVehicleList = (query: VehicleListQuery) => {
    const { listEpoch, vehicleOverrides } = useVehicles();
    const cached = getCachedVehicleList(query);

    const [response, setResponse] = useState<VehicleListResponse | null>(
        cached?.data ?? null,
    );
    const [isFetching, setIsFetching] = useState(!cached);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const existing = getCachedVehicleList(query);

        if (existing) {
            rememberVehicles(existing.data.data);
            setResponse(existing.data);
            setIsFetching(false);
        } else {
            setIsFetching(true);
        }

        setError(null);

        retryTransient(
            () => fetchVehicleList(query, controller.signal),
            controller.signal,
        )
            .then((data) => {
                rememberVehicles(data.data);
                setResponse(data);
                setError(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrzeuge konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsFetching(false);
                }
            });

        return () => controller.abort();
    }, [query.search, query.filter, query.sort, query.dir, query.page, query.limit, listEpoch]);

    useEffect(() => {
        let cancelled = false;

        const publishFocus = (list: VehicleListResponse) => {
            const ids = [...list.data.map((vehicle) => vehicle.id)];

            for (const page of [query.page + 1, query.page - 1]) {
                if (page < 1 || page > list.meta.pageCount) {
                    continue;
                }

                const neighbor = getCachedVehicleList({ ...query, page });
                if (neighbor) {
                    ids.push(
                        ...neighbor.data.data.map((vehicle) => vehicle.id),
                    );
                }
            }

            setTelemetryFocus("list", ids);
        };

        const current = getCachedVehicleList(query)?.data;

        if (!current) {
            clearTelemetryFocus("list");
            return () => {
                cancelled = true;
                clearTelemetryFocus("list");
            };
        }

        publishFocus(current);

        const neighborPages = [query.page - 1, query.page + 1].filter(
            (page) => page >= 1 && page <= current.meta.pageCount,
        );

        const idle =
            typeof requestIdleCallback === "function"
                ? requestIdleCallback
                : (callback: () => void) => window.setTimeout(callback, 1);

        const id = idle(() => {
            void Promise.all(
                neighborPages.map((page) =>
                    fetchVehicleList({ ...query, page }),
                ),
            ).then(() => {
                if (cancelled) {
                    return;
                }

                const latest = getCachedVehicleList(query)?.data;
                if (latest) {
                    publishFocus(latest);
                }
            });
        });

        return () => {
            cancelled = true;
            clearTelemetryFocus("list");
            if (typeof cancelIdleCallback === "function" && typeof id === "number") {
                cancelIdleCallback(id);
            } else {
                clearTimeout(id as number);
            }
        };
    }, [
        query.search,
        query.filter,
        query.sort,
        query.dir,
        query.page,
        query.limit,
        response,
    ]);

    const data = response
        ? applyOverrides(response.data, vehicleOverrides)
        : [];

    return {
        data,
        meta: response?.meta,
        isLoading: response === null && isFetching,
        isFetching,
        error,
        pageCount: response?.meta.pageCount ?? 1,
        total: response?.meta.total ?? 0,
    };
};
