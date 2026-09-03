import { useEffect, useRef, useState } from "react";
import type { DriverDetail } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getDriver } from "../api/drivers";
import { useVehicles } from "../context/vehiclesContext";

export const useDriver = (id: number | null) => {
    const { listEpoch } = useVehicles();
    const loadedIdRef = useRef<number | null>(null);
    const [driver, setDriver] = useState<DriverDetail | null>(null);
    const [isLoading, setIsLoading] = useState(id !== null);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        if (id === null) {
            loadedIdRef.current = null;
            setDriver(null);
            setIsLoading(false);
            setNotFound(true);
            return;
        }

        const controller = new AbortController();
        setError(null);
        setNotFound(false);

        if (loadedIdRef.current !== id) {
            setIsLoading(true);
        }

        retryTransient(() => getDriver(id, controller.signal), controller.signal)
            .then((data) => {
                loadedIdRef.current = data.id;
                setDriver(data);
                setError(null);
                setNotFound(false);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                if (caught instanceof ApiError && caught.status === 404) {
                    loadedIdRef.current = null;
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

    return { driver, isLoading, error, notFound };
};
