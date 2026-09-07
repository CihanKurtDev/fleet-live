import {
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";

import { Avatar } from "../ui/Avatar/Avatar";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { AssignmentStatusMeta } from "./AssignmentRoster";
import type { AssignmentStatusLine } from "./assignmentMeta";
import styles from "./assignment.module.scss";

export type AssignmentPickerItem = {
    id: number;
    title: string;
    status: AssignmentStatusLine;
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
    const labelId = useId();
    const listRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const [focusedIndex, setFocusedIndex] = useState(0);

    useEffect(() => {
        if (open) {
            setSelected(new Set());
            setFocusedIndex(0);
        }
    }, [open]);

    useEffect(() => {
        setFocusedIndex((current) => {
            if (items.length === 0) {
                return 0;
            }

            return Math.min(current, items.length - 1);
        });
    }, [items]);

    useEffect(() => {
        const focused = items[focusedIndex];

        if (!focused) {
            return;
        }

        const node = listRef.current?.querySelector(
            `[data-option-id="${focused.id}"]`,
        );
        node?.scrollIntoView({ block: "nearest" });
    }, [focusedIndex, items]);

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
    const focused = items[focusedIndex];
    const activeId =
        focused !== undefined ? `${labelId}-opt-${focused.id}` : undefined;
    const confirmLabel =
        count === 0
            ? "Zuweisen"
            : count === 1
              ? "1 zuweisen"
              : `${count} zuweisen`;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown" && items.length > 0) {
            event.preventDefault();
            setFocusedIndex((current) => (current + 1) % items.length);
            return;
        }

        if (event.key === "ArrowUp" && items.length > 0) {
            event.preventDefault();
            setFocusedIndex(
                (current) => (current - 1 + items.length) % items.length,
            );
            return;
        }

        const inField = event.target instanceof HTMLInputElement;
        const inButton = event.target instanceof HTMLButtonElement;

        if (event.key === " " && !inField && !inButton) {
            if (focused === undefined || busy) {
                return;
            }

            event.preventDefault();
            toggle(focused.id);
            return;
        }

        if (event.key !== "Enter" || busy || inButton) {
            return;
        }

        if (count > 0) {
            event.preventDefault();
            onConfirm([...selected]);
            return;
        }

        if (focused !== undefined) {
            event.preventDefault();
            toggle(focused.id);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={title} size="lg">
            <div className={styles.picker} onKeyDown={handleKeyDown}>
                <div className={styles.searchWrap}>
                    <svg
                        className={styles.searchIcon}
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                    >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                    </svg>
                    <Input
                        className={styles.search}
                        type="search"
                        size="lg"
                        fullWidth
                        value={search}
                        placeholder={searchPlaceholder}
                        aria-controls={labelId}
                        onChange={(event) =>
                            onSearchChange(event.target.value)
                        }
                    />
                </div>
                {isLoading ? (
                    <p className={styles.pickerStatus}>{loadingLabel}</p>
                ) : items.length === 0 ? (
                    <p className={styles.pickerStatus}>{empty}</p>
                ) : (
                    <div
                        ref={listRef}
                        id={labelId}
                        className={styles.pickerList}
                        role="listbox"
                        tabIndex={0}
                        aria-multiselectable="true"
                        aria-label={title}
                        aria-activedescendant={activeId}
                    >
                        {items.map((item, index) => {
                            const checked = selected.has(item.id);
                            const isFocused = index === focusedIndex;
                            const optionClass =
                                checked || isFocused
                                    ? `${styles.pickerOption} ${styles.pickerOptionActive}`
                                    : styles.pickerOption;

                            return (
                                <div
                                    key={item.id}
                                    id={`${labelId}-opt-${item.id}`}
                                    data-option-id={item.id}
                                    role="option"
                                    aria-selected={checked}
                                    className={optionClass}
                                    onMouseEnter={() => setFocusedIndex(index)}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                    }}
                                    onClick={() => {
                                        if (!busy) {
                                            toggle(item.id);
                                        }
                                    }}
                                >
                                    <Checkbox
                                        className={styles.pickerCheck}
                                        tabIndex={-1}
                                        checked={checked}
                                        disabled={busy}
                                        readOnly
                                    />
                                    <Avatar name={item.title} />
                                    <span className={styles.copy}>
                                        <span className={styles.rowTitle}>
                                            {item.title}
                                        </span>
                                        <AssignmentStatusMeta
                                            status={item.status}
                                        />
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className={styles.pickerFooter}>
                    <div className={styles.pickerFooterStart}>
                        {extraFooter}
                        {count > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => setSelected(new Set())}
                            >
                                Auswahl aufheben
                            </Button>
                        )}
                    </div>
                    <div className={styles.pickerActions}>
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
