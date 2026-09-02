import { useEffect, useState } from "react";
import type { BriefingResponse } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getBriefing } from "../api/briefing";
import { useVehicles } from "../context/vehiclesContext";

export const useBriefing = () => {
    const { listEpoch } = useVehicles();
    const [response, setResponse] = useState<BriefingResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsFetching(true);
        setError(null);

        retryTransient(
            () => getBriefing(controller.signal),
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
                    caught instanceof ApiError
                        ? caught.message
                        : "Schicht konnte nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsFetching(false);
                }
            });

        return () => controller.abort();
    }, [listEpoch]);

    return {
        data: response?.data ?? null,
        isLoading: response === null && isFetching,
        isFetching,
        error,
    };
};
