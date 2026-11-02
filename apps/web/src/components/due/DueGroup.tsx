import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { DUE_KIND_LABELS, type DueKind, type DueListItem } from "@fleet-live/shared";

import { updateWorkshopVisit, type WorkshopTarget } from "../../api/workshop";
import { useAuth } from "../../hooks/useAuth";
import { formatIsoDate } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { DeadlineEditDialog, type DeadlineTarget } from "../briefing/DeadlineEditDialog";
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
    const [editing, setEditing] = useState<DeadlineTarget | null>(null);
    const workshopKind = WORKSHOP_KINDS.has(kind);

    /**
     * The row's next step outside the row link: HU and UVV go to the
     * workshop; a licence row takes the new date or the check, in the
     * driver's edit dialog.
     */
    const actionCell = (row: DueListItem) => {
        if (!workshopKind) {
            return (
                <span className={styles.rowAction}>
                    {canWrite && row.driver_id !== null && (
                        <Button
                            variant="secondary"
                            size="row"
                            onClick={() =>
                                setEditing({
                                    vehicle_id: null,
                                    driver_id: row.driver_id,
                                    due_kind: row.kind,
                                    subject: row.label,
                                })
                            }
                        >
                            {row.kind === "licence_check"
                                ? "Kontrolle eintragen"
                                : row.due_on === null
                                  ? "Datum eintragen"
                                  : "Neues Ablaufdatum"}
                        </Button>
                    )}
                </span>
            );
        }

        const reason = row.kind === "hu" ? "HU" : "UVV";
        const stay = row.workshop;
        // A stay for something else is running: the deadline joins it, one visit.
        if (stay && !stay.reasons.includes(reason) && canWrite) {
            const text = dueWorkshopText(stay, reason);
            return (
                <span className={styles.rowAction} title={`${text.title}: ${text.detail}`}>
                    <Button
                        variant="secondary"
                        size="row"
                        onClick={() => {
                            void updateWorkshopVisit(stay.id, { reasons: [...stay.reasons, reason] })
                                .then(() => {
                                    onNotice?.(`${reason} für ${row.label} kommt zum Termin am ${formatIsoDate(stay.planned_on)}.`);
                                    onRetry();
                                })
                                .catch((caught: unknown) =>
                                    onNotice?.(caught instanceof Error ? caught.message : "Nicht gespeichert."),
                                );
                        }}
                    >
                        Zum Termin dazu
                    </Button>
                </span>
            );
        }

        if (stay) {
            const text = dueWorkshopText(stay, reason);
            return (
                <span className={styles.rowAction}>
                    <b>{text.title}</b>
                    <span>{text.detail}</span>
                </span>
            );
        }

        return (
            <span className={styles.rowAction}>
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
                                        {actionCell(row)}
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

            {!workshopKind && (
                <DeadlineEditDialog
                    item={editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        onNotice?.(`${editing?.subject ?? "Fahrer"} gespeichert.`);
                        setEditing(null);
                        onRetry();
                    }}
                />
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
