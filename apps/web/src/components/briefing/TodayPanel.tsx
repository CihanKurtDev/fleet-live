import { useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    DUE_KIND_LABELS,
    TODAY_KINDS,
    WORKSHOP_TASK_LABELS,
    berlinTodayIso,
    type TodayItem,
    type TodayKind,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { setDriverCurrentVehicle } from "../../api/drivers";
import { type WorkshopTarget } from "../../api/workshop";
import { useVehicles } from "../../context/vehiclesContext";
import { formatShortStamp } from "../../utils/dateTime";
import { DriverPickDialog } from "../vehicles/DriverPickDialog";
import { WorkshopFinishDialog } from "../vehicles/WorkshopFinishDialog";
import { WorkshopPlanDialog } from "../vehicles/WorkshopPlanDialog";
import { appointmentText, bringDriver } from "../vehicles/workshopText";

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
    // A driver at the wheel with an expired licence: the most urgent row.
    licence_driving: {
        tag: "Führerschein",
        chip: "Führerschein abgelaufen, eingeteilt",
        to: "/drivers?licence_driving=true",
        tone: "critical",
        tile: false,
    },
    deadline_overdue: {
        tag: "Überfällig",
        chip: "Fristen überfällig",
        to: "/fristen?state=overdue",
        tone: "critical",
        tile: true,
    },
    // The tag says which task: Verpasst, Rückgabe, Hinfahrt, Abholen, Ohne Termin.
    workshop_due: {
        tag: "Werkstatt",
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
    // The chip and the row name the threshold the drivers list uses.
    driver_talk: {
        tag: "Gespräch",
        chip: `Gespräch führen (ab ${DRIVER_TALK_MIN_OPEN_WARNINGS} Warnungen)`,
        to: `/drivers?min_open_warnings=${DRIVER_TALK_MIN_OPEN_WARNINGS}`,
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
    // Due today and coming up are both counted by the tile „In N Tagen“: no chip.
    deadline_today: {
        tag: "Heute fällig",
        chip: "Fristen heute fällig",
        to: "/fristen?state=soon",
        tone: "warning",
        tile: true,
    },
    deadline_soon: {
        tag: "Bald fällig",
        chip: "Fristen bald fällig",
        to: "/fristen?state=soon",
        tone: "warning",
        tile: true,
    },
};

/** "06.2026" for a month, "03.10.2026" for a day. */
const formatDue = (value: string) => {
    const [year, month, day] = value.split("-");
    return day ? `${day}.${month}.${year}` : `${month}.${year}`;
};

const reason = (item: TodayItem): string => {
    switch (item.kind) {
        case "licence_driving":
            return `${item.vehicle_driving ? "fährt gerade" : "eingeteilt auf"} ${item.vehicle_plate ?? ""} · Führerschein seit ${item.due_on ? formatDue(item.due_on) : "?"} abgelaufen`;
        case "deadline_today": {
            const label = item.due_kind ? DUE_KIND_LABELS[item.due_kind] : "Frist";
            return `${label} · heute fällig`;
        }
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
            return `${item.open_warnings ?? 0} offene Tempo-Warnungen · Gespräch ab ${DRIVER_TALK_MIN_OPEN_WARNINGS}`;
        case "offline":
            return `Meldet sich nicht seit ${formatRelativeTimestamp(item.since)} · ${item.phone ? `Fahrer anrufen: ${item.phone}` : "kein Fahrer eingeteilt"}`;
        case "low_fuel":
            return `Tankstand ${Math.round(item.fuel_level ?? 0)} %`;
        case "workshop_due":
            return workshopLine(item);
        case "damage_unplanned":
            return item.damage
                ? `${item.damage.description} · nicht fahrbereit seit ${formatDue(item.damage.occurred_on)}`
                : "";
    }
};

const daysSince = (iso: string) =>
    Math.round((Date.parse(`${berlinTodayIso()}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000);

/** The second line of a workshop row: what the task is about, where. */
const workshopLine = (item: TodayItem): string => {
    const visit = item.workshop;
    const place = item.workshop_place?.name ?? visit?.place ?? "der Werkstatt";
    switch (item.workshop_task) {
        case "missed":
            return visit ? `Termin ${appointmentText(visit)} bei ${place} · nicht angekommen` : place;
        case "return_late":
            return visit?.expected_on
                ? `seit ${daysSince(visit.expected_on)} Tagen überfällig · ${place}${item.workshop_place?.phone ? `, ${item.workshop_place.phone}` : ""}`
                : place;
        case "trip_no_driver":
            return visit
                ? `Termin ${appointmentText(visit)} bei ${place} · ${visit.bring_driver_name ? `${visit.bring_driver_name} bringt es hin` : "kein Fahrer"}`
                : place;
        case "pickup":
            return `fertig bei ${place} · kein Fahrer zum Abholen`;
        case "unplanned":
            return `steht seit ${formatShortStamp(item.since)} bei ${place} · kein Termin`;
        default:
            return place;
    }
};

/** Missed appointments and late returns are critical, the rest a warning. */
const workshopCritical = (item: TodayItem) =>
    item.kind === "workshop_due" &&
    (item.workshop_task === "missed" || item.workshop_task === "return_late");

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
    const [replanning, setReplanning] = useState<WorkshopVisit | null>(null);
    const [picking, setPicking] = useState<TodayItem | null>(null);
    const [notice, setNotice] = useState("");
    const { refetchLists } = useVehicles();

    const soonLabel = data ? dueSoonLabel(data.meta.lead_days) : "Bald";
    const tagOf = (item: TodayItem) =>
        item.kind === "deadline_soon"
            ? soonLabel
            : item.kind === "workshop_due" && item.workshop_task
              ? WORKSHOP_TASK_LABELS[item.workshop_task]
              : KIND[item.kind].tag;
    const toneOf = (item: TodayItem) =>
        workshopCritical(item) ? "critical" : KIND[item.kind].tone;

    const afterWrite = (message: string) => {
        setNotice(message);
        reload();
        refetchLists();
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

        if (item.kind === "licence_driving" && item.driver_id !== null) {
            // Mid-trip the driver cannot be taken off; the row says it drives.
            if (item.vehicle_driving) {
                return null;
            }
            const driverId = item.driver_id;
            return (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        void setDriverCurrentVehicle(driverId, { vehicle_id: null })
                            .then(() => afterWrite(`${item.subject} ist von ${item.vehicle_plate ?? "dem Fahrzeug"} abgenommen.`))
                            .catch((caught: unknown) =>
                                setNotice(caught instanceof Error ? caught.message : "Nicht abgenommen."),
                            );
                    }}
                >
                    Abnehmen
                </Button>
            );
        }

        if (item.kind === "deadline_overdue" || item.kind === "deadline_soon" || item.kind === "deadline_today") {
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

        if (item.kind === "workshop_due" && item.vehicle_id !== null) {
            const visit = item.workshop;
            const vehicleId = item.vehicle_id;
            const button = (label: string, act: () => void) => (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        act();
                    }}
                >
                    {label}
                </Button>
            );

            switch (item.workshop_task) {
                case "missed":
                    return visit ? button("Neu planen", () => setReplanning(visit)) : null;
                case "return_late":
                    return visit ? button("Fertig melden", () => setFinishing(visit)) : null;
                case "trip_no_driver":
                case "pickup":
                    return button("Fahrer zuweisen", () => setPicking(item));
                case "unplanned":
                    return item.workshop_place
                        ? button("Aufenthalt anlegen", () =>
                              setPlanning({
                                  vehicleId,
                                  licensePlate: item.subject,
                                  standingAt: item.workshop_place ?? undefined,
                              }),
                          )
                        : null;
                default:
                    return null;
            }
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
                        aria-label={`${item.subject}: ${reason(item)}`}
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
                            <span>{reason(item)}</span>
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
                visit={replanning}
                onClose={() => {
                    setPlanning(null);
                    setReplanning(null);
                }}
                onSaved={(_visit, message) => {
                    setPlanning(null);
                    setReplanning(null);
                    afterWrite(message);
                }}
            />

            <DriverPickDialog
                vehicle={picking?.vehicle_id ? { id: picking.vehicle_id, license_plate: picking.subject } : null}
                purpose={
                    picking?.workshop_task === "pickup"
                        ? `holt es bei ${picking.workshop_place?.name ?? "der Werkstatt"} ab`
                        : `bringt es zu ${picking?.workshop_place?.name ?? picking?.workshop?.place ?? "der Werkstatt"}`
                }
                suggested={bringDriver(picking?.workshop ?? null)}
                onClose={() => setPicking(null)}
                onAssigned={(message) => {
                    setPicking(null);
                    afterWrite(message);
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
