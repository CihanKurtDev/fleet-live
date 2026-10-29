import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { DUE_KIND_LABELS, type DueKind, type DueListItem } from "@fleet-live/shared";

import type { WorkshopTarget } from "../../api/workshop";
import { useAuth } from "../../hooks/useAuth";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { RetryMessage } from "../ui/RetryMessage";
import { WorkshopPlanDialog } from "../vehicles/WorkshopPlanDialog";
import { dueWorkshopText } from "../vehicles/workshopText";
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
    /** The page's status line after a write here (a planned stay). */
    onNotice?: (text: string) => void;
}

/** HU and UVV are done in a workshop; their rows plan the stay. */
const WORKSHOP_KINDS: ReadonlySet<DueKind> = new Set<DueKind>(["hu", "uvv"]);

const planContext = (row: DueListItem): string => {
    const label = DUE_KIND_LABELS[row.kind];
    if (row.state === "missing") return `${label}-Datum fehlt`;
    return `${label} fällig ${row.state === "overdue" ? "seit" : "am"} ${dueDateText(row)}`;
};

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
    onNotice,
}: DueGroupProps) => {
    const location = useLocation();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const [open, setOpen] = useState(true);
    const [planning, setPlanning] = useState<WorkshopTarget | null>(null);
    const workshopKind = WORKSHOP_KINDS.has(kind);

    const workshopCell = (row: DueListItem) => {
        if (!workshopKind) {
            return <span className={styles.rowWorkshop} />;
        }

        if (row.workshop) {
            const text = dueWorkshopText(row.workshop, row.kind === "hu" ? "HU" : "UVV");
            return (
                <span className={styles.rowWorkshop}>
                    <b>{text.title}</b>
                    <span>{text.detail}</span>
                </span>
            );
        }

        return (
            <span className={styles.rowWorkshop}>
                {canWrite && row.vehicle_id !== null && (
                    <Button
                        variant="secondary"
                        size="row"
                        onClick={() =>
                            setPlanning({
                                vehicleId: row.vehicle_id as number,
                                licensePlate: row.label,
                                reason: row.kind === "hu" ? "HU" : "UVV",
                                context: planContext(row),
                            })
                        }
                    >
                        Termin planen
                    </Button>
                )}
            </span>
        );
    };
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
                                        className={styles.row}
                                    >
                                        {link ? (
                                            <Link to={link} state={{ from }} className={styles.rowLink}>
                                                {content}
                                            </Link>
                                        ) : (
                                            <div className={styles.rowLink}>{content}</div>
                                        )}
                                        {workshopCell(row)}
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

            {workshopKind && (
                <WorkshopPlanDialog
                    target={planning}
                    onClose={() => setPlanning(null)}
                    onSaved={(_visit, message) => {
                        setPlanning(null);
                        onNotice?.(message);
                        onRetry();
                    }}
                />
            )}
        </section>
    );
};
