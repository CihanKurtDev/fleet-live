import { useEffect, useState } from "react";

/** Matches --dur-2 in index.css, the exit time of menus, drawers and panels. */
const EXIT_MS = 200;

/** No exit animation where motion is reduced or media queries are missing. */
export const skipMotion = () =>
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Keeps something mounted for its exit animation. `mounted` says whether to
 * render it, `closing` whether it is on its way out (style it with
 * `data-closing` and ignore clicks).
 */
export const usePresence = (open: boolean, exitMs: number = EXIT_MS) => {
    const [mounted, setMounted] = useState(open);

    if (open && !mounted) {
        setMounted(true);
    }

    if (!open && mounted && skipMotion()) {
        setMounted(false);
    }

    useEffect(() => {
        if (open || !mounted) {
            return;
        }

        const timer = window.setTimeout(() => setMounted(false), exitMs);

        return () => window.clearTimeout(timer);
    }, [open, mounted, exitMs]);

    return { mounted, closing: mounted && !open };
};
