import { useEffect, useState } from "react";
import type {
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
import { applyVehicleOverrides } from "../utils/applyVehicleOverrides";

const vehicleListRequestKey = (query: VehicleListQuery, listEpoch: number) =>
    [
        query.search,
        query.filter,
        query.sort,
        query.dir,
        query.page,
        query.limit,
        listEpoch,
    ].join("\0");

export const useVehicleList = (query: VehicleListQuery) => {
    const { listEpoch, vehicleOverrides } = useVehicles();
    const { search, filter, sort, dir, page, limit } = query;
    const listQuery: VehicleListQuery = {
        search,
        filter,
        sort,
        dir,
        page,
        limit,
    };
    const cached = getCachedVehicleList(listQuery);

    const [response, setResponse] = useState<VehicleListResponse | null>(
        cached?.data ?? null,
    );
    const [isFetching, setIsFetching] = useState(!cached);
    const [error, setError] = useState<string | null>(null);

    const requestKey = vehicleListRequestKey(listQuery, listEpoch);
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        const existing = getCachedVehicleList(listQuery);

        if (existing) {
            rememberVehicles(existing.data.data);
            setResponse(existing.data);
            setIsFetching(false);
        } else {
            setIsFetching(true);
        }

        setError(null);
    }

    useEffect(() => {
        const controller = new AbortController();
        const activeQuery: VehicleListQuery = {
            search,
            filter,
            sort,
            dir,
            page,
            limit,
        };

        retryTransient(
            () => fetchVehicleList(activeQuery, controller.signal),
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
    }, [search, filter, sort, dir, page, limit, listEpoch]);

    useEffect(() => {
        let cancelled = false;
        const activeQuery: VehicleListQuery = {
            search,
            filter,
            sort,
            dir,
            page,
            limit,
        };

        const publishFocus = (list: VehicleListResponse) => {
            const ids = [...list.data.map((vehicle) => vehicle.id)];

            for (const neighborPage of [page + 1, page - 1]) {
                if (neighborPage < 1 || neighborPage > list.meta.pageCount) {
                    continue;
                }

                const neighbor = getCachedVehicleList({
                    ...activeQuery,
                    page: neighborPage,
                });
                if (neighbor) {
                    ids.push(
                        ...neighbor.data.data.map((vehicle) => vehicle.id),
                    );
                }
            }

            setTelemetryFocus("list", ids);
        };

        const current = getCachedVehicleList(activeQuery)?.data;

        if (!current) {
            clearTelemetryFocus("list");
            return () => {
                cancelled = true;
                clearTelemetryFocus("list");
            };
        }

        publishFocus(current);

        const neighborPages = [page - 1, page + 1].filter(
            (neighborPage) =>
                neighborPage >= 1 && neighborPage <= current.meta.pageCount,
        );

        const idle =
            typeof requestIdleCallback === "function"
                ? requestIdleCallback
                : (callback: () => void) => window.setTimeout(callback, 1);

        const id = idle(() => {
            void Promise.all(
                neighborPages.map((neighborPage) =>
                    fetchVehicleList({ ...activeQuery, page: neighborPage }),
                ),
            ).then(() => {
                if (cancelled) {
                    return;
                }

                const latest = getCachedVehicleList(activeQuery)?.data;
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
    }, [search, filter, sort, dir, page, limit, response]);

    const data = response
        ? applyVehicleOverrides(response.data, vehicleOverrides)
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
