import {
    WORKSHOP_REASON_LABELS,
    WORKSHOP_STATE_LABELS,
    type VehicleWorkshop,
} from "@fleet-live/shared";

import { formatIsoDate, formatTimestamp } from "../../utils/dateTime";
import { Modal } from "../ui/Modal/Modal";
import { formatEuro, workshopEventText } from "./workshopText";
import styles from "./workshop.module.scss";

interface WorkshopHistoryDialogProps {
    open: boolean;
    licensePlate: string;
    workshop: VehicleWorkshop | null;
    onClose: () => void;
}

/** The open stay with every change, then the earlier stays with their cost. */
export const WorkshopHistoryDialog = ({
    open,
    licensePlate,
    workshop,
    onClose,
}: WorkshopHistoryDialogProps) => (
    <Modal open={open} onClose={onClose} title="Werkstatt">
        <p className={styles.context}>
            {licensePlate} ·{" "}
            {workshop?.open ? "der laufende und die früheren Aufenthalte" : "die früheren Aufenthalte"}
        </p>

        {workshop?.open && (
            <section className={styles.history} aria-label="Laufender Aufenthalt">
                <h3 className={styles.historyHead}>
                    <b>{WORKSHOP_REASON_LABELS[workshop.open.reason]}</b>
                    <span>bei {workshop.open.place}</span>
                </h3>
                <ol className={styles.historyList}>
                    {workshop.events.map((event) => (
                        <li key={event.id} className={styles.historyRow}>
                            <span className={styles.time}>{formatTimestamp(event.created_at)}</span>
                            <span className={styles.what}>{workshopEventText(event)}</span>
                            <span>{event.actor_name ?? "—"}</span>
                        </li>
                    ))}
                </ol>
                {workshop.open.note && (
                    <p className={styles.historyNote}>
                        <b>Notiz:</b> {workshop.open.note}
                    </p>
                )}
            </section>
        )}

        <section className={styles.history} aria-label="Frühere Aufenthalte">
            <h3 className={styles.historyHead}>
                <b>Früher</b>
                <span>
                    {workshop?.past.length === 1
                        ? "1 Aufenthalt"
                        : `${workshop?.past.length ?? 0} Aufenthalte`}
                </span>
            </h3>
            {workshop && workshop.past.length > 0 ? (
                <ol className={styles.historyList}>
                    {workshop.past.map((visit) => (
                        <li key={visit.id} className={styles.historyRow}>
                            <span className={styles.time}>
                                {formatIsoDate(visit.finished_on ?? visit.planned_on)}
                            </span>
                            <span className={styles.what}>
                                {WORKSHOP_REASON_LABELS[visit.reason]}{" "}
                                <span className={styles.muted}>
                                    · {visit.place}
                                    {visit.state === "CANCELLED"
                                        ? ` · ${WORKSHOP_STATE_LABELS.CANCELLED}`
                                        : ""}
                                </span>
                            </span>
                            <span className={styles.cost}>
                                {visit.cost_cents !== null ? formatEuro(visit.cost_cents) : "—"}
                            </span>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className={styles.historyNote}>Noch kein abgeschlossener Aufenthalt.</p>
            )}
        </section>
    </Modal>
);
