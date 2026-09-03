import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Modal.module.scss";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: "md" | "lg";
}

export const Modal = ({
    open,
    onClose,
    title,
    children,
    size = "md",
}: ModalProps) => {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;

        if (!dialog) {
            return;
        }

        // showModal() liefert Focus-Trap, Escape und ::backdrop
        // ohne zusätzliche Bibliothek.
        if (open && !dialog.open) {
            dialog.showModal();
            const field = dialog.querySelector<HTMLElement>(
                "[data-modal-body] input, [data-modal-body] textarea, [data-modal-body] select",
            );
            field?.focus();
        }

        if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    return (
        <dialog
            ref={dialogRef}
            className={
                size === "lg"
                    ? `${styles.dialog} ${styles.dialogLg}`
                    : styles.dialog
            }
            aria-label={title}
            onClose={onClose}
            onClick={(event) => {
                // Ein Klick auf den Backdrop trifft das dialog-Element selbst.
                if (event.target === dialogRef.current) {
                    onClose();
                }
            }}
        >
            {open && (
                <div className={styles.content}>
                    <header className={styles.header}>
                        <h2 className={styles.title}>{title}</h2>

                        <button
                            type="button"
                            className={styles.close}
                            aria-label="Schließen"
                            onClick={onClose}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                aria-hidden="true"
                            >
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </header>

                    <div className={styles.body} data-modal-body>
                        {children}
                    </div>
                </div>
            )}
        </dialog>
    );
};
