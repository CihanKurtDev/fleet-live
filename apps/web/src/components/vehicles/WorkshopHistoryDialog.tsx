import {
    DAMAGE_SEVERITY_LABELS,
    DAMAGE_STATE_LABELS,
    workshopReasonsText,
    WORKSHOP_STATE_LABELS,
    type Damage,
    type VehicleWorkshop,
} from "@fleet-live/shared";

import { useState } from "react";

import { ApiError } from "../../api/client";
import { addWorkshopCost } from "../../api/workshop";
import { formatIsoDate, formatTimestamp } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { formatEuro, workshopEventText } from "./workshopText";
import styles from "./workshop.module.scss";

interface WorkshopHistoryDialogProps {
    open: boolean;
    licensePlate: string;
    workshop: VehicleWorkshop | null;
    /** The vehicle's damages, open and closed. */
    damages?: Damage[];
    /** Dispatchers add the cost of a finished stay when the invoice comes. */
    canWrite?: boolean;
    onClose: () => void;
    onChanged?: (message: string) => void;
}

/** The cost cell of a finished stay: the amount, or „Kosten nachtragen“ for a dispatcher. */
const CostCell = ({
    visitId,
    cents,
    canWrite,
    onChanged,
}: {
    visitId: number;
    cents: number | null;
    canWrite: boolean;
    onChanged?: (message: string) => void;
}) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (cents !== null) {
        return <span className={styles.cost}>{formatEuro(cents)}</span>;
    }
    if (!canWrite) {
        return <span className={styles.muted}>Kosten offen</span>;
    }
    if (!editing) {
        return (
            <button type="button" className={styles.inlineAction} onClick={() => setEditing(true)}>
                Kosten nachtragen
            </button>
        );
    }

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const { data } = await addWorkshopCost(visitId, value);
            setEditing(false);
            onChanged?.(`Kosten ${formatEuro(data.cost_cents ?? 0)} nachgetragen.`);
        } catch (caught) {
            setError(caught instanceof ApiError ? (caught.fields?.cost ?? caught.message) : "Speichern hat nicht geklappt.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className={styles.costEdit}>
            <Input
                size="sm"
                inputMode="decimal"
                placeholder="z. B. 412,80"
                aria-label="Kosten in Euro"
                aria-invalid={error !== null}
                value={value}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void save();
                    }
                }}
            />
            <Button size="row" variant="secondary" busy={busy} busyLabel="Speichert…" onClick={save}>
                Speichern
            </Button>
            {error && <small className={styles.costError}>{error}</small>}
        </span>
    );
};

/** The open stay with every change, then the earlier stays with their cost. */
export const WorkshopHistoryDialog = ({
    open,
    licensePlate,
    workshop,
    damages = [],
    canWrite = false,
    onClose,
    onChanged,
}: WorkshopHistoryDialogProps) => (
    <Modal open={open} onClose={onClose} title="Werkstatt">
        <p className={styles.context}>
            {licensePlate} ·{" "}
            {workshop?.open ? "der laufende und die früheren Aufenthalte" : "die früheren Aufenthalte"}
        </p>

        {workshop?.open && (
            <section className={styles.history} aria-label="Laufender Aufenthalt">
                <h3 className={styles.historyHead}>
                    <b>{workshopReasonsText(workshop.open.reasons)}</b>
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
                                {workshopReasonsText(visit.reasons)}{" "}
                                <span className={styles.muted}>
                                    · {visit.place}
                                    {visit.state === "CANCELLED"
                                        ? ` · ${WORKSHOP_STATE_LABELS.CANCELLED}`
                                        : ""}
                                </span>
                            </span>
                            {visit.state === "DONE" ? (
                                <CostCell
                                    visitId={visit.id}
                                    cents={visit.cost_cents}
                                    canWrite={canWrite}
                                    onChanged={onChanged}
                                />
                            ) : (
                                <span className={styles.cost}>—</span>
                            )}
                        </li>
                    ))}
                </ol>
            ) : (
                <p className={styles.historyNote}>Noch kein abgeschlossener Aufenthalt.</p>
            )}
        </section>

        {damages.length > 0 && (
            <section className={styles.history} aria-label="Schäden">
                <h3 className={styles.historyHead}>
                    <b>Schäden</b>
                    <span>{damages.length === 1 ? "1 Schaden" : `${damages.length} Schäden`}</span>
                </h3>
                <ol className={styles.historyList}>
                    {damages.map((damage) => (
                        <li key={damage.id} className={styles.historyRow}>
                            <span className={styles.time}>
                                {formatIsoDate(damage.occurred_on)}
                                {damage.occurred_time ? ` ${damage.occurred_time}` : ""}
                            </span>
                            <span className={styles.what}>
                                {damage.description}{" "}
                                <span className={styles.muted}>
                                    · {DAMAGE_SEVERITY_LABELS[damage.severity]}
                                    {damage.drivable ? "" : " · nicht fahrbereit"}
                                    {damage.driver_name ? ` · gefahren von ${damage.driver_name}` : ""}
                                </span>
                            </span>
                            <span>
                                {DAMAGE_STATE_LABELS[damage.state]}
                                {damage.closed_on ? ` ${formatIsoDate(damage.closed_on)}` : ""}
                            </span>
                        </li>
                    ))}
                </ol>
            </section>
        )}
    </Modal>
);
