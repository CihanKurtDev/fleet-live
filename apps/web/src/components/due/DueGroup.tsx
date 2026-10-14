import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import type { DueKind, DueListItem } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { RetryMessage } from "../ui/RetryMessage";
import {
    dueConsequence,
    dueDateText,
    dueGroupNote,
    dueRowLink,
    dueRowRule,
} from "./dueView";
import styles from "./DueBoard.module.scss";

interface DueGroupProps {
    kind: DueKind;
    title: string;
    rows: DueListItem[];
    total: number;
    today: string;
    checkMonths: number;
    isLoading: boolean;
    isFetching: boolean;
    error: string | null;
    onRetry: () => void;
    /** Shown when not all rows of the kind fit. */
    onShowAll?: () => void;
    /** Pagination of the full list of one kind. */
    footer?: ReactNode;
}

/** One kind: collapsible head, its rows, and the way to all of them. */
export const DueGroup = ({
    kind,
    title,
    rows,
    total,
    today,
    checkMonths,
    isLoading,
    isFetching,
    error,
    onRetry,
    onShowAll,
    footer,
}: DueGroupProps) => {
    const location = useLocation();
    const [open, setOpen] = useState(true);
    const from = `${location.pathname}${location.search}`;
    const bodyId = `due-group-${kind}`;
    const partial = !isLoading && rows.length < total;

    return (
        <section className={styles.group} aria-busy={isFetching} aria-label={title}>
            <button
                type="button"
                className={styles.groupHead}
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen((current) => !current)}
            >
                <span className={styles.groupTitle}>
                    <span className={`${styles.dot} ${styles[`dot_${kind}`]}`} />
                    <span className={styles.groupName}>{title}</span>
                    <span className={styles.groupNote}>{dueGroupNote(kind)}</span>
                </span>
                <span className={styles.groupCount}>
                    {isLoading
                        ? ""
                        : partial && !footer
                          ? `${formatCount(rows.length)} von ${formatCount(total)}`
                          : formatCount(total)}
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                </span>
            </button>

            {open && (
                <div id={bodyId}>
                    {error && <RetryMessage message={error} onRetry={onRetry} />}

                    {isLoading && (
                        <p className={styles.groupStatus} aria-live="polite">
                            Wird geladen…
                        </p>
                    )}

                    {rows.length > 0 && (
                        <ul className={styles.rows}>
                            {rows.map((row) => {
                                const link = dueRowLink(row);
                                const consequence = dueConsequence(row, today);
                                const content = (
                                    <>
                                        <span className={styles.rowDue}>
                                            {dueDateText(row)}
                                        </span>
                                        <span className={styles.rowWho}>{row.label}</span>
                                        <span className={styles.rowRule}>
                                            {dueRowRule(row, checkMonths)}
                                        </span>
                                        <span
                                            className={`${styles.pill} ${styles[`tone_${consequence.tone}`]}`}
                                        >
                                            {consequence.label}
                                        </span>
                                    </>
                                );

                                return (
                                    <li
                                        key={`${row.kind}:${row.vehicle_id ?? 0}:${row.driver_id ?? 0}`}
                                    >
                                        {link ? (
                                            <Link to={link} state={{ from }} className={styles.row}>
                                                {content}
                                            </Link>
                                        ) : (
                                            <div className={styles.row}>{content}</div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {partial && onShowAll && (
                        <button type="button" className={styles.showAll} onClick={onShowAll}>
                            Alle {formatCount(total)} anzeigen →
                        </button>
                    )}

                    {footer}
                </div>
            )}
        </section>
    );
};
