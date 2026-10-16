import type { ReactNode } from "react";
import styles from "./SwapLabel.module.scss";

interface SwapLabelProps {
    /** Shows `alt` instead of `children`. */
    swapped: boolean;
    alt: ReactNode;
    children: ReactNode;
}

/**
 * Two labels in one grid cell: the wider one sets the width, so a control
 * keeps its size when its text changes (Speichern / Wird gespeichert…,
 * Depot anlegen / Klicken abbrechen).
 */
export const SwapLabel = ({ swapped, alt, children }: SwapLabelProps) => (
    <span className={styles.labels}>
        <span
            className={swapped ? styles.hidden : undefined}
            aria-hidden={swapped || undefined}
        >
            {children}
        </span>
        <span
            className={swapped ? undefined : styles.hidden}
            aria-hidden={!swapped || undefined}
        >
            {alt}
        </span>
    </span>
);
