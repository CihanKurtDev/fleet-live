/**
 * Light or dark. The page follows the system setting until someone picks the
 * other scheme with the header switch; picking the scheme the system already
 * has goes back to "follow the system", so there is no third state to find.
 *
 * `index.html` sets `data-theme` before the first paint (no flash); this
 * module keeps it current and tells canvas maps and charts, which cannot read
 * CSS variables, when it changes.
 */
const STORAGE_KEY = "fleet-live:theme";
const CHANGE_EVENT = "fleet-live:theme-change";

type Scheme = "light" | "dark";

const systemMedia = () =>
    typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

const systemScheme = (): Scheme => (systemMedia()?.matches ? "dark" : "light");

const storedScheme = (): Scheme | null => {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return value === "light" || value === "dark" ? value : null;
    } catch {
        return null;
    }
};

export const isDarkTheme = () =>
    document.documentElement.dataset.theme === "dark";

const applyTheme = () => {
    document.documentElement.dataset.theme = storedScheme() ?? systemScheme();
    window.dispatchEvent(new Event(CHANGE_EVENT));
};

/** Runs `listener` after every scheme change; returns the unsubscribe. */
export const onThemeChange = (listener: () => void) => {
    window.addEventListener(CHANGE_EVENT, listener);
    return () => window.removeEventListener(CHANGE_EVENT, listener);
};

/** Once at start: set the scheme and follow the system while nothing is picked. */
export const initTheme = () => {
    applyTheme();
    systemMedia()?.addEventListener("change", () => {
        if (storedScheme() === null) {
            applyTheme();
        }
    });
};

const reducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransitionDocument = Document & {
    startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * The switch itself ("Dimmer"): the page dims like a light being turned down,
 * then comes back up in the other scheme (index.css, `theme-switching`). The
 * browser swaps everything underneath in one step, so maps and charts do not
 * flicker. Without View Transitions or with reduced motion it switches at once.
 */
export const setDarkTheme = (dark: boolean) => {
    const next: Scheme = dark ? "dark" : "light";

    try {
        if (next === systemScheme()) {
            window.localStorage.removeItem(STORAGE_KEY);
        } else {
            window.localStorage.setItem(STORAGE_KEY, next);
        }
    } catch {
        // Not stored (private mode): the switch still works for this visit.
    }

    const doc = document as ViewTransitionDocument;

    if (!doc.startViewTransition || reducedMotion()) {
        applyTheme();
        return;
    }

    document.documentElement.classList.add("theme-switching");
    doc.startViewTransition(applyTheme).finished.finally(() => {
        document.documentElement.classList.remove("theme-switching");
    });
};
