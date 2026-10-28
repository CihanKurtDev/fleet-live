import type { Trip, TripEvent } from "@fleet-live/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { WarningChip } from "../alerts/WarningChip";
import { Button } from "../ui/Button/Button";
import { formatClock, formatDay } from "../../utils/dateTime";
import {
    eventDetail,
    eventHeadline,
    eventWhere,
    formatKm,
    speedingSummary,
} from "./tripEventText";
import styles from "./TripPanel.module.scss";

type TripPanelProps = {
    trip: Trip;
    events: readonly TripEvent[];
    selectedId: number | null;
    /** Events the replay is at right now. */
    litIds: ReadonlySet<number>;
    onSelect: (event: TripEvent) => void;
    /** Dispatcher: the trip's speeding warning can be resolved here. */
    canResolve: boolean;
    /** Resolves these warnings of the trip. */
    onResolve: (alertIds: number[]) => Promise<void>;
};

/**
 * The trip's speeding warnings in the inbox. Usually one; a run that went
 * on across a turnaround still belongs to the previous trip's warning, so
 * a trip can hold two.
 */
const speedingAlerts = (events: readonly TripEvent[]) => {
    const all = new Set<number>();
    const open = new Set<number>();

    for (const event of events) {
        if (event.type !== "SPEEDING" || event.alert_id === null) {
            continue;
        }

        all.add(event.alert_id);

        if (event.alert_open) {
            open.add(event.alert_id);
        }
    }

    return { all: all.size, open: [...open] };
};

const warningText = (open: number, all: number) => {
    if (open === 0) {
        return all > 1 ? "Tempo-Warnungen erledigt" : "Tempo-Warnung erledigt";
    }

    return open > 1 ? `${open} Tempo-Warnungen offen` : "Tempo-Warnung offen";
};

/**
 * Beside the map of a framed trip: who drove, how far and how fast, the
 * trip's warning with its one action, and every event in the order it
 * happened. A row shows that event on the map.
 */
export const TripPanel = ({
    trip,
    events,
    selectedId,
    litIds,
    onSelect,
    canResolve,
    onResolve,
}: TripPanelProps) => {
    const [resolving, setResolving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const listRef = useRef<HTMLOListElement>(null);
    const alerts = speedingAlerts(events);
    const speeding = events.some((event) => event.type === "SPEEDING");
    const closed = trip.ended_at !== null;

    // The replay reaching an event keeps its row in view.
    const firstLit = events.find((event) => litIds.has(event.id))?.id;
    useEffect(() => {
        if (firstLit === undefined) {
            return;
        }

        listRef.current
            ?.querySelector(`[data-event="${firstLit}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [firstLit]);

    const resolve = async (alertIds: number[]) => {
        setResolving(true);
        setMessage(null);

        try {
            await onResolve(alertIds);
            setMessage(
                alertIds.length > 1
                    ? `${alertIds.length} Tempo-Warnungen erledigt.`
                    : "Tempo-Warnung erledigt.",
            );
        } catch (caught: unknown) {
            setMessage(
                caught instanceof Error
                    ? caught.message
                    : "Warnung konnte nicht erledigt werden.",
            );
        } finally {
            setResolving(false);
        }
    };

    return (
        <aside className={styles.panel} aria-label="Ausgewählte Fahrt">
            <header className={styles.head}>
                <p className={styles.label}>Fahrt · {formatDay(trip.started_at)}</p>
                <p className={styles.when}>
                    {formatClock(trip.started_at)}
                    {" – "}
                    {closed ? formatClock(trip.ended_at) : "läuft"}
                </p>
            </header>

            <dl className={styles.facts}>
                <div>
                    <dt>Fahrer</dt>
                    <dd>
                        {trip.driver_id !== null && trip.driver_name ? (
                            <Link to={`/drivers/${trip.driver_id}`}>
                                {trip.driver_name}
                            </Link>
                        ) : (
                            <span className={styles.muted}>nicht erfasst</span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt>Strecke</dt>
                    <dd>{formatKm(trip.distance_m)} km</dd>
                </div>
                <div>
                    <dt>Spitze</dt>
                    <dd data-over={speeding || undefined}>
                        {Math.round(trip.max_speed)} km/h
                    </dd>
                </div>
                <div>
                    <dt>Zu schnell</dt>
                    <dd data-over={speeding || undefined}>
                        {speedingSummary(events)}
                    </dd>
                </div>
            </dl>

            {alerts.all > 0 && (
                <div
                    className={styles.warning}
                    data-open={alerts.open.length > 0 || undefined}
                >
                    <span>{warningText(alerts.open.length, alerts.all)}</span>
                    {alerts.open.length > 0 && canResolve && (
                        <Button
                            variant="secondary"
                            size="row"
                            busy={resolving}
                            busyLabel="Wird erledigt…"
                            onClick={() => void resolve(alerts.open)}
                        >
                            Erledigen
                        </Button>
                    )}
                </div>
            )}
            {message && (
                <p className={styles.status} role="status">
                    {message}
                </p>
            )}

            <h3 className={styles.listTitle}>Was passiert ist</h3>
            <ol className={styles.timeline} ref={listRef}>
                <li className={styles.end} data-end="A">
                    <span className={styles.badge} data-end="A" aria-hidden="true">
                        A
                    </span>
                    <span className={styles.time}>{formatClock(trip.started_at)}</span>
                    <span className={styles.text}>Start</span>
                    <span className={styles.km}>0,0 km</span>
                </li>
                {events.map((event, index) => (
                    <li key={event.id} data-event={event.id}>
                        <button
                            type="button"
                            className={styles.event}
                            aria-pressed={selectedId === event.id}
                            data-lit={litIds.has(event.id) || undefined}
                            data-type={event.type}
                            onClick={() => onSelect(event)}
                        >
                            <span
                                className={styles.badge}
                                data-type={event.type}
                                data-estimated={event.estimated || undefined}
                                aria-hidden="true"
                            >
                                {index + 1}
                            </span>
                            <span className={styles.time}>
                                {formatClock(event.started_at)}
                            </span>
                            <span className={styles.text}>
                                <span className={styles.titleLine}>
                                    <WarningChip type={event.type} />
                                    {eventHeadline(event) && (
                                        <strong className={styles.over}>
                                            {eventHeadline(event)}
                                        </strong>
                                    )}
                                </span>
                                <span className={styles.detail}>
                                    {eventDetail(event)}
                                </span>
                                <span className={styles.where}>
                                    {eventWhere(event)}
                                </span>
                            </span>
                        </button>
                    </li>
                ))}
                {closed && (
                    <li className={styles.end} data-end="B">
                        <span className={styles.badge} data-end="B" aria-hidden="true">
                            B
                        </span>
                        <span className={styles.time}>{formatClock(trip.ended_at)}</span>
                        <span className={styles.text}>Ende</span>
                        <span className={styles.km}>{formatKm(trip.distance_m)} km</span>
                    </li>
                )}
            </ol>
            {events.length === 0 && (
                <p className={styles.muted}>
                    Keine Verstöße auf dieser Fahrt: kein Tempo über dem Limit,
                    kein Funkloch.
                </p>
            )}
        </aside>
    );
};
