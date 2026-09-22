import { useEffect, useState } from "react";
import type { DriverListQuery, DriverListResponse } from "@fleet-live/shared";
import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { listDrivers } from "../api/drivers";
import { useVehicles } from "../context/vehiclesContext";

export const useDriverList = (query: DriverListQuery) => {
    const { listEpoch } = useVehicles();
    const { search, sort, dir, page, limit, vehicle_id } = query;
    const [response, setResponse] = useState<DriverListResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const requestKey = [
        search,
        sort,
        dir,
        page,
        limit,
        vehicle_id,
        listEpoch,
    ].join("\0");
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        setIsFetching(true);
        setError(null);
    }

    useEffect(() => {
        const controller = new AbortController();
        const activeQuery: DriverListQuery = {
            search,
            sort,
            dir,
            page,
            limit,
            vehicle_id,
        };

        retryTransient(
            () => listDrivers(activeQuery, controller.signal),
            controller.signal,
        )
            .then((data) => {
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
                        : "Fahrer konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsFetching(false);
                }
            });

        return () => controller.abort();
    }, [search, sort, dir, page, limit, vehicle_id, listEpoch]);

    return {
        data: response?.data ?? [],
        meta: response?.meta,
        isLoading: response === null && isFetching,
        isFetching,
        error,
        pageCount: response?.meta.pageCount ?? 1,
        total: response?.meta.total ?? 0,
    };
};
