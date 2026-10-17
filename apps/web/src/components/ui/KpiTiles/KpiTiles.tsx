import type { CSSProperties } from "react";
import { formatCount } from "../../../utils/formatCount";
import styles from "./KpiTiles.module.scss";

export type KpiTileTone = "neutral" | "positive" | "warning" | "critical";

export type KpiTile = {
    key: string;
    /** Small uppercase label. */
    label: string;
    /** `null` while the number is not loaded yet (shows „—“). */
    value: number | null;
    /** Optional line under the number. */
    hint?: string;
    tone?: KpiTileTone;
    /** The tile's filter is active (`aria-pressed`). */
    pressed: boolean;
    disabled?: boolean;
    /** Spoken name; defaults to "label, value". */
    ariaLabel?: string;
    onToggle: () => void;
};

const TONE_CLASS: Record<KpiTileTone, string | undefined> = {
    neutral: undefined,
    positive: styles.positive,
    warning: styles.warning,
    critical: styles.critical,
};

type KpiTilesProps = {
    tiles: KpiTile[];
    /** Name of the tile group. */
    ariaLabel: string;
    /**
     * Phones (≤ 700 px): `grid` puts two tiles per row (fleet map),
     * `strip` keeps one row that scrolls sideways (list pages).
     */
    phoneLayout?: "grid" | "strip";
};

/**
 * KPI tiles that act as filter buttons: label, large number, optional hint.
 * Used above the fleet map and as the main filter of the list pages.
 * From 1101 px all tiles share one row; narrower, three per row.
 */
export const KpiTiles = ({
    tiles,
    ariaLabel,
    phoneLayout = "grid",
}: KpiTilesProps) => (
    <div
        className={
            phoneLayout === "strip"
                ? `${styles.band} ${styles.strip}`
                : styles.band
        }
        role="group"
        aria-label={ariaLabel}
        style={
            {
                "--tile-cols": tiles.length,
                "--tile-cols-narrow": Math.min(tiles.length, 3),
            } as CSSProperties
        }
    >
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
                    <span key={value} className={styles.value}>
                        {value}
                    </span>
                    {/* Always one hint line, so every tile on every list page has one height. */}
                    <span
                        className={styles.hint}
                        aria-hidden={tile.hint ? undefined : true}
                    >
                        {tile.hint || "\u00a0"}
                    </span>
                </button>
            );
        })}
    </div>
);
