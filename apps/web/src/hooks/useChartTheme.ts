import { useEffect, useState } from "react";

export type ChartTheme = {
    text: string;
    border: string;
    accent: string;
};

const FALLBACK: ChartTheme = {
    text: "#6b6375",
    border: "#e5e4e7",
    accent: "#aa3bff",
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

        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", apply);

        return () => media.removeEventListener("change", apply);
    }, []);

    return theme;
};
