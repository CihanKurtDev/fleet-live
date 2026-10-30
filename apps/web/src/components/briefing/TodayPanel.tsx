import { useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
    DUE_KIND_LABELS,
    TODAY_KINDS,
    type TodayItem,
    type TodayKind,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { arriveWorkshopVisit, type WorkshopTarget } from "../../api/workshop";
import { useVehicles } from "../../context/vehiclesContext";
import { WorkshopFinishDialog } from "../vehicles/WorkshopFinishDialog";
import { WorkshopPlanDialog } from "../vehicles/WorkshopPlanDialog";
import { isReturnLate, todayWorkshopLine } from "../vehicles/workshopText";

import { useAuth } from "../../hooks/useAuth";
import { useBoundHeight } from "../../hooks/useBoundHeight";
import { useToday } from "../../hooks/useToday";
import { formatRelativeTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { dueSoonLabel } from "../due/dueLabels";
import { Button } from "../ui/Button/Button";
import { RetryMessage } from "../ui/RetryMessage";
import { DeadlineEditDialog } from "./DeadlineEditDialog";
import styles from "./TodayPanel.module.scss";

/** Rows are 48 px (rules/design-system.md). */
const ROW_HEIGHT = 48;

type Tone = "critical" | "warning" | "neutral";

const KIND: Record<
    TodayKind,
    { tag: string; chip: string; to: string; tone: Tone; tile: boolean }
> = {
    deadline_overdue: {
        tag: "Überfällig",
        chip: "Fristen überfällig",
        to: "/fristen?state=overdue",
        tone: "critical",
        tile: true,
    },
    // The tag says which: „Rückgabe“ (late, critical) or „Termin“ (today).
    workshop_due: {
        tag: "Termin",
        chip: "Werkstatt fällig",
        to: "/vehicles?filter=workshop_due",
        tone: "warning",
        tile: false,
    },
    damage_unplanned: {
        tag: "Schaden",
        chip: "Schaden ohne Termin",
        to: "/vehicles?filter=damage_unplanned",
        tone: "critical",
        tile: false,
    },
    driver_talk: {
        tag: "Gespräch",
        chip: "Gespräch führen",
        to: "/drivers?min_open_warnings=5",
        tone: "warning",
        tile: false,
    },
    offline: {
        tag: "Kein Signal",
        chip: "Kein Signal",
        to: "/alerts?type=OFFLINE",
        tone: "critical",
        tile: true,
    },
    low_fuel: {
        tag: "Wenig Tank",
        chip: "Wenig Tank",
        to: "/alerts?type=LOW_FUEL",
        tone: "warning",
        tile: true,
    },
    deadline_soon: {
        tag: "Bald fällig",
        chip: "Fristen bald fällig",
        to: "/fristen?state=soon",
        tone: "warning",
        tile: false,
    },
};

/** "06.2026" for a month, "03.10.2026" for a day. */
const formatDue = (value: string) => {
    const [year, month, day] = value.split("-");
    return day ? `${day}.${month}.${year}` : `${month}.${year}`;
};

const reason = (item: TodayItem, meId?: number): string => {
    switch (item.kind) {
        case "deadline_overdue":
        case "deadline_soon": {
            const label = item.due_kind ? DUE_KIND_LABELS[item.due_kind] : "Frist";
            if (item.due_on === null) {
                return item.due_kind === "licence_check"
                    ? `${label} · noch nie kontrolliert`
                    : `${label} · kein Datum`;
            }
            return `${label} · ${item.kind === "deadline_overdue" ? "seit" : "am"} ${formatDue(item.due_on)}`;
        }
        case "driver_talk":
            return `${item.open_warnings ?? 0} offene Tempo-Warnungen`;
        case "offline":
            return `Meldet sich nicht · Warnung ${formatRelativeTimestamp(item.since)}`;
        case "low_fuel":
            return `Tankstand ${Math.round(item.fuel_level ?? 0)} %`;
        case "workshop_due":
            return item.workshop ? todayWorkshopLine(item.workshop, meId) : "";
        case "damage_unplanned":
            return item.damage
                ? `${item.damage.description} · nicht fahrbereit seit ${formatDue(item.damage.occurred_on)}`
                : "";
    }
};

/** Late returns are critical; an appointment today is a warning. */
const lateReturn = (item: TodayItem) =>
    item.kind === "workshop_due" && item.workshop !== null && isReturnLate(item.workshop);

/**
 * "Heute dran" on Schicht: the most urgent tasks across the fleet, one row
 * each, with one next step. The chips above count every task of a kind that
 * has no tile on the page and open the list that shows exactly those; the
 * others (Überfällig, Kein Signal, Wenig Tank) are counted by their tile.
 */
export const TodayPanel = ({
    companyEmpty = false,
}: {
    /** No vehicle yet: say where tasks will come from, not "Gute Schicht". */
    companyEmpty?: boolean;
}) => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const navigate = useNavigate();
    const { ref, height } = useBoundHeight<HTMLUListElement>();
    // Phones stack the page: a fixed handful there.
    const limit = height > 0 ? Math.max(1, Math.floor(height / ROW_HEIGHT)) : 6;
    const { data, error, reload } = useToday(limit);
    const [editing, setEditing] = useState<TodayItem | null>(null);
    const [finishing, setFinishing] = useState<WorkshopVisit | null>(null);
    const [planning, setPlanning] = useState<WorkshopTarget | null>(null);
    const [arriving, setArriving] = useState<number | null>(null);
    const [notice, setNotice] = useState("");
    const { refetchLists } = useVehicles();

    const soonLabel = data ? dueSoonLabel(data.meta.lead_days) : "Bald";
    const tagOf = (item: TodayItem) =>
        item.kind === "deadline_soon"
            ? soonLabel
            : lateReturn(item)
              ? "Rückgabe"
              : KIND[item.kind].tag;
    const toneOf = (item: TodayItem) =>
        lateReturn(item) ? "critical" : KIND[item.kind].tone;

    const arrive = async (item: TodayItem) => {
        if (!item.workshop) return;
        setNotice("");
        setArriving(item.workshop.id);
        try {
            await arriveWorkshopVisit(item.workshop.id);
            setNotice(`${item.subject} ist in der Werkstatt.`);
            reload();
            refetchLists();
        } catch (caught) {
            setNotice(caught instanceof ApiError ? caught.message : "Das hat nicht geklappt.");
        } finally {
            setArriving(null);
        }
    };
    const chipOf = (kind: TodayKind) =>
        kind === "deadline_soon"
            ? `Fristen ${soonLabel.charAt(0).toLowerCase()}${soonLabel.slice(1)}`
            : KIND[kind].chip;

    const open = (item: TodayItem) => {
        const to =
            item.vehicle_id !== null
                ? `/vehicles/${item.vehicle_id}`
                : `/drivers/${item.driver_id}`;
        navigate(to, { state: { from: "/" }, viewTransition: true });
    };

    const onRowKey = (event: KeyboardEvent, item: TodayItem) => {
        // Enter on a row button belongs to that button.
        if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            open(item);
        }
    };

    const action = (item: TodayItem) => {
        if (!canWrite) {
            return null;
        }

        if (item.kind === "deadline_overdue" || item.kind === "deadline_soon") {
            return (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        setEditing(item);
                    }}
                >
                    Eintragen
                </Button>
            );
        }

        if (item.kind === "damage_unplanned" && item.vehicle_id !== null) {
            const vehicleId = item.vehicle_id;
            return (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        setPlanning({
                            vehicleId,
                            licensePlate: item.subject,
                            reason: "DAMAGE",
                            context: "nicht fahrbereit",
                        });
                    }}
                >
                    In die Werkstatt
                </Button>
            );
        }

        if (item.kind === "workshop_due" && item.workshop) {
            const visit = item.workshop;
            return visit.state === "PLANNED" ? (
                <Button
                    variant="secondary"
                    size="row"
                    busy={arriving === visit.id}
                    busyLabel="Wird eingetragen…"
                    onClick={(event) => {
                        event.stopPropagation();
                        void arrive(item);
                    }}
                >
                    Angekommen
                </Button>
            ) : (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        setFinishing(visit);
                    }}
                >
                    Fertig melden
                </Button>
            );
        }

        return null;
    };

    return (
        <section className={styles.panel} aria-labelledby="today-title">
            <div className={styles.head}>
                <h2 id="today-title" className={styles.title}>
                    Heute dran
                </h2>
                <span className={styles.hint}>dringendstes zuerst</span>
                <p className={styles.notice} role="status" aria-live="polite">
                    {notice}
                </p>
            </div>

            {data && (
                <div className={styles.kinds}>
                    {TODAY_KINDS.filter(
                        (kind) => !KIND[kind].tile && data.meta.counts[kind] > 0,
                    ).map(
                        (kind) => (
                            <Link
                                key={kind}
                                className={styles.kind}
                                data-tone={KIND[kind].tone}
                                to={KIND[kind].to}
                                viewTransition
                            >
                                <b>{formatCount(data.meta.counts[kind])}</b>
                                {chipOf(kind)}
                            </Link>
                        ),
                    )}
                </div>
            )}

            <ul ref={ref} className={styles.list}>
                {error && (
                    <li className={styles.empty}>
                        <RetryMessage message={error} onRetry={reload} />
                    </li>
                )}
                {!error && data && data.data.length === 0 && (
                    <li className={styles.empty}>
                        {companyEmpty ? (
                            <>
                                <strong className={styles.emptyTitle}>
                                    Noch keine Aufgaben
                                </strong>
                                Sobald Fahrzeuge und Fahrer da sind, steht hier,
                                was heute zu tun ist: fehlende Daten, fällige
                                Fristen, Warnungen.
                            </>
                        ) : (
                            "Nichts offen. Gute Schicht."
                        )}
                    </li>
                )}
                {data?.data.map((item) => (
                    <li
                        key={item.key}
                        className={styles.row}
                        role="link"
                        tabIndex={0}
                        aria-label={`${item.subject}: ${reason(item, user?.id)}`}
                        onClick={() => open(item)}
                        onKeyDown={(event) => onRowKey(event, item)}
                    >
                        <span
                            className={styles.tag}
                            data-tone={toneOf(item)}
                        >
                            {tagOf(item)}
                        </span>
                        <span className={styles.what}>
                            <b>{item.subject}</b>
                            <span>{reason(item, user?.id)}</span>
                        </span>
                        <span className={styles.action}>{action(item)}</span>
                    </li>
                ))}
            </ul>

            {data && (
                <p className={styles.foot}>
                    {/* "0 von 0" says nothing; the line keeps its height. */}
                    {data.meta.total > 0
                        ? `Die nächsten ${formatCount(data.data.length)} von ${formatCount(data.meta.total)} offenen Aufgaben`
                        : " "}
                </p>
            )}

            <WorkshopPlanDialog
                target={planning}
                onClose={() => setPlanning(null)}
                onSaved={(_visit, message) => {
                    setPlanning(null);
                    setNotice(message);
                    reload();
                    refetchLists();
                }}
            />

            <WorkshopFinishDialog
                visit={finishing}
                onClose={() => setFinishing(null)}
                onSaved={(_visit, message) => {
                    setFinishing(null);
                    setNotice(message);
                    reload();
                    refetchLists();
                }}
            />

            <DeadlineEditDialog
                item={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    if (editing) {
                        setNotice(`${editing.subject} gespeichert.`);
                    }
                    setEditing(null);
                    reload();
                }}
            />
        </section>
    );
};
