import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Modal } from "./Modal";
import styles from "./Modal.module.scss";

type ConfirmItem = {
    key: string | number;
    /** Bold name, e.g. the plate. */
    name: string;
    /** Muted text on the right, e.g. "Transporter · Standby". */
    detail?: string;
};

/** So many items are named; the rest is „+ X weitere“. */
const CONFIRM_ITEMS_MAX = 8;

interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    confirmLabel: string;
    busyLabel?: string;
    isBusy?: boolean;
    onConfirm: () => void | Promise<void>;
    /** Löschen bleibt rot; ein harmloser Abschluss nimmt `primary`. */
    confirmVariant?: "danger" | "primary";
    /** Affected items of a bulk action, listed under the sentence. */
    items?: ConfirmItem[];
    /** Spoken name of that list. */
    itemsLabel?: string;
    /** Shown under the list, e.g. a failed request (`role="alert"`). */
    error?: string | null;
}

export const ConfirmDialog = ({
    open,
    onClose,
    title,
    children,
    confirmLabel,
    busyLabel = "Wird ausgeführt…",
    isBusy = false,
    onConfirm,
    confirmVariant = "danger",
    items,
    itemsLabel,
    error,
}: ConfirmDialogProps) => {
    const listed = items?.slice(0, CONFIRM_ITEMS_MAX) ?? [];
    const more = (items?.length ?? 0) - listed.length;

    return (
        <Modal open={open} onClose={onClose} title={title}>
            <div className={styles.confirm}>
                <div className={styles.confirmBody}>
                    {children}
                    {listed.length > 0 && (
                        <ul className={styles.confirmList} aria-label={itemsLabel}>
                            {listed.map((item) => (
                                <li key={item.key} className={styles.confirmItem}>
                                    <span className={styles.confirmItemName}>
                                        {item.name}
                                    </span>
                                    {item.detail && (
                                        <span className={styles.confirmItemDetail}>
                                            {item.detail}
                                        </span>
                                    )}
                                </li>
                            ))}
                            {more > 0 && (
                                <li className={styles.confirmMore}>
                                    + {more} weitere
                                </li>
                            )}
                        </ul>
                    )}
                    {error && (
                        <p className={styles.confirmError} role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <div className={styles.confirmActions}>
                    {/* The safe choice gets the first focus. */}
                    <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        disabled={isBusy}
                        onClick={onClose}
                        data-autofocus
                    >
                        Abbrechen
                    </Button>
                    <Button
                        type="button"
                        variant={confirmVariant}
                        size="md"
                        disabled={isBusy}
                        onClick={onConfirm}
                        busy={isBusy}
                        busyLabel={busyLabel}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
