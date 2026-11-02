import styles from "./InspectionPlaque.module.scss";

type InspectionPlaqueProps = {
    /** Due date `YYYY-MM-DD` (HU: end of the sticker month); `null` draws an empty plaque. */
    dueOn: string | null;
    state: "overdue" | "soon" | "ok" | "missing";
    /** Pixel size; the plaque is round. */
    size?: number;
    /** Text for screen readers; decorative when left out. */
    label?: string;
};

/**
 * The round inspection sticker as on the number plate: the year in the
 * middle, the mark at the top for the month it is due. Grey while valid,
 * yellow outline when due soon, yellow filled once it has expired.
 */
export const InspectionPlaque = ({ dueOn, state, size = 32, label }: InspectionPlaqueProps) => {
    const year = dueOn ? dueOn.slice(2, 4) : "–";

    return (
        <svg
            className={styles.plaque}
            data-state={state}
            width={size}
            height={size}
            viewBox="0 0 32 32"
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <circle className={styles.ring} cx="16" cy="16" r="14.5" />
            <line className={styles.mark} x1="16" y1="3.5" x2="16" y2="7.5" />
            <text className={styles.year} x="16" y="20" textAnchor="middle">
                {year}
            </text>
        </svg>
    );
};
