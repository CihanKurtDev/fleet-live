import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../ui/Button/Button";
import styles from "./VehicleMoreMenu.module.scss";

interface VehicleMoreMenuProps {
    onDelete: () => void;
}

/** "⋯" next to Bearbeiten. Holds the rare, destructive vehicle actions. */
export const VehicleMoreMenu = ({ onDelete }: VehicleMoreMenuProps) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) {
            return;
        }

        menuRef.current
            ?.querySelector<HTMLButtonElement>("[role='menuitem']")
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
                size="sm"
                aria-label="Weitere Aktionen"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((current) => !current)}
            >
                <span aria-hidden="true">⋯</span>
            </Button>

            {open && (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label="Weitere Aktionen"
                    className={styles.menu}
                >
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.danger}
                        onClick={() => {
                            setOpen(false);
                            onDelete();
                        }}
                    >
                        Fahrzeug löschen
                    </button>
                </div>
            )}
        </div>
    );
};
