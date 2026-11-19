import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
    TODAY_SECTION_OF,
    TODAY_SECTIONS,
    type DueCounts,
    type TodayGroup,
    type TodayItem,
    type TodayKind,
    type TodayResponse,
    type WeekDay,
    type WeekItem,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { setDriverCurrentVehicle } from "../../api/drivers";
import { type WorkshopTarget } from "../../api/workshop";
import { useVehicles } from "../../context/vehiclesContext";
import { useAuth } from "../../hooks/useAuth";
import { useToday } from "../../hooks/useToday";
import { formatCount } from "../../utils/formatCount";
import { dueSoonLabel } from "../due/dueLabels";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { RetryMessage } from "../ui/RetryMessage";
import { DriverPickDialog } from "../vehicles/DriverPickDialog";
import { WorkshopFinishDialog } from "../vehicles/WorkshopFinishDialog";
import { WorkshopPlanDialog } from "../vehicles/WorkshopPlanDialog";
import { bringDriver } from "../vehicles/workshopText";
import { DeadlineEditDialog, type DeadlineTarget } from "./DeadlineEditDialog";
import {
    SECTION_HINT,
    SECTION_LABEL,
    WEEK_GROUP_LABEL,
    WEEK_KIND_LABEL,
    dayLabel,
    endingLabel,
    foldsInto,
    groupLine,
    groupWhat,
    isLastWorkdayBeforeBreak,
    rowLine,
    rowWhat,
    stayNote,
    weekDetail,
    weekNote,
} from "./shiftText";
import styles from "./ShiftPlan.module.scss";

type Tone = "critical" | "warning";

/** Where „alle anzeigen“ goes when a kind has more rows than come along. */
const LIST_OF: Record<TodayKind, string> = {
    licence_driving: "/drivers?licence_driving=true",
    deadline_overdue: "/fristen?state=overdue",
    workshop_due: "/vehicles?filter=workshop_due",
    damage_unplanned: "/vehicles?filter=damage_unplanned",
    offline: "/alerts?type=OFFLINE",
    check_overdue: "/fristen?state=overdue&kind=licence_check",
    date_missing: "/fristen?state=missing",
    licence_ending: "/fristen?state=soon&kind=licence_expiry",
    deadline_ending: "/fristen?state=soon",
};

/** Lists that hold more than the counted rows (they do not know what is in use). */
const LIST_WIDER: Partial<Record<TodayKind, true>> = {
    deadline_overdue: true,
    check_overdue: true,
    date_missing: true,
    licence_ending: true,
    deadline_ending: true,
};

const toneOf = (kind: TodayKind): Tone => (TODAY_SECTION_OF[kind] === "blocked" ? "critical" : "warning");

/** A licence row names the driver, so the dialog opens the driver, not the vehicle. */
const deadlineTarget = (item: Pick<TodayItem, "vehicle_id" | "driver_id" | "due_kind" | "subject">): DeadlineTarget => ({
    ...item,
    vehicle_id: item.driver_id !== null ? null : item.vehicle_id,
});

type Act = { label: string; run: () => void } | { note: string } | null;

/** A write from a row button that changes who drives: asked first. */
type Confirming = {
    title: string;
    text: string;
    label: string;
    danger: boolean;
    busy: boolean;
    error: string | null;
    run: () => void;
};

export const ShiftPlan = ({
    due,
    leadDays,
    companyEmpty,
}: {
    /** The deadline tiles above, so „Heute“ can say which part of them it lists. */
    due: DueCounts;
    leadDays: number;
    companyEmpty: boolean;
}) => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const navigate = useNavigate();
    const { data, error, reload } = useToday();
    const { refetchLists } = useVehicles();
    const [open, setOpen] = useState<Set<TodayKind>>(new Set());
    const [weekOpen, setWeekOpen] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<DeadlineTarget | null>(null);
    const [planning, setPlanning] = useState<WorkshopTarget | null>(null);
    const [replanning, setReplanning] = useState<WorkshopVisit | null>(null);
    const [finishing, setFinishing] = useState<WorkshopVisit | null>(null);
    const [picking, setPicking] = useState<TodayItem | null>(null);
    const [notice, setNotice] = useState("");
    const [confirming, setConfirming] = useState<Confirming | null>(null);

    const afterWrite = (message: string) => {
        setNotice(message);
        reload();
        refetchLists();
    };

    const openSubject = (item: { vehicle_id: number | null; driver_id: number | null }) => {
        const to = item.driver_id !== null ? `/drivers/${item.driver_id}` : `/vehicles/${item.vehicle_id}`;
        navigate(to, { state: { from: "/" }, viewTransition: true });
    };

    const assign = (driverId: number, vehicleId: number | null, message: string) => {
        setNotice("");
        setConfirming((current) => (current ? { ...current, busy: true, error: null } : current));
        void setDriverCurrentVehicle(driverId, { vehicle_id: vehicleId })
            .then(() => {
                setConfirming(null);
                afterWrite(message);
            })
            .catch((caught: unknown) =>
                setConfirming((current) =>
                    current ? { ...current, busy: false, error: caught instanceof Error ? caught.message : "Nicht gespeichert." } : current,
                ),
            );
    };

    const plan = (item: { vehicle_id: number | null; subject: string }, reason: WorkshopTarget["reason"], context: string) => {
        if (item.vehicle_id === null) return;
        setNotice("");
        setPlanning({ vehicleId: item.vehicle_id, licensePlate: item.subject, reason, context });
    };

    const edit = (target: DeadlineTarget) => {
        setNotice("");
        setEditing(deadlineTarget(target));
    };

    /** The one next step of a row; a note where nothing is to do here. */
    const actOf = (item: TodayItem): Act => {
        if ((item.kind === "deadline_overdue" || item.kind === "deadline_ending") && item.stay) {
            return { note: stayNote(item.stay) };
        }
        // Mid-trip the driver cannot be changed: call him, the number is in the row.
        if (item.kind === "licence_driving" && item.vehicle_driving) return { note: "fährt gerade, anrufen" };
        if (!canWrite) return null;

        switch (item.kind) {
            case "licence_driving": {
                const { replacement, vehicle_id: vehicleId, driver_id: driverId } = item;
                const plate = item.vehicle_plate ?? "das Fahrzeug";
                if (replacement && vehicleId !== null) {
                    return {
                        label: `${replacement.name} einteilen`,
                        run: () =>
                            setConfirming({
                                title: `${replacement.name} auf ${plate} einteilen?`,
                                text: `${replacement.name} fährt dann ${plate}. ${item.subject} ist danach ohne Fahrzeug.`,
                                label: "Einteilen",
                                danger: false,
                                busy: false,
                                error: null,
                                run: () => assign(replacement.id, vehicleId, `${replacement.name} fährt ${plate}, ${item.subject} ist ohne Fahrzeug.`),
                            }),
                    };
                }
                return driverId === null
                    ? null
                    : {
                          label: "Abnehmen",
                          run: () =>
                              setConfirming({
                                  title: `${item.subject} von ${plate} abnehmen?`,
                                  text: `${plate} hat danach keinen Fahrer, bis du einen einteilst.`,
                                  label: "Abnehmen",
                                  danger: true,
                                  busy: false,
                                  error: null,
                                  run: () => assign(driverId, null, `${item.subject} ist von ${plate} abgenommen.`),
                              }),
                      };
            }
            case "licence_ending":
                return { label: item.due_on ? "Neues Ablaufdatum" : "Datum eintragen", run: () => edit(item) };
            case "date_missing":
                return { label: "Datum eintragen", run: () => edit(item) };
            case "offline":
                // Days without a signal: the device or the vehicle needs a look.
                return {
                    label: "Termin planen",
                    run: () => plan(item, "OTHER", `${rowWhat(item)}: Gerät prüfen`),
                };
            case "check_overdue":
                return { label: "Kontrolle eintragen", run: () => edit(item) };
            case "deadline_overdue":
            case "deadline_ending":
                if (item.due_kind === "licence_check") return { label: "Kontrolle eintragen", run: () => edit(item) };
                return {
                    label: "Termin planen",
                    run: () => plan(item, item.due_kind === "uvv" ? "UVV" : "HU", rowWhat(item)),
                };
            case "damage_unplanned":
                return { label: "Termin planen", run: () => plan(item, "DAMAGE", "nicht fahrbereit") };
            case "workshop_due": {
                const visit = item.workshop;
                switch (item.workshop_task) {
                    case "missed":
                        return visit ? { label: "Neu planen", run: () => setReplanning(visit) } : null;
                    case "return_late":
                        return visit ? { label: "Fertig melden", run: () => setFinishing(visit) } : null;
                    case "trip_no_driver":
                    case "pickup":
                        return { label: "Fahrer zuweisen", run: () => setPicking(item) };
                    case "unplanned":
                        return item.workshop_place && item.vehicle_id !== null
                            ? {
                                  label: "Aufenthalt anlegen",
                                  run: () =>
                                      setPlanning({
                                          vehicleId: item.vehicle_id as number,
                                          licensePlate: item.subject,
                                          standingAt: item.workshop_place ?? undefined,
                                      }),
                              }
                            : null;
                    default:
                        return null;
                }
            }
        }
    };

    // The most urgent step on the page is the one filled button.
    const firstStep = data?.data.groups
        .filter((group) => !foldsInto(group))
        .flatMap((group) => group.items)
        .find((item) => {
            const act = actOf(item);
            return act !== null && "label" in act;
        })?.key;

    const actCell = (act: Act, primary: boolean) => {
        if (act === null) return <span />;
        if ("note" in act) return <span className={styles.note}>{act.note}</span>;
        return (
            <Button
                variant={primary ? "primary" : "secondary"}
                size="row"
                onClick={(event) => {
                    event.stopPropagation();
                    act.run();
                }}
            >
                {act.label}
            </Button>
        );
    };

    const actionCell = (item: TodayItem) => actCell(actOf(item), item.key === firstStep);

    const onKey = (event: KeyboardEvent, run: () => void) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
            event.preventDefault();
            run();
        }
    };

    const row = (item: TodayItem, nested = false) => (
        <li
            key={item.key}
            className={nested ? styles.subRow : styles.row}
            role="link"
            tabIndex={0}
            aria-label={`${item.subject}: ${rowWhat(item)}`}
            onClick={() => openSubject(item)}
            onKeyDown={(event) => onKey(event, () => openSubject(item))}
        >
            {!nested && <span className={styles.bar} data-tone={toneOf(item.kind)} aria-hidden="true" />}
            <span className={styles.text}>
                <span className={styles.what}>
                    <b>{item.subject}</b> · {rowWhat(item)}
                </span>
                <span className={styles.line}>{rowLine(item)}</span>
            </span>
            {actionCell(item)}
        </li>
    );

    const folded = (group: TodayGroup) => {
        const isOpen = open.has(group.kind);
        const toggle = () =>
            setOpen((current) => {
                const next = new Set(current);
                if (next.has(group.kind)) next.delete(group.kind);
                else next.add(group.kind);
                return next;
            });
        return [
            <li key={`${group.kind}:head`} className={styles.row}>
                <span className={styles.bar} data-tone={toneOf(group.kind)} aria-hidden="true" />
                <span className={styles.text}>
                    <span className={styles.what}>
                        <b>{formatCount(group.count)}</b> {groupWhat(group)}
                    </span>
                    <span className={styles.line}>{groupLine(group)}</span>
                </span>
                <Button variant="secondary" size="row" aria-expanded={isOpen} onClick={toggle}>
                    {isOpen ? "Zuklappen" : `${formatCount(group.count)} anzeigen`}
                </Button>
            </li>,
            ...(isOpen ? group.items.map((item) => row(item, true)) : []),
            ...(isOpen && group.count > group.items.length
                ? [
                      <li key={`${group.kind}:more`} className={styles.more}>
                          <Link to={LIST_OF[group.kind]} viewTransition>
                              Alle {formatCount(group.count)} in der Liste
                          </Link>
                          {LIST_WIDER[group.kind] && <span className={styles.moreHint}> (zeigt auch, was nicht im Einsatz ist)</span>}
                      </li>,
                  ]
                : []),
        ];
    };

    const sectionCount = (groups: TodayGroup[]) => groups.reduce((sum, group) => sum + group.count, 0);

    const sections = (response: TodayResponse) =>
        TODAY_SECTIONS.map((section) => {
            const groups = response.data.groups.filter((group) => TODAY_SECTION_OF[group.kind] === section);
            if (groups.length === 0) return null;
            const label = section === "ending" ? endingLabel(response.meta) : SECTION_LABEL[section];
            return (
                <li key={section} className={styles.section}>
                    <h3 className={styles.sectionHead} data-tone={section === "blocked" ? "critical" : "warning"}>
                        {label} · {formatCount(sectionCount(groups))}
                        {section === "ending" ? (
                            isLastWorkdayBeforeBreak(response.meta) && <span className={styles.sectionHint}>heute ist der letzte Werktag</span>
                        ) : (
                            <span className={styles.sectionHint}>{SECTION_HINT[section]}</span>
                        )}
                    </h3>
                    <ul className={styles.rows}>
                        {groups.flatMap((group) => (foldsInto(group) ? folded(group) : group.items.map((item) => row(item))))}
                    </ul>
                </li>
            );
        });

    /** „Überfällig 13 von 17 · …“: which part of each tile „Heute“ lists. */
    const bridge = (response: TodayResponse) => {
        const { counts } = response.meta;
        const missingTile = due.missing.hu + due.missing.uvv + due.missing.licence_expiry;
        const parts = [
            ["Überfällig", counts.licence_driving + counts.deadline_overdue + counts.check_overdue, due.overdue],
            ["Datum fehlt", counts.date_missing, missingTile],
            [dueSoonLabel(leadDays), counts.licence_ending + counts.deadline_ending, due.soon],
        ] as const;
        return `Aus den Kacheln: ${parts.map(([label, part, tile]) => `${label} ${formatCount(part)} von ${formatCount(tile)}`).join(" · ")}; was demnächst abläuft, steht rechts im Plan`;
    };

    const calmNext = (response: TodayResponse) => {
        const day = response.data.week.find((entry) => entry.items.length > 0);
        return day
            ? `Als Nächstes: ${dayLabel(day.date)}, ${formatCount(day.items.length)} im Plan rechts.`
            : "Auch in den nächsten Werktagen läuft nichts ab.";
    };

    const today = (
        <section className={styles.panel} aria-labelledby="shift-today-title" data-tip="briefing-today">
            <div className={styles.head}>
                <h2 id="shift-today-title" className={styles.title}>
                    Heute
                </h2>
                <p className={styles.notice} role="status" aria-live="polite">
                    {notice}
                </p>
                {data && <span className={styles.meta}>{formatCount(data.meta.total)} {data.meta.total === 1 ? "Aufgabe" : "Aufgaben"}</span>}
            </div>
            {error && (
                <div className={styles.empty}>
                    <RetryMessage message={error} onRetry={reload} />
                </div>
            )}
            {!error && data && data.meta.total === 0 && (
                <div className={styles.calm}>
                    {companyEmpty ? (
                        <>
                            <strong>Noch keine Aufgaben</strong>
                            <span>Sobald Fahrzeuge Fahrer haben, steht hier, wer oder was heute nicht fahren darf.</span>
                        </>
                    ) : (
                        <>
                            <strong>Nichts im Einsatz fährt heute ohne Erlaubnis.</strong>
                            <span>{calmNext(data)}</span>
                        </>
                    )}
                </div>
            )}
            {!error && data && data.meta.total > 0 && <ul className={styles.list}>{sections(data)}</ul>}
            {data && !companyEmpty && <p className={styles.foot}>{bridge(data)}</p>}
        </section>
    );

    /** The step of a plan row: the dialog for the date, or the booked appointment. */
    const weekAct = (item: WeekItem): Act => {
        if ((item.kind === "hu" || item.kind === "uvv") && item.stay) return { note: stayNote(item.stay) };
        if (item.kind === "workshop") return item.stay?.planned_time ? { note: `${item.stay.planned_time} Uhr` } : null;
        if (!canWrite) return null;
        if (item.kind === "hu" || item.kind === "uvv") {
            const reason = item.kind === "uvv" ? "UVV" : "HU";
            return { label: "Termin planen", run: () => plan(item, reason, `${reason} läuft ${dayLabel(item.due_on)} ab`) };
        }
        const dueKind = item.kind;
        return {
            label: dueKind === "licence_check" ? "Kontrolle eintragen" : "Neues Ablaufdatum",
            run: () => edit({ vehicle_id: item.vehicle_id, driver_id: item.driver_id, due_kind: dueKind, subject: item.subject }),
        };
    };

    const weekRow = (item: WeekItem, nested = false) => (
        <li
            key={item.key}
            className={nested ? styles.subRow : styles.row}
            role="link"
            tabIndex={0}
            aria-label={`${item.subject}: ${WEEK_KIND_LABEL[item.kind]}`}
            onClick={() => openSubject(item)}
            onKeyDown={(event) => onKey(event, () => openSubject(item))}
        >
            {!nested && <span className={styles.bar} data-tone={item.kind === "licence_expiry" ? "warning" : "neutral"} aria-hidden="true" />}
            <span className={styles.text}>
                <span className={styles.what}>
                    <b>{item.subject}</b> · {WEEK_KIND_LABEL[item.kind]}
                </span>
                <span className={styles.line}>{weekDetail(item)}</span>
            </span>
            {actCell(weekAct(item), false)}
        </li>
    );

    /** One day: its rows, three or more of a kind folded into one. */
    const weekDay = (day: WeekDay) => {
        const kinds = [...new Set(day.items.map((item) => item.kind))];
        const rows = kinds.flatMap((kind) => {
            const items = day.items.filter((item) => item.kind === kind);
            if (items.length < 3) return items.map((item) => weekRow(item));
            const key = `${day.date}:${kind}`;
            const isOpen = weekOpen.has(key);
            const toggle = () =>
                setWeekOpen((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                });
            return [
                <li key={`${key}:head`} className={styles.row}>
                    <span className={styles.bar} data-tone={kind === "licence_expiry" ? "warning" : "neutral"} aria-hidden="true" />
                    <span className={styles.text}>
                        <span className={styles.what}>
                            <b>{formatCount(items.length)}</b> {WEEK_GROUP_LABEL[kind]}
                        </span>
                        <span className={styles.line}>{items.map((item) => item.subject).join(", ")}</span>
                    </span>
                    <Button variant="secondary" size="row" aria-expanded={isOpen} onClick={toggle}>
                        {isOpen ? "Zuklappen" : `${formatCount(items.length)} anzeigen`}
                    </Button>
                </li>,
                ...(isOpen ? items.map((item) => weekRow(item, true)) : []),
            ];
        });
        return (
            <li key={day.date} className={styles.section}>
                <h3 className={styles.sectionHead} data-tone="neutral">
                    {dayLabel(day.date)} · {formatCount(day.count)}
                </h3>
                <ul className={styles.rows}>
                    {rows}
                    {day.count > day.items.length && (
                        <li className={styles.more}>
                            <Link to="/fristen?state=soon" viewTransition>
                                Weiter in den Fristen
                            </Link>
                            <span className={styles.moreHint}> ({formatCount(day.count - day.items.length)} mehr an diesem Tag; die Liste zeigt alle bald fälligen)</span>
                        </li>
                    )}
                </ul>
            </li>
        );
    };

    const week = data && (
        <section className={styles.panel} aria-labelledby="shift-week-title" data-tip="briefing-week">
            <div className={styles.head}>
                <h2 id="shift-week-title" className={styles.title}>
                    {canWrite ? "Als Nächstes planen" : "Als Nächstes"}
                </h2>
                <span className={styles.meta}>
                    {formatCount(data.meta.week_total)} bis {dayLabel(data.meta.week_until)}
                </span>
            </div>
            {data.meta.week_total === 0 ? (
                <div className={styles.calm}>
                    <strong>Bis {dayLabel(data.meta.week_until)} läuft im Einsatz nichts ab.</strong>
                    <span>
                        Was später fällig wird oder nicht im Einsatz ist, steht in den{" "}
                        <Link to="/fristen?state=soon" viewTransition>
                            Fristen
                        </Link>
                        .
                    </span>
                </div>
            ) : (
                <>
                    <p className={styles.weekNote}>
                        Läuft ab oder wird fällig, nur was im Einsatz ist · {weekNote(data.data.week.flatMap((day) => day.items))}
                    </p>
                    <ul className={styles.list}>
                        {data.data.week.map(weekDay)}
                        <li className={styles.end}>Bis {dayLabel(data.meta.week_until)} läuft im Einsatz sonst nichts ab.</li>
                    </ul>
                </>
            )}
        </section>
    );

    const dialogs: ReactNode = (
        <>
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
                    afterWrite(message);
                }}
            />
            <ConfirmDialog
                open={confirming !== null}
                onClose={() => setConfirming(null)}
                title={confirming?.title ?? ""}
                confirmLabel={confirming?.label ?? ""}
                confirmVariant={confirming?.danger ? "danger" : "primary"}
                isBusy={confirming?.busy ?? false}
                busyLabel="Wird gespeichert…"
                error={confirming?.error ?? undefined}
                onConfirm={() => confirming?.run()}
            >
                <p>{confirming?.text}</p>
            </ConfirmDialog>
            <DeadlineEditDialog
                item={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    if (editing) afterWrite(`${editing.subject} gespeichert.`);
                    setEditing(null);
                }}
            />
        </>
    );

    return (
        <div className={styles.plan}>
            {today}
            {week ?? <section className={styles.panel} aria-busy="true" />}
            {dialogs}
        </div>
    );
};
