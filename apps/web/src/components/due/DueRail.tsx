import type { DueKind, DueKindCounts } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { DueSettingsFields } from "./DueSettingsFields";
import { DUE_GROUPS, dueBasis, dueRuleText } from "./dueView";
import styles from "./DueBoard.module.scss";

interface DueRailProps {
    activeKind: DueKind | null;
    counts?: DueKindCounts;
    checkMonths: number;
    onKind: (kind: DueKind | null) => void;
    onSaved: () => void;
}

/** Kind filter, the rule of each kind, and the company settings. */
export const DueRail = ({
    activeKind,
    counts,
    checkMonths,
    onKind,
    onSaved,
}: DueRailProps) => {
    const kinds: Array<{
        id: DueKind | null;
        label: string;
        count?: number;
        rule: string | null;
    }> = [
        { id: null, label: "Alle", count: counts?.all, rule: null },
        ...DUE_GROUPS.map((group) => {
            const basis = dueBasis(group.kind);

            return {
                id: group.kind,
                label: group.title,
                count: counts?.[group.kind],
                rule:
                    dueRuleText(group.kind, checkMonths) +
                    (basis ? ` Grundlage: ${basis}.` : ""),
            };
        }),
    ];

    return (
        <aside className={styles.rail} aria-label="Filter und Regeln">
            <section>
                <h2 className={styles.railTitle}>Art und Regel</h2>
                <ul className={styles.kindList}>
                    {kinds.map((kind) => {
                        const active = activeKind === kind.id;

                        return (
                            <li key={kind.id ?? "all"}>
                                <button
                                    type="button"
                                    className={[
                                        styles.kindButton,
                                        active && styles.kindActive,
                                        kind.count === 0 && styles.kindEmpty,
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    aria-pressed={active}
                                    onClick={() => onKind(kind.id)}
                                >
                                    <span>{kind.label}</span>
                                    <span className={styles.kindCount}>
                                        {kind.count === undefined
                                            ? ""
                                            : formatCount(kind.count)}
                                    </span>
                                </button>
                                {kind.rule && (
                                    <p className={styles.ruleText}>{kind.rule}</p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section className={styles.railBlock}>
                <ul className={styles.legend} aria-label="Farben">
                    <li className={`${styles.pill} ${styles.tone_block}`}>abgelaufen</li>
                    <li className={`${styles.pill} ${styles.tone_legal}`}>überfällig</li>
                    <li className={`${styles.pill} ${styles.tone_soon}`}>intern / bald</li>
                    <li className={`${styles.pill} ${styles.tone_missing}`}>Datum fehlt</li>
                </ul>
            </section>

            <section className={styles.railBlock}>
                <h2 className={styles.railTitle}>Einstellungen der Firma</h2>
                <DueSettingsFields onSaved={onSaved} />
            </section>
        </aside>
    );
};
