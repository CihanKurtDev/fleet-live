import type { Alert } from "@fleet-live/shared";

import { formatTimestamp } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { selectionSummary, warningCount } from "./alertLabels";
import styles from "./AlertBulkResolve.module.scss";

/** So viele Zeilen nennt der Dialog, der Rest ist „+ X weitere“. */
const DIALOG_LIST_MAX = 8;

interface AlertSelectionBarProps {
    rows: Alert[];
    onClear: () => void;
    onResolve: () => void;
}

export const AlertSelectionBar = ({
    rows,
    onClear,
    onResolve,
}: AlertSelectionBarProps) => (
    <div
        className={styles.bar}
        role="region"
        aria-label="Auswahl"
    >
        <p className={styles.summary}>
            <strong className={styles.count}>{rows.length} ausgewählt</strong>
            <span className={styles.detail}>{selectionSummary(rows)}</span>
        </p>
        <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={onClear}>
                Auswahl aufheben
            </Button>
            <Button variant="primary" size="sm" onClick={onResolve}>
                {rows.length} erledigen
            </Button>
        </div>
    </div>
);

interface AlertBulkResolveDialogProps {
    rows: Alert[] | null;
    isBusy: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: () => void;
}

export const AlertBulkResolveDialog = ({
    rows,
    isBusy,
    error,
    onClose,
    onConfirm,
}: AlertBulkResolveDialogProps) => {
    const count = rows?.length ?? 0;
    const listed = rows?.slice(0, DIALOG_LIST_MAX) ?? [];
    const more = count - listed.length;

    return (
        <ConfirmDialog
            open={rows !== null}
            onClose={onClose}
            title={`${warningCount(count)} erledigen?`}
            confirmLabel={`${count} erledigen`}
            busyLabel="Wird erledigt…"
            confirmVariant="primary"
            isBusy={isBusy}
            onConfirm={onConfirm}
        >
            <p>
                {count === 1 ? "Sie verschwindet" : "Sie verschwinden"} aus
                „Offen“ und {count === 1 ? "bleibt" : "bleiben"} unter
                „Erledigt“ sichtbar.
            </p>
            <ul className={styles.list} aria-label="Ausgewählte Warnungen">
                {listed.map((row) => (
                    <li key={row.id} className={styles.item}>
                        <span className={styles.plate}>
                            {row.license_plate}
                        </span>
                        <span className={styles.time}>
                            {formatTimestamp(row.created_at)}
                        </span>
                    </li>
                ))}
                {more > 0 && (
                    <li className={styles.more}>+ {more} weitere</li>
                )}
            </ul>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
        </ConfirmDialog>
    );
};
