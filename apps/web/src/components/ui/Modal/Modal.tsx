import { useEffect, useRef, useState, type ReactNode } from "react";
import { skipMotion } from "../../../hooks/usePresence";
import styles from "./Modal.module.scss";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: "md" | "lg";
}

// Fallback if animationend never fires (hidden tab, animations disabled).
const CLOSE_FALLBACK_MS = 400;

export const Modal = ({
    open,
    onClose,
    title,
    children,
    size = "md",
}: ModalProps) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Keeps the content on screen while the dialog plays its closing animation.
    const [rendered, setRendered] = useState(open);

    if (open && !rendered) {
        setRendered(true);
    }

    const instant = skipMotion();
    const closing = !open && rendered && !instant;

    useEffect(() => {
        const dialog = dialogRef.current;

        if (!dialog) {
            return;
        }

        // showModal() liefert Focus-Trap, Escape und ::backdrop
        // ohne zusätzliche Bibliothek.
        if (open && !dialog.open) {
            dialog.showModal();
            const field =
                dialog.querySelector<HTMLElement>(
                    "[data-modal-body] [data-autofocus]",
                ) ??
                dialog.querySelector<HTMLElement>(
                    "[data-modal-body] input, [data-modal-body] textarea, [data-modal-body] select",
                );
            field?.focus();
            return;
        }

        if (!open && dialog.open && instant) {
            dialog.close();
            setRendered(false);
            return;
        }

        if (open || !dialog.open) {
            // Closed natively (form method="dialog"): nothing left to animate.
            if (!open && !dialog.open) {
                setRendered(false);
            }
            return;
        }

        let done = false;
        const finish = () => {
            if (done) {
                return;
            }
            done = true;
            dialog.removeEventListener("animationend", onEnd);
            window.clearTimeout(timer);
            dialog.close();
            setRendered(false);
        };
        const onEnd = (event: AnimationEvent) => {
            if (event.target === dialog) {
                finish();
            }
        };
        const timer = window.setTimeout(finish, CLOSE_FALLBACK_MS);
        dialog.addEventListener("animationend", onEnd);

        return () => {
            // Reopened before the animation ended: stay open, drop the close.
            if (!done) {
                done = true;
                dialog.removeEventListener("animationend", onEnd);
                window.clearTimeout(timer);
            }
        };
    }, [open, instant]);

    return (
        <dialog
            ref={dialogRef}
            className={
                size === "lg"
                    ? `${styles.dialog} ${styles.dialogLg}`
                    : styles.dialog
            }
            data-closing={closing || undefined}
            aria-label={title}
            // Escape stays the native close (a selection mode may take it
            // first by cancelling the event), so it closes without the fade.
            onClose={() => {
                if (open) {
                    onClose();
                }
            }}
            onClick={(event) => {
                // Ein Klick auf den Backdrop trifft das dialog-Element selbst.
                if (event.target === dialogRef.current) {
                    onClose();
                }
            }}
        >
            {rendered && (
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
