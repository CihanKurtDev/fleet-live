import { useEffect, useState } from "react";
import type { AlertListQuery, AlertListResponse } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { listAlerts } from "../api/alerts";
import { useVehicles } from "../context/vehiclesContext";

export const useAlertList = (query: AlertListQuery) => {
    const { listEpoch } = useVehicles();
    const [response, setResponse] = useState<AlertListResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        setIsFetching(true);
        setError(null);
        setNotFound(false);

        retryTransient(
            () => listAlerts(query, controller.signal),
            controller.signal,
        )
            .then((data) => {
                setResponse(data);
                setError(null);
                setNotFound(false);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                if (caught instanceof ApiError && caught.status === 404) {
                    setResponse(null);
                    setNotFound(true);
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Warnungen konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsFetching(false);
                }
            });

        return () => controller.abort();
    }, [
        query.filter,
        query.sort,
        query.dir,
        query.page,
        query.limit,
        query.vehicle_id,
        query.driver_id,
        listEpoch,
    ]);

    return {
        data: response?.data ?? [],
        meta: response?.meta,
        isLoading: response === null && isFetching,
        isFetching,
        error,
        notFound,
        pageCount: response?.meta.pageCount ?? 1,
        total: response?.meta.total ?? 0,
    };
};
