import { formatCount } from "../../utils/formatCount";
import styles from "./FleetKpiBand.module.scss";

export type FleetKpiTone = "neutral" | "positive" | "warning" | "critical";

export type FleetKpiTile = {
    key: string;
    label: string;
    /** `null`, solange die Zahl noch nicht geladen ist. */
    value: number | null;
    hint?: string;
    tone?: FleetKpiTone;
    pressed: boolean;
    disabled?: boolean;
    /** Ausgesprochener Name; ohne Angabe Label und Zahl. */
    ariaLabel?: string;
    onToggle: () => void;
};

const TONE_CLASS: Record<FleetKpiTone, string | undefined> = {
    neutral: undefined,
    positive: styles.positive,
    warning: styles.warning,
    critical: styles.critical,
};

type FleetKpiBandProps = {
    tiles: FleetKpiTile[];
};

/** Lagezahlen über der Karte. Jede Kachel schaltet den passenden Kartenfilter. */
export const FleetKpiBand = ({ tiles }: FleetKpiBandProps) => (
    <div className={styles.band} role="group" aria-label="Lage">
        {tiles.map((tile) => {
            const classes = [
                styles.tile,
                TONE_CLASS[tile.tone ?? "neutral"],
                tile.pressed ? styles.pressed : undefined,
            ]
                .filter(Boolean)
                .join(" ");
            const value = tile.value === null ? "—" : formatCount(tile.value);

            return (
                <button
                    key={tile.key}
                    type="button"
                    className={classes}
                    aria-pressed={tile.pressed}
                    aria-label={tile.ariaLabel ?? `${tile.label}, ${value}`}
                    disabled={tile.disabled}
                    onClick={tile.onToggle}
                >
                    <span className={styles.label}>{tile.label}</span>
                    <span className={styles.value}>{value}</span>
                    {tile.hint && (
                        <span className={styles.hint}>{tile.hint}</span>
                    )}
                </button>
            );
        })}
    </div>
);
