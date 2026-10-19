import { useEffect } from "react";

const APP_NAME = "fleet-live";

/**
 * Names the browser tab and the history entry after the page, like the h1.
 * Without a title (still loading) the tab shows just the app name.
 */
export function usePageTitle(title: string | null | undefined) {
    useEffect(() => {
        document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    }, [title]);
}
