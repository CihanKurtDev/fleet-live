import { useEffect, useState } from "react";
import type { TodayResponse } from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getToday } from "../api/today";
import { useVehicles } from "../context/vehiclesContext";
import { useRetryTrigger } from "./useRetryTrigger";

/**
 * Tasks for the Schicht list. Refetches when the fleet changes
 * (`vehicles-changed`), after a write on the page (`reload`) and when the
 * list gets room for more rows; the old rows stay on screen meanwhile.
 */
export const useToday = (limit: number) => {
    const { listEpoch } = useVehicles();
    const { retryKey, retry } = useRetryTrigger();
    const [response, setResponse] = useState<TodayResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (limit < 1) {
            return;
        }

        const controller = new AbortController();

        retryTransient(() => getToday(limit, controller.signal), controller.signal)
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
                        : "Aufgaben konnten nicht geladen werden.",
                );
            });

        return () => controller.abort();
    }, [limit, listEpoch, retryKey]);

    return { data: response, error, reload: retry };
};
