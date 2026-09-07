import type { ReactNode } from "react";

import { Avatar } from "../ui/Avatar/Avatar";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
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
};

type AssignmentRosterProps = {
    items: AssignmentRosterRow[];
    editing: boolean;
    busy: boolean;
    selectedIds: number[];
    empty: string;
    onToggle: (id: number) => void;
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

export const AssignmentRoster = ({
    items,
    editing,
    busy,
    selectedIds,
    empty,
    onToggle,
    onSetCurrent,
    onClearCurrent,
    onRemove,
}: AssignmentRosterProps) => {
    if (items.length === 0) {
        return <p className={styles.rosterEmpty}>{empty}</p>;
    }

    const selectable = editing && items.length > 1;

    return (
        <ul className={styles.rosterList}>
            {items.map((item) => {
                const checked = selectedIds.includes(item.id);
                const showCurrentAction = editing && !item.currentLocked;

                return (
                    <li
                        key={item.id}
                        className={
                            checked
                                ? `${styles.rosterRow} ${styles.rosterRowSelected}`
                                : styles.rosterRow
                        }
                    >
                        {selectable && (
                            <Checkbox
                                className={styles.rowCheck}
                                checked={checked}
                                disabled={busy}
                                aria-label={item.selectLabel}
                                onChange={() => onToggle(item.id)}
                            />
                        )}
                        <Avatar name={item.avatarName} />
                        <div className={styles.copy}>
                            <div className={styles.rowTitle}>{item.title}</div>
                            <AssignmentStatusMeta status={item.status} />
                        </div>
                        {editing && (
                            <div className={styles.rosterActions}>
                                {showCurrentAction && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                            item.isCurrent
                                                ? onClearCurrent(item.id)
                                                : onSetCurrent(item.id)
                                        }
                                    >
                                        {item.isCurrent
                                            ? "Aufheben"
                                            : "Als aktuell"}
                                    </Button>
                                )}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className={styles.removeBtn}
                                    disabled={busy}
                                    onClick={() => onRemove(item.id)}
                                >
                                    Entfernen
                                </Button>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
};
