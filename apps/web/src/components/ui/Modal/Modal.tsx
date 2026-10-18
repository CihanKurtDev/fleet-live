import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import { skipMotion } from "../../../hooks/usePresence";
import { Button } from "../Button/Button";
import styles from "./Modal.module.scss";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: "md" | "lg";
    /**
     * Forms: once a field was changed, closing with Escape, the backdrop or
     * the × asks before the input is thrown away. Buttons inside the
     * content (Abbrechen, a finished save) close without asking.
     */
    guardUnsaved?: boolean;
}

// Fallback if animationend never fires (hidden tab, animations disabled).
const CLOSE_FALLBACK_MS = 400;

export const Modal = ({
    open,
    onClose,
    title,
    children,
    size = "md",
    guardUnsaved = false,
}: ModalProps) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const confirmRef = useRef<HTMLDivElement>(null);
    const askerRef = useRef<HTMLElement | null>(null);
    // A click closes only if the press began on the backdrop too: a text
    // selection dragged out of a field ends there and must not close.
    const pressedBackdrop = useRef(false);
    // Keeps the content on screen while the dialog plays its closing animation.
    const [rendered, setRendered] = useState(open);
    const [dirty, setDirty] = useState(false);
    const [asking, setAsking] = useState(false);

    if (open && !rendered) {
        setRendered(true);
    }

    if (!open && (dirty || asking)) {
        setDirty(false);
        setAsking(false);
    }

    const askToDiscard = () => {
        askerRef.current =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : document.body;
        setAsking(true);
    };

    const requestClose = () => {
        if (guardUnsaved && dirty) {
            askToDiscard();
            return;
        }

        onClose();
    };

    const discard = () => {
        setAsking(false);
        setDirty(false);
        onClose();
    };

    // The × and the backdrop ask; Escape answers the question with "no".
    const handleDismissKey = (event: KeyboardEvent<HTMLDialogElement>) => {
        if (event.key !== "Escape") {
            return;
        }

        if (asking) {
            event.preventDefault();
            event.stopPropagation();
            setAsking(false);
        } else if (guardUnsaved && dirty) {
            event.preventDefault();
            event.stopPropagation();
            askToDiscard();
        }
    };

    useEffect(() => {
        if (asking) {
            confirmRef.current
                ?.querySelector<HTMLElement>("[data-autofocus]")
                ?.focus();
            return;
        }

        // Back to the field that had focus; a click on the backdrop leaves
        // focus on the dialog itself, then the first field takes it.
        const back = askerRef.current;
        askerRef.current = null;

        if (back) {
            const body = dialogRef.current?.querySelector("[data-modal-body]");
            (body?.contains(back)
                ? back
                : body?.querySelector<HTMLElement>("input, select, textarea")
            )?.focus();
        }
    }, [asking]);

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
            onKeyDown={handleDismissKey}
            onClose={() => {
                if (open) {
                    onClose();
                }
            }}
            onPointerDown={(event) => {
                pressedBackdrop.current = event.target === dialogRef.current;
            }}
            onInput={() => {
                if (guardUnsaved && !dirty) {
                    setDirty(true);
                }
            }}
            onClick={(event) => {
                // Ein Klick auf den Backdrop trifft das dialog-Element selbst.
                const onBackdrop =
                    event.target === dialogRef.current &&
                    pressedBackdrop.current;
                pressedBackdrop.current = false;

                if (onBackdrop) {
                    requestClose();
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
                            onClick={requestClose}
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

                    {/* Hidden, not unmounted: the form keeps its input. */}
                    <div className={styles.body} data-modal-body hidden={asking}>
                        {children}
                    </div>

                    {asking && (
                        <div
                            ref={confirmRef}
                            className={`${styles.body} ${styles.confirm}`}
                            role="group"
                            aria-label="Eingaben verwerfen?"
                        >
                            <div className={styles.confirmBody}>
                                <p>
                                    <strong>Eingaben verwerfen?</strong>
                                </p>
                                <p>
                                    Was du hier eingetragen hast, ist noch nicht
                                    gespeichert.
                                </p>
                            </div>
                            <div className={styles.confirmActions}>
                                {/* The safe choice gets the first focus. */}
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="md"
                                    onClick={() => setAsking(false)}
                                    data-autofocus
                                >
                                    Weiter bearbeiten
                                </Button>
                                <Button
                                    type="button"
                                    variant="danger"
                                    size="md"
                                    onClick={discard}
                                >
                                    Verwerfen
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </dialog>
    );
};
