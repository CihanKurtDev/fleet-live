import { useEffect, useId, useState } from "react";

import { isDarkTheme, onThemeChange, setDarkTheme } from "../utils/theme";
import { Button } from "./ui/Button/Button";
import styles from "./ThemeToggle.module.scss";

/**
 * Sun or moon in the header. It shows where it switches to: the sun in the
 * dark scheme, the moon in the light one. To the sun the disc slides away and
 * the rays turn in; to the moon the rays fly out, the sun thins to a crescent
 * and three stars come up.
 */
export const ThemeToggle = () => {
    const [dark, setDark] = useState(isDarkTheme);
    // Ray animations only after a click, not on the first paint.
    const [animated, setAnimated] = useState(false);
    // The header renders the switch twice (desktop and phone bar).
    const maskId = `theme-bite-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

    useEffect(() => onThemeChange(() => setDark(isDarkTheme())), []);

    const label = dark ? "Hell schalten" : "Dunkel schalten";

    return (
        <Button
            variant="secondary"
            size="sm"
            icon
            aria-label={label}
            title={label}
            onClick={() => {
                setAnimated(true);
                setDarkTheme(!dark);
            }}
        >
            <svg
                className={styles.icon}
                data-show={dark ? "sun" : "moon"}
                data-animated={animated || undefined}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
            >
                <defs>
                    <mask id={maskId}>
                        <rect x="-4" y="-4" width="32" height="32" fill="#fff" />
                        <circle
                            className={styles.bite}
                            cx="16.5"
                            cy="7.5"
                            r="6.5"
                            fill="#000"
                        />
                    </mask>
                </defs>
                <circle
                    className={styles.core}
                    cx="12"
                    cy="12"
                    r="4.6"
                    fill="currentColor"
                    mask={`url(#${maskId})`}
                />
                <g
                    className={styles.rays}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                >
                    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
                </g>
                <g fill="currentColor">
                    <path
                        className={`${styles.star} ${styles.s1}`}
                        d="M19.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z"
                    />
                    <path
                        className={`${styles.star} ${styles.s2}`}
                        d="M22 9.5l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4Z"
                    />
                    <path
                        className={`${styles.star} ${styles.s3}`}
                        d="M15.5 1l.35.8.8.35-.8.35-.35.8-.35-.8-.8-.35.8-.35Z"
                    />
                </g>
            </svg>
        </Button>
    );
};
