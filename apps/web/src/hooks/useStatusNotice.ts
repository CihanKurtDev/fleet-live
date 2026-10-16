import { useCallback, useEffect, useState } from "react";

/** Kurze Rückmeldung, die nach `durationMs` wieder verschwindet. */
export const useStatusNotice = (durationMs = 4000) => {
    // Ein neues Objekt pro Meldung startet die Zeit neu, auch bei gleichem Text.
    const [notice, setNotice] = useState<{ text: string } | null>(null);

    useEffect(() => {
        if (!notice) {
            return;
        }

        const timer = window.setTimeout(() => setNotice(null), durationMs);
        return () => window.clearTimeout(timer);
    }, [notice, durationMs]);

    const show = useCallback((text: string) => setNotice({ text }), []);

    return { notice: notice?.text ?? null, show };
};
