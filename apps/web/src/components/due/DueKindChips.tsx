import type { DueKind } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import type { DueKindOption } from "./dueView";
import styles from "./DueBoard.module.scss";

interface DueKindChipsProps {
    kinds: DueKindOption[];
    activeKind: DueKind | null;
    onKind: (kind: DueKind | null) => void;
}

/**
 * The kind filter as one row of chips above the list, for windows where the
 * rail sits below it. The same switch as the rail's kind buttons.
 */
export const DueKindChips = ({ kinds, activeKind, onKind }: DueKindChipsProps) => (
    <div className={styles.chips} role="group" aria-label="Art">
        {kinds.map((kind) => {
            const active = activeKind === kind.id;

            return (
                <button
                    key={kind.id ?? "all"}
                    type="button"
                    className={
                        active ? `${styles.chip} ${styles.chipActive}` : styles.chip
                    }
                    aria-pressed={active}
                    onClick={() => onKind(kind.id)}
                >
                    {kind.label}
                    {kind.count !== undefined && (
                        <span className={styles.chipCount}>
                            {formatCount(kind.count)}
                        </span>
                    )}
                </button>
            );
        })}
    </div>
);
