import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import layout from "../../styles/detailLayout.module.scss";
import styles from "./assignment.module.scss";

export type AssignmentPickerItem = {
    id: number;
    title: string;
    meta?: string;
};

interface AssignmentPickerProps {
    open: boolean;
    title: string;
    search: string;
    searchPlaceholder: string;
    onSearchChange: (value: string) => void;
    onClose: () => void;
    items: AssignmentPickerItem[];
    isLoading: boolean;
    loadingLabel: string;
    empty: string;
    busy: boolean;
    onConfirm: (ids: number[]) => void;
    extraFooter?: ReactNode;
}

export const AssignmentPicker = ({
    open,
    title,
    search,
    searchPlaceholder,
    onSearchChange,
    onClose,
    items,
    isLoading,
    loadingLabel,
    empty,
    busy,
    onConfirm,
    extraFooter,
}: AssignmentPickerProps) => {
    const [selected, setSelected] = useState<Set<number>>(() => new Set());

    useEffect(() => {
        if (open) {
            setSelected(new Set());
        }
    }, [open]);

    const toggle = (id: number) => {
        setSelected((current) => {
            const next = new Set(current);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    const count = selected.size;
    const confirmLabel =
        count === 0
            ? "Zuweisen"
            : count === 1
              ? "1 zuweisen"
              : `${count} zuweisen`;

    return (
        <Modal open={open} onClose={onClose} title={title} size="lg">
            <div className={styles.picker}>
                <input
                    className={styles.search}
                    type="search"
                    value={search}
                    placeholder={searchPlaceholder}
                    onChange={(event) => onSearchChange(event.target.value)}
                />
                {isLoading ? (
                    <p className={styles.status}>{loadingLabel}</p>
                ) : items.length === 0 ? (
                    <p className={layout.empty}>{empty}</p>
                ) : (
                    <ul className={styles.pickerList}>
                        {items.map((item) => {
                            const checked = selected.has(item.id);

                            return (
                                <li key={item.id}>
                                    <label
                                        className={
                                            checked
                                                ? `${styles.pickerOption} ${styles.pickerOptionChecked}`
                                                : styles.pickerOption
                                        }
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={busy}
                                            onChange={() => toggle(item.id)}
                                        />
                                        <span className={styles.pickerTitle}>
                                            {item.title}
                                        </span>
                                        {item.meta ? (
                                            <span className={styles.pickerMeta}>
                                                {item.meta}
                                            </span>
                                        ) : null}
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className={styles.pickerFooter}>
                    {extraFooter}
                    <div className={styles.pickerActions}>
                        <button
                            type="button"
                            className={styles.footerLink}
                            disabled={count === 0 || busy}
                            onClick={() => setSelected(new Set())}
                        >
                            Auswahl aufheben
                        </button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={onClose}
                        >
                            Abbrechen
                        </Button>
                        <Button
                            size="sm"
                            disabled={count === 0 || busy}
                            onClick={() => onConfirm([...selected])}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
