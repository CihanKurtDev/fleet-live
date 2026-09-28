import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Modal } from "./Modal";
import styles from "./Modal.module.scss";

interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    confirmLabel: string;
    busyLabel?: string;
    isBusy?: boolean;
    onConfirm: () => void | Promise<void>;
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
}: ConfirmDialogProps) => (
    <Modal open={open} onClose={onClose} title={title}>
        <div className={styles.confirm}>
            <div className={styles.confirmBody}>{children}</div>
            <div className={styles.confirmActions}>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onClick={onClose}
                >
                    Abbrechen
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={isBusy}
                    onClick={onConfirm}
                >
                    {isBusy ? busyLabel : confirmLabel}
                </Button>
            </div>
        </div>
    </Modal>
);
