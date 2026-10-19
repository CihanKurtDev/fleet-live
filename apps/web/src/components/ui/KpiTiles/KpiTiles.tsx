import type { CSSProperties } from "react";
import { Link } from "react-router";
import { formatCount } from "../../../utils/formatCount";
import styles from "./KpiTiles.module.scss";

export type KpiTileTone = "neutral" | "positive" | "warning" | "critical";

type KpiTileBase = {
    key: string;
    /** Small uppercase label. */
    label: string;
    /** `null` while the number is not loaded yet (shows „—“). */
    value: number | null;
    /** Optional line under the number. */
    hint?: string;
    tone?: KpiTileTone;
    disabled?: boolean;
    /** Spoken name; defaults to "label, value". */
    ariaLabel?: string;
};

/**
 * A tile is either a filter button (`pressed`, `onToggle`) or a link to the
 * list its number counts (`to`); a link has no pressed state.
 */
export type KpiTile = KpiTileBase &
    (
        | {
              /** The tile's filter is active (`aria-pressed`). */
              pressed: boolean;
              onToggle: () => void;
              to?: undefined;
          }
        | { to: string; pressed?: undefined; onToggle?: undefined }
    );

const TONE_CLASS: Record<KpiTileTone, string | undefined> = {
    neutral: undefined,
    positive: styles.positive,
    warning: styles.warning,
    critical: styles.critical,
};

type KpiTileViewProps = {
    tile: KpiTile;
    /**
     * `glass`: translucent with a blur, for tiles that lie over a map (Schicht).
     * Its density comes from the `--kpi-*` custom properties of the group.
     */
    surface?: "panel" | "glass";
};

/** One tile; `KpiTiles` lays them out, Schicht lays out its own groups. */
export const KpiTileView = ({ tile, surface = "panel" }: KpiTileViewProps) => {
    const classes = [
        styles.tile,
        surface === "glass" ? styles.glass : undefined,
        TONE_CLASS[tile.tone ?? "neutral"],
        tile.pressed ? styles.pressed : undefined,
    ]
        .filter(Boolean)
        .join(" ");
    const value = tile.value === null ? "—" : formatCount(tile.value);
    const label = tile.ariaLabel ?? `${tile.label}, ${value}`;
    const body = (
        <>
            <span className={styles.label} title={tile.label}>
                {tile.label}
            </span>
            <span key={value} className={styles.value}>
                {value}
            </span>
            {/* Always one hint line, so every tile on every page has one height. */}
            <span
                className={styles.hint}
                title={tile.hint}
                aria-hidden={tile.hint ? undefined : true}
            >
                {tile.hint || " "}
            </span>
        </>
    );

    if (tile.to !== undefined) {
        return (
            <Link
                className={classes}
                to={tile.to}
                aria-label={tile.ariaLabel}
                viewTransition
            >
                {body}
            </Link>
        );
    }

    return (
        <button
            type="button"
            className={classes}
            aria-pressed={tile.pressed}
            aria-label={label}
            disabled={tile.disabled}
            onClick={tile.onToggle}
        >
            {body}
        </button>
    );
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
    /** `data-tip` anchor of the page tips. */
    tip?: string;
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
    tip,
}: KpiTilesProps) => (
    <div
        className={
            phoneLayout === "strip"
                ? `${styles.band} ${styles.strip}`
                : styles.band
        }
        role="group"
        aria-label={ariaLabel}
        data-tip={tip}
        style={
            {
                "--tile-cols": tiles.length,
                "--tile-cols-narrow": Math.min(tiles.length, 3),
            } as CSSProperties
        }
    >
        {tiles.map((tile) => (
            <KpiTileView key={tile.key} tile={tile} />
        ))}
    </div>
);
