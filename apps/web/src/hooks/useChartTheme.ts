import { useEffect, useState } from "react";
import { onThemeChange } from "../utils/theme";

type ChartTheme = {
    text: string;
    border: string;
    accent: string;
};

/** Before the tokens are read (and in tests): the surrounding text colour. */
const FALLBACK: ChartTheme = {
    text: "currentColor",
    border: "currentColor",
    accent: "currentColor",
};

const readTheme = (): ChartTheme => {
    const styles = getComputedStyle(document.documentElement);

    return {
        text: styles.getPropertyValue("--text").trim() || FALLBACK.text,
        border: styles.getPropertyValue("--border").trim() || FALLBACK.border,
        accent: styles.getPropertyValue("--accent").trim() || FALLBACK.accent,
    };
};

/** Recharts braucht echte Farbstrings — CSS-Variablen in SVG greifen nicht. */
export const useChartTheme = (): ChartTheme => {
    const [theme, setTheme] = useState<ChartTheme>(FALLBACK);

    useEffect(() => {
        const apply = () => setTheme(readTheme());
        apply();

        return onThemeChange(apply);
    }, []);

    return theme;
};
