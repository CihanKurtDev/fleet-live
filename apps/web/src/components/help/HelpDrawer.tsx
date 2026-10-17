import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../../hooks/useAuth";
import { Button } from "../ui/Button/Button";
import type { HelpPage } from "./helpContent";
import { requestPageTips } from "./tipCatalog";
import styles from "./HelpDrawer.module.scss";

export const HELP_DRAWER_ID = "help-drawer";

interface HelpDrawerProps {
    page: HelpPage;
    /** On its way out: slides away, ignores clicks. */
    closing?: boolean;
    onClose: () => void;
}

/**
 * Side panel with help for the current page. It does not block the page:
 * Escape or "Schließen" closes it and focus returns to the help button.
 */
export const HelpDrawer = ({
    page,
    closing = false,
    onClose,
}: HelpDrawerProps) => {
    const { user } = useAuth();
    const headingRef = useRef<HTMLHeadingElement>(null);
    const restoreFocus = useRef(true);
    const items = page.items.filter(
        (item) => !item.dispatcherOnly || user?.role === "dispatcher",
    );

    useEffect(() => {
        const previous =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;

        headingRef.current?.focus();

        return () => {
            if (restoreFocus.current) {
                previous?.focus();
            }
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                // The drawer takes this Escape; the page under it stays as is.
                event.preventDefault();
                onClose();
            }
        };

        document.addEventListener("keydown", onKey);

        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const tipsPage = page.tips;

    return createPortal(
        <aside
            id={HELP_DRAWER_ID}
            className={styles.drawer}
            data-closing={closing || undefined}
            role="dialog"
            aria-modal="false"
            aria-labelledby="help-drawer-title"
        >
            <header className={styles.head}>
                <h2
                    id="help-drawer-title"
                    ref={headingRef}
                    className={styles.title}
                    tabIndex={-1}
                >
                    Hilfe · {page.title}
                </h2>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Hilfe schließen"
                    onClick={onClose}
                >
                    Schließen
                </Button>
            </header>
            <div className={styles.body}>
                <section className={styles.item}>
                    <h3>Was zeigt diese Seite?</h3>
                    <p>{page.intro}</p>
                </section>
                {items.map((item) => (
                    <section key={item.question} className={styles.item}>
                        <h3>{item.question}</h3>
                        <p>{item.answer}</p>
                    </section>
                ))}
                {tipsPage && (
                    <div className={styles.item}>
                        <button
                            type="button"
                            className={styles.tipsLink}
                            onClick={() => {
                                restoreFocus.current = false;
                                onClose();
                                requestPageTips(tipsPage);
                            }}
                        >
                            Tipps auf dieser Seite noch einmal zeigen
                        </button>
                    </div>
                )}
            </div>
        </aside>,
        document.body,
    );
};
