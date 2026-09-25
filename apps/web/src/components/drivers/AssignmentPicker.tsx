import {
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";

import { formatCount } from "../../utils/formatCount";
import { Avatar } from "../ui/Avatar/Avatar";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { TablePagination } from "../ui/Table/TablePagination";
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
    page: number;
    pageCount: number;
    total: number;
    onPageChange: (page: number) => void;
    searchPending?: boolean;
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
    page,
    pageCount,
    total,
    onPageChange,
    searchPending = false,
}: AssignmentPickerProps) => {
    const labelId = useId();
    const listRef = useRef<HTMLDivElement>(null);
    const scrollFocusedRef = useRef(false);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);

    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setSelected(new Set());
            setFocusedIndex(0);
        }
    }

    const maxFocusedIndex = items.length === 0 ? 0 : items.length - 1;
    if (focusedIndex > maxFocusedIndex) {
        setFocusedIndex(maxFocusedIndex);
    }

    useEffect(() => {
        if (!scrollFocusedRef.current) {
            return;
        }

        scrollFocusedRef.current = false;
        const focused = items[focusedIndex];

        if (!focused) {
            return;
        }

        const node = listRef.current?.querySelector(
            `[data-option-id="${focused.id}"]`,
        );
        node?.scrollIntoView({ block: "nearest" });
    }, [focusedIndex, items]);

    useEffect(() => {
        if (!open) {
            return;
        }

        listRef.current?.scrollTo({ top: 0 });
    }, [open, page]);

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
    const waiting = isLoading || searchPending;
    const pagerBusy = busy || waiting;
    // Beim Seitenwechsel total nicht durch „Laden…“/0 ersetzen.
    const summary =
        total > 0
            ? `${formatCount(total)} Treffer`
            : waiting
              ? "Laden…"
              : "0 Treffer";

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown" && items.length > 0) {
            event.preventDefault();
            scrollFocusedRef.current = true;
            setFocusedIndex((current) => (current + 1) % items.length);
            return;
        }

        if (event.key === "ArrowUp" && items.length > 0) {
            event.preventDefault();
            scrollFocusedRef.current = true;
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
                <div className={styles.searchBlock}>
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
                    <p className={styles.pickerSummary} aria-live="polite">
                        {summary}
                    </p>
                </div>

                {items.length === 0 ? (
                    <p className={styles.pickerStatus}>
                        {waiting ? loadingLabel : empty}
                    </p>
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
                        aria-busy={waiting}
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

                {pageCount > 1 && (
                    <div className={styles.pickerPager}>
                        <TablePagination
                            compact
                            page={page}
                            pageCount={pageCount}
                            total={total}
                            onPageChange={onPageChange}
                            disabled={pagerBusy}
                        />
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
