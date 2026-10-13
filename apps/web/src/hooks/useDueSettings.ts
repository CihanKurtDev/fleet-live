import { useEffect, useState } from "react";
import type { DueSettings } from "@fleet-live/shared";
import { isAbortError } from "../api/client";
import { getDueSettings, updateDueSettings } from "../api/due";
import { useAuth } from "./useAuth";

export function useDueSettings() {
    const { user } = useAuth();
    const companyId = user?.company_id ?? null;
    const [settings, setSettings] = useState<DueSettings | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(companyId !== null);

    useEffect(() => {
        if (companyId === null) {
            setSettings(null);
            setIsLoading(false);
            return;
        }

        const controller = new AbortController();
        setIsLoading(true);

        getDueSettings(controller.signal)
            .then((body) => {
                setSettings(body.data);
                setError(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Einstellungen konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [companyId]);

    const save = async (input: {
        due_lead_days?: number | null;
        licence_check_months?: number | null;
    }) => {
        const body = await updateDueSettings(input);
        setSettings(body.data);
        setError(null);
        return body.data;
    };

    return { settings, isLoading, error, save };
}
