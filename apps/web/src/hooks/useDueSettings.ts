import { useEffect, useState } from "react";
import type { DueSettings } from "@fleet-live/shared";
import { isAbortError } from "../api/client";
import { getDueSettings, updateDueSettings } from "../api/due";
import { useAuth } from "./useAuth";

export function useDueSettings() {
    const { user } = useAuth();
    const companyId = user?.company_id ?? null;
    // Results are kept with the company they belong to, so a company switch
    // shows "loading" at once instead of the old company's values.
    const [loaded, setLoaded] = useState<{
        companyId: number;
        settings: DueSettings;
    } | null>(null);
    const [failure, setFailure] = useState<{
        companyId: number;
        message: string;
    } | null>(null);
    const settings = loaded?.companyId === companyId ? loaded.settings : null;
    const error = failure?.companyId === companyId ? failure.message : null;
    const isLoading = companyId !== null && settings === null && error === null;

    useEffect(() => {
        if (companyId === null) {
            return;
        }

        const controller = new AbortController();

        getDueSettings(controller.signal)
            .then((body) => {
                setLoaded({ companyId, settings: body.data });
                setFailure(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setFailure({
                    companyId,
                    message:
                        caught instanceof Error
                            ? caught.message
                            : "Einstellungen konnten nicht geladen werden.",
                });
            });

        return () => controller.abort();
    }, [companyId]);

    const save = async (input: {
        due_lead_days?: number | null;
        licence_check_months?: number | null;
    }) => {
        const body = await updateDueSettings(input);

        if (companyId !== null) {
            setLoaded({ companyId, settings: body.data });
            setFailure(null);
        }

        return body.data;
    };

    return { settings, isLoading, error, save };
}
