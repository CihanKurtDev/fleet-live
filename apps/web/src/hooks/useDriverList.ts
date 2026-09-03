import { useEffect, useState } from "react";
import type { DriverListQuery, DriverListResponse } from "@fleet-live/shared";
import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { listDrivers } from "../api/drivers";
import { useVehicles } from "../context/vehiclesContext";

export const useDriverList = (query: DriverListQuery) => {
    const { listEpoch } = useVehicles();
    const [response, setResponse] = useState<DriverListResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsFetching(true);
        setError(null);

        retryTransient(
            () => listDrivers(query, controller.signal),
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
    }, [query.search, query.sort, query.dir, query.page, query.limit, query.vehicle_id, listEpoch]);

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
