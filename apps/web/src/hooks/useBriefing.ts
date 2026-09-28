import { useEffect, useState } from "react";
import type { BriefingResponse } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getBriefing } from "../api/briefing";
import { useVehicles } from "../context/vehiclesContext";
import { useRetryTrigger } from "./useRetryTrigger";

export const useBriefing = () => {
    const { listEpoch } = useVehicles();
    const { retryKey, retry } = useRetryTrigger();
    const [response, setResponse] = useState<BriefingResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const requestKey = `${listEpoch}\0${retryKey}`;
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        setIsFetching(true);
        setError(null);
    }

    useEffect(() => {
        const controller = new AbortController();

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
    }, [listEpoch, retryKey]);

    return {
        data: response?.data ?? null,
        isLoading: response === null && isFetching,
        isFetching,
        error,
        retry,
    };
};
