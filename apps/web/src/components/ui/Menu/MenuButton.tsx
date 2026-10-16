import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "../Button/Button";
import styles from "./MenuButton.module.scss";

export type MenuItem = {
    key: string;
    label: ReactNode;
    onSelect: () => void;
    /** Red text for destructive items. */
    tone?: "danger";
    /**
     * Set on every item of a choice menu (filters): the items become
     * `menuitemradio` with `aria-checked`.
     */
    checked?: boolean;
    disabled?: boolean;
};

interface MenuButtonProps {
    /** Visible trigger text; a „▾“ follows unless `caret` is false. */
    label: ReactNode;
    /** Spoken trigger name when `label` alone is not enough. */
    ariaLabel?: string;
    /** Name of the opened menu. */
    menuLabel: string;
    items: MenuItem[];
    caret?: boolean;
    /** Trigger shows that one of its choices is active. */
    active?: boolean;
    disabled?: boolean;
    busy?: boolean;
    /** Which edge the menu lines up with. */
    align?: "start" | "end";
    size?: "sm" | "toolbar";
}

/**
 * A button that opens a short menu. Escape or a click outside closes it;
 * choosing an item closes it and runs the item.
 */
export const MenuButton = ({
    label,
    ariaLabel,
    menuLabel,
    items,
    caret = true,
    active = false,
    disabled = false,
    busy = false,
    align = "end",
    size = "toolbar",
}: MenuButtonProps) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const isChoice = items.some((item) => item.checked !== undefined);

    useEffect(() => {
        if (!open) {
            return;
        }

        menuRef.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus();

        const close = (returnFocus: boolean) => {
            setOpen(false);

            if (returnFocus) {
                rootRef.current
                    ?.querySelector<HTMLButtonElement>("button")
                    ?.focus();
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                close(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                // The menu takes this Escape; a selection mode stays on.
                event.preventDefault();
                close(true);
            }
        };

        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div ref={rootRef} className={styles.root}>
            <Button
                variant="secondary"
                size={size}
                className={active ? styles.active : undefined}
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-busy={busy || undefined}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                {label}
                {caret && (
                    <span className={styles.caret} aria-hidden="true">
                        ▾
                    </span>
                )}
            </Button>

            {open && (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label={menuLabel}
                    className={
                        align === "start"
                            ? `${styles.menu} ${styles.alignStart}`
                            : styles.menu
                    }
                >
                    {items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role={isChoice ? "menuitemradio" : "menuitem"}
                            aria-checked={isChoice ? Boolean(item.checked) : undefined}
                            disabled={item.disabled}
                            className={
                                item.tone === "danger" ? styles.danger : undefined
                            }
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
