import type { ImportRowOutcome } from "@fleet-live/shared";

import styles from "./importPreviewConfig.module.scss";

function deferredTripHint(message: string): string {
    const plateMatch = message.match(/unterwegs auf\s+(.+?)(?:\.|$)/);
    if (plateMatch?.[1]) {
        return `Noch unterwegs auf ${plateMatch[1].trim()}`;
    }

    return "Noch unterwegs";
}

export function ImportPreviewStatusCell({
    outcome,
}: {
    outcome: ImportRowOutcome;
}) {
    if (outcome.status === "blocked") {
        return (
            <div className={styles.statusCell}>
                <span className={`${styles.statusPill} ${styles.statusPillError}`}>
                    Fehler
                </span>
                <span className={styles.statusSub}>{outcome.issue.message}</span>
            </div>
        );
    }

    if (outcome.status === "deferred") {
        return (
            <div className={styles.statusCell}>
                <span
                    className={`${styles.statusPill} ${styles.statusPillCaution}`}
                >
                    Manuell später
                </span>
                <span className={styles.statusSub}>
                    {deferredTripHint(outcome.issue.message)}
                </span>
            </div>
        );
    }

    if (outcome.status === "ready") {
        return (
            <div className={styles.statusCell}>
                <span className={`${styles.statusPill} ${styles.statusPillReady}`}>
                    Übernehmen
                </span>
            </div>
        );
    }

    return (
        <div className={styles.statusCell}>
            <span className={`${styles.statusPill} ${styles.statusPillMuted}`}>
                Schon da
            </span>
        </div>
    );
}
