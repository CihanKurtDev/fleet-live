import { useEffect, useState } from "react";
import type { DriverDetail } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getDriver } from "../api/drivers";
import { useVehicles } from "../context/vehiclesContext";

export const useDriver = (id: number | null) => {
    const { listEpoch } = useVehicles();
    const [driver, setDriver] = useState<DriverDetail | null>(null);
    const [isLoading, setIsLoading] = useState(id !== null);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    const requestKey = id === null ? "null" : `${id}\0${listEpoch}`;
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);

        if (id === null) {
            setDriver(null);
            setIsLoading(false);
            setNotFound(true);
            setError(null);
        } else {
            setDriver(null);
            setIsLoading(true);
            setNotFound(false);
            setError(null);
        }
    }

    useEffect(() => {
        if (id === null) {
            return;
        }

        const controller = new AbortController();

        retryTransient(() => getDriver(id, controller.signal), controller.signal)
            .then((data) => {
                setDriver(data);
                setError(null);
                setNotFound(false);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                if (caught instanceof ApiError && caught.status === 404) {
                    setDriver(null);
                    setNotFound(true);
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrer konnte nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [id, listEpoch]);

    const matchesId = driver !== null && id !== null && driver.id === id;

    return {
        driver: matchesId ? driver : null,
        isLoading: Boolean(
            id !== null && !notFound && (isLoading || !matchesId),
        ),
        error,
        notFound,
    };
};
