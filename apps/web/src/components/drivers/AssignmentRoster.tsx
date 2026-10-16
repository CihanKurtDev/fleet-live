import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import type { useSelectionMode } from "../../hooks/useSelectionMode";
import { Avatar } from "../ui/Avatar/Avatar";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { SelectionBar } from "../ui/ListPage/ListPage";
import { type AssignmentStatusLine } from "./assignmentMeta";
import styles from "./assignment.module.scss";

export type AssignmentRosterRow = {
    id: number;
    title: ReactNode;
    avatarName: string;
    selectLabel: string;
    status: AssignmentStatusLine;
    isCurrent: boolean;
    currentLocked?: boolean;
    removeLocked?: boolean;
};

export type RosterSelection = ReturnType<typeof useSelectionMode<number>>;

type AssignmentRosterProps = {
    items: AssignmentRosterRow[];
    /** Dispatcher: toolbar and row buttons. Viewer: the list only. */
    canWrite: boolean;
    busy: boolean;
    /** Owned by the parent so it can end the mode on close or confirm. */
    selection: RosterSelection;
    /** Spoken name of the list. */
    listLabel: string;
    /** Primary toolbar action, e.g. "Zuweisen". */
    assignLabel: string;
    empty: string;
    error?: string | null;
    onAssign: () => void;
    onRemoveSelected: (ids: number[]) => void;
    onSetCurrent: (id: number) => void;
    onClearCurrent: (id: number) => void;
    onRemove: (id: number) => void;
};

export const AssignmentStatusMeta = ({
    status,
}: {
    status: AssignmentStatusLine;
}) => (
    <p className={styles.statusLine}>
        {status.eligibility}
        {status.activity ? (
            <>
                {" · "}
                <span className={styles.activity}>
                    <span
                        className={`${styles.dot} ${styles[status.activity.tone]}`}
                    />
                    {status.activity.label}
                </span>
            </>
        ) : null}
        {status.plate ? (
            <>
                {" · "}
                <span className={styles.plate}>{status.plate}</span>
            </>
        ) : null}
    </p>
);

/**
 * A small list page inside a dialog or panel (`rules/design-system.md`,
 * "Dialogs with a list"): a 54 px toolbar (Zuweisen, Auswählen) that the
 * selection bar replaces at the same height, 48 px rows, one set of row
 * buttons. Selection is a mode; row buttons and checkboxes never show
 * together.
 */
export const AssignmentRoster = ({
    items,
    canWrite,
    busy,
    selection,
    listLabel,
    assignLabel,
    empty,
    error,
    onAssign,
    onRemoveSelected,
    onSetCurrent,
    onClearCurrent,
    onRemove,
}: AssignmentRosterProps) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const selectable = canWrite && items.length > 1;
    const selecting = selectable && selection.active;
    const { stop } = selection;

    // Fewer than two entries (or a viewer): nothing to select, leave the mode.
    useEffect(() => {
        if (selection.active && !selectable) {
            stop();
        }
    }, [selection.active, selectable, stop]);

    // Inside a dialog the first Escape ends the mode, the second closes it.
    useEffect(() => {
        const dialog = rootRef.current?.closest("dialog");

        if (!selecting || !dialog) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key === "Escape" &&
                !event.defaultPrevented &&
                dialog.open
            ) {
                event.preventDefault();
                stop();
            }
        };
        const onCancel = (event: Event) => {
            event.preventDefault();
            stop();
        };

        dialog.addEventListener("keydown", onKeyDown);
        dialog.addEventListener("cancel", onCancel);
        return () => {
            dialog.removeEventListener("keydown", onKeyDown);
            dialog.removeEventListener("cancel", onCancel);
        };
    }, [selecting, stop]);

    // The "Auswählen" button is gone after the click; keep focus in the list.
    useEffect(() => {
        if (selecting) {
            listRef.current?.focus();
        }
    }, [selecting]);

    const lockedIds = new Set(
        items.filter((item) => item.removeLocked).map((item) => item.id),
    );
    const selectedIds = selection.selectedIds;
    const count = selection.count;

    const onRowClickCapture = (
        event: MouseEvent<HTMLLIElement>,
        id: number,
    ) => {
        if (!selecting) {
            return;
        }

        const target = event.target as HTMLElement;

        // The checkbox handles itself; everything else, including the name
        // link, toggles the row and does not navigate.
        if (target.closest("input")) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (!busy && !lockedIds.has(id)) {
            selection.toggle(id);
        }
    };

    return (
        <div ref={rootRef} className={styles.roster}>
            {canWrite && (
                <div className={styles.barSlot}>
                    {selecting ? (
                        <SelectionBar
                            count={count}
                            pageCheckbox={{
                                ...selection.pageCheckbox,
                                disabled:
                                    busy || selection.pageCheckbox.disabled,
                            }}
                            actions={
                                <Button
                                    variant="dangerOutline"
                                    size="toolbar"
                                    disabled={busy || count === 0}
                                    onClick={() => onRemoveSelected(selectedIds)}
                                >
                                    {count} entfernen
                                </Button>
                            }
                            onDone={stop}
                        />
                    ) : (
                        <div className={styles.toolbar}>
                            <Button
                                variant="primary"
                                size="toolbar"
                                disabled={busy}
                                onClick={onAssign}
                            >
                                {assignLabel}
                            </Button>
                            {selectable && (
                                <Button
                                    variant="secondary"
                                    size="toolbar"
                                    disabled={busy}
                                    onClick={selection.start}
                                >
                                    Auswählen
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className={styles.rosterScroll}>
                {items.length === 0 ? (
                    <p className={styles.rosterEmpty}>{empty}</p>
                ) : (
                    <ul
                        ref={listRef}
                        tabIndex={-1}
                        aria-label={listLabel}
                        className={styles.rosterList}
                    >
                        {items.map((item) => {
                            const checked = selectedIds.includes(item.id);
                            const locked = lockedIds.has(item.id);
                            const classes = [
                                styles.rosterRow,
                                selecting && styles.rosterRowSelecting,
                                checked && styles.rosterRowSelected,
                            ]
                                .filter(Boolean)
                                .join(" ");

                            return (
                                <li
                                    key={item.id}
                                    className={classes}
                                    onClickCapture={(event) =>
                                        onRowClickCapture(event, item.id)
                                    }
                                >
                                    {selecting && (
                                        <Checkbox
                                            checked={checked}
                                            disabled={busy || locked}
                                            aria-label={item.selectLabel}
                                            onChange={() =>
                                                selection.toggle(item.id)
                                            }
                                        />
                                    )}
                                    <Avatar name={item.avatarName} />
                                    <div className={styles.copy}>
                                        <div className={styles.rowTitle}>
                                            {item.title}
                                        </div>
                                        <AssignmentStatusMeta
                                            status={item.status}
                                        />
                                    </div>
                                    {canWrite && !selecting && (
                                        <div className={styles.rosterActions}>
                                            {!item.currentLocked && (
                                                <Button
                                                    variant="secondary"
                                                    size="row"
                                                    className={styles.rowButton}
                                                    disabled={busy}
                                                    onClick={() =>
                                                        item.isCurrent
                                                            ? onClearCurrent(
                                                                  item.id,
                                                              )
                                                            : onSetCurrent(
                                                                  item.id,
                                                              )
                                                    }
                                                >
                                                    {item.isCurrent
                                                        ? "Aufheben"
                                                        : "Als aktuell"}
                                                </Button>
                                            )}
                                            <Button
                                                variant="dangerOutline"
                                                size="row"
                                                className={styles.rowButton}
                                                disabled={
                                                    busy ||
                                                    Boolean(item.removeLocked)
                                                }
                                                onClick={() =>
                                                    onRemove(item.id)
                                                }
                                            >
                                                Entfernen
                                            </Button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
        </div>
    );
};
