import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
    workshopReasonsText,
    WORKSHOP_TRANSPORT_LABELS,
    WORKSHOP_STATE_LABELS,
    berlinTodayIso,
    type Damage,
    type Vehicle,
    type VehicleWorkshop,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { arriveWorkshopVisit, cancelWorkshopVisit, getVehicleWorkshop } from "../../api/workshop";
import { useVehicles } from "../../context/vehiclesContext";
import { formatClock, formatDay, formatIsoDate } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { DriverPickDialog } from "./DriverPickDialog";
import { WorkshopFinishDialog } from "./WorkshopFinishDialog";
import { WorkshopHistoryDialog } from "./WorkshopHistoryDialog";
import { WorkshopPlanDialog } from "./WorkshopPlanDialog";
import statusStyles from "./VehicleStatusChip.module.scss";
import { appointmentText, bringDriver, dayText, formatEuro, isReturnLate } from "./workshopText";
import type { MapWorkshop } from "./workshopRing";
import styles from "./workshop.module.scss";

export type PageNotice = { text: string; tone: "ok" | "error" } | null;

interface WorkshopPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
    /** The page's one status line (header): what a write did, or why it failed. */
    onNotice: (notice: PageNotice) => void;
    /** The vehicle's damages, for the reason line and the history. */
    damages?: Damage[];
    /** The workshop of the open stay (or the one to pick up from), for the map. */
    onPlace?: (place: MapWorkshop | null) => void;
}

type Tone = "danger" | "warning" | "success" | null;

const chipStyle = (tone: Tone): CSSProperties | undefined =>
    tone ? ({ "--status": `var(--${tone})` } as CSSProperties) : undefined;

const daysSince = (iso: string) =>
    Math.round((Date.parse(`${berlinTodayIso()}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000);

/** „heute, 08:06“ for a naive UTC moment. */
const stamp = (value: string | null) => (value ? `${formatDay(value)}, ${formatClock(value)}` : "—");

/**
 * Werkstatt on the vehicle page, a strip above the map. It says what the stay
 * waits for and offers the one next step: planned (arrival is seen from the
 * position), missed, in the workshop, late, finished and still there (pick
 * up), or standing at a workshop without a stay.
 */
export const WorkshopPanel = ({ vehicle, canWrite, onNotice, damages = [], onPlace }: WorkshopPanelProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [loaded, setLoaded] = useState<{ id: number; data: VehicleWorkshop } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const [planning, setPlanning] = useState<"new" | "standing" | null>(null);
    const [editing, setEditing] = useState<WorkshopVisit | null>(null);
    const [finishing, setFinishing] = useState<WorkshopVisit | null>(null);
    const [picking, setPicking] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        getVehicleWorkshop(vehicle.id, controller.signal)
            .then((response) => {
                setLoaded({ id: vehicle.id, data: response.data });
                setError(null);
            })
            .catch((caught: unknown) => {
                if (!controller.signal.aborted) {
                    setError(caught instanceof Error ? caught.message : "Werkstatt konnte nicht geladen werden.");
                }
            });
        return () => controller.abort();
    }, [vehicle.id, listEpoch, reload]);

    const workshop = loaded?.id === vehicle.id ? loaded.data : null;
    const open = workshop?.open ?? null;
    const pickup = workshop?.to_pick_up ?? null;
    const here = workshop?.here ?? null;
    const last = workshop?.past.find((visit) => visit.state === "DONE") ?? null;
    const mapPlace = (open ?? pickup)?.workshop ?? null;
    const mapPlaceKey = mapPlace ? `${mapPlace.id}|${mapPlace.latitude}|${mapPlace.longitude}|${mapPlace.radius_m}` : "";

    useEffect(() => {
        onPlace?.(mapPlace);
        // The key stands for the place; a new object with the same place changes nothing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapPlaceKey, onPlace]);
    const today = berlinTodayIso();
    const driving = vehicle.status === "DRIVING";
    const hasHistory = workshop !== null && (open !== null || workshop.past.length > 0 || damages.length > 0);

    const afterWrite = (text: string) => {
        onNotice({ text, tone: "ok" });
        setReload((value) => value + 1);
        refetchLists();
    };

    const failed = (caught: unknown) =>
        onNotice({ text: caught instanceof ApiError ? caught.message : "Das hat nicht geklappt.", tone: "error" });

    const run = (action: () => void) => () => {
        onNotice(null);
        action();
    };

    const arriveByHand = async () => {
        if (!open) return;
        setBusy(true);
        onNotice(null);
        try {
            await arriveWorkshopVisit(open.id);
            afterWrite(`${vehicle.license_plate} ist in der Werkstatt.`);
        } catch (caught) {
            failed(caught);
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        if (!open) return;
        setBusy(true);
        try {
            await cancelWorkshopVisit(open.id);
            setConfirmCancel(false);
            afterWrite("Termin abgesagt.");
        } catch (caught) {
            setConfirmCancel(false);
            failed(caught);
        } finally {
            setBusy(false);
        }
    };

    // What the strip says: a chip, one or two short sentences, the actions.
    let chip: { label: string; tone: Tone } | null = null;
    let lines: Array<{ text: string; tone?: "danger" | "warning" }> = [];
    let primary: ReactNode = null;
    const secondary: ReactNode[] = [];
    const editButton = (label = "Bearbeiten") => (
        <Button key="edit" variant="secondary" size="sm" onClick={run(() => setEditing(open))}>
            {label}
        </Button>
    );

    if (open?.state === "PLANNED") {
        const missed = open.planned_on < today;
        if (missed) {
            chip = { label: "Verpasst", tone: "danger" };
            lines = [{ text: "Das Fahrzeug war nicht dort.", tone: "danger" }];
            primary = (
                <Button variant="primary" size="sm" onClick={run(() => setEditing(open))}>
                    Neu planen
                </Button>
            );
        } else {
            chip = { label: WORKSHOP_STATE_LABELS.PLANNED, tone: null };
            if (open.workshop_id === null) {
                lines = [{ text: "Diese Werkstatt hat keinen Ort auf der Karte: Ankunft von Hand melden." }];
            } else if (driving && open.planned_on === today) {
                lines = [{ text: "Fährt gerade." }, { text: "Gilt als angekommen, sobald es dort parkt." }];
            } else if (open.planned_on === today && !vehicle.current_driver_id) {
                lines = [{ text: "Kein Fahrer für die Hinfahrt.", tone: "warning" }];
                primary = (
                    <Button variant="primary" size="sm" onClick={run(() => setPicking(true))}>
                        Fahrer zuweisen
                    </Button>
                );
            } else {
                lines = [{ text: "Gilt als angekommen, sobald es dort parkt." }];
            }
            secondary.push(editButton());
        }
        secondary.push(
            <Button key="cancel" variant="secondary" size="sm" onClick={run(() => setConfirmCancel(true))}>
                Absagen
            </Button>,
        );
    } else if (open?.state === "IN_WORKSHOP") {
        const late = isReturnLate(open);
        chip = late ? { label: "Überfällig", tone: "danger" } : { label: WORKSHOP_STATE_LABELS.IN_WORKSHOP, tone: null };
        lines = late
            ? [{ text: `Sollte am ${formatIsoDate(open.expected_on)} fertig sein, seit ${daysSince(open.expected_on as string)} Tagen überfällig.`, tone: "danger" }]
            : [{ text: open.arrived_by === "POSITION" ? "Erkannt an der Position." : "Von Hand gemeldet." }];
        primary = (
            <Button variant="primary" size="sm" onClick={run(() => setFinishing(open))}>
                Fertig melden
            </Button>
        );
        secondary.push(editButton());
    } else if (pickup) {
        chip = { label: "Fertig", tone: "success" };
        lines = [{ text: "Steht noch dort." }];
        if (vehicle.current_driver_id) {
            lines.push({ text: `${vehicle.driver_name ?? "Der Fahrer"} holt es ab.` });
        } else {
            lines.push({ text: "Kein Fahrer zum Abholen.", tone: "warning" });
            primary = (
                <Button variant="primary" size="sm" onClick={run(() => setPicking(true))}>
                    Fahrer zuweisen
                </Button>
            );
        }
    } else if (here && !driving) {
        chip = { label: "Ohne Termin", tone: "warning" };
        lines = [{ text: `Steht bei ${here.name}. Kein Termin geplant.` }];
        primary = (
            <Button variant="primary" size="sm" onClick={run(() => setPlanning("standing"))}>
                Aufenthalt anlegen
            </Button>
        );
    }

    const facts = open ?? pickup;
    const endDay = facts?.state === "DONE" ? facts.finished_on : facts?.expected_on;
    const linkedDamage = facts ? damages.find((damage) => damage.workshop_visit_id === facts.id) : undefined;
    const showHandArrival = canWrite && open?.state === "PLANNED" && !driving;

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.title}>Werkstatt</h2>
                {chip ? (
                    <>
                        <span className={statusStyles.chip} style={chipStyle(chip.tone)}>
                            {chip.label}
                        </span>
                        <p className={styles.line}>
                            {lines.map((line, index) => (
                                <span key={line.text} data-tone={line.tone}>
                                    {index > 0 && " "}
                                    {line.text}
                                </span>
                            ))}
                        </p>
                    </>
                ) : error && !workshop ? (
                    <p className={styles.line} data-tone="error">
                        {error}{" "}
                        <button type="button" className={styles.link} onClick={() => setReload((value) => value + 1)}>
                            Erneut versuchen
                        </button>
                    </p>
                ) : (
                    <p className={styles.line}>
                        {workshop
                            ? `Kein offener Aufenthalt.${
                                  last
                                      ? ` Zuletzt ${workshopReasonsText(last.reasons)} bei ${last.place}, fertig am ${formatIsoDate(last.finished_on)}.`
                                      : ""
                              }`
                            : " "}
                    </p>
                )}
                {showHandArrival && (
                    <button type="button" className={styles.link} disabled={busy} onClick={arriveByHand}>
                        Angekommen melden
                    </button>
                )}
                {hasHistory && (
                    <button type="button" className={styles.link} onClick={() => setShowHistory(true)}>
                        Verlauf
                    </button>
                )}
                {canWrite && workshop && (
                    <div className={styles.actions}>
                        {primary}
                        {secondary}
                        {!chip && (
                            <Button variant="secondary" size="sm" onClick={run(() => setPlanning("new"))}>
                                In die Werkstatt
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {facts && (
                <dl className={styles.facts}>
                    <div>
                        <dt>Grund</dt>
                        <dd>
                            {workshopReasonsText(facts.reasons)}
                            {linkedDamage && <small>{linkedDamage.description}</small>}
                        </dd>
                    </div>
                    <div>
                        <dt>{facts.state === "PLANNED" ? "Termin" : "Dort seit"}</dt>
                        <dd className={facts.state === "PLANNED" && facts.planned_on < today ? styles.late : undefined}>
                            {facts.state === "PLANNED"
                                ? appointmentText(facts)
                                : facts.arrived_at
                                  ? stamp(facts.arrived_at)
                                  : formatIsoDate(facts.arrived_on)}
                        </dd>
                    </div>
                    <div>
                        <dt>{facts.state === "DONE" ? "Fertig" : "Fertig erwartet"}</dt>
                        <dd className={isReturnLate(facts) ? styles.late : undefined}>
                            {endDay ? dayText(endDay) : "—"}
                        </dd>
                    </div>
                    <div>
                        <dt>Werkstatt</dt>
                        <dd>
                            {facts.place}
                            {facts.workshop?.phone && <small>{facts.workshop.phone}</small>}
                        </dd>
                    </div>
                    <div>
                        <dt>{facts.state === "DONE" ? "Kosten" : facts.state === "IN_WORKSHOP" ? "Hingekommen" : "Hinbringen"}</dt>
                        <dd>
                            {facts.state === "DONE"
                                ? facts.cost_cents !== null
                                    ? formatEuro(facts.cost_cents)
                                    : "noch offen"
                                : facts.transport !== "DRIVER"
                                  ? WORKSHOP_TRANSPORT_LABELS[facts.transport]
                                  : (facts.bring_driver_name ?? "Fahrer noch offen")}
                        </dd>
                    </div>
                    <div>
                        <dt>Zuständig</dt>
                        <dd>{facts.assignee_name ?? "—"}</dd>
                    </div>
                </dl>
            )}

            <WorkshopPlanDialog
                target={
                    planning
                        ? {
                              vehicleId: vehicle.id,
                              licensePlate: vehicle.license_plate,
                              position:
                                  vehicle.latitude !== null && vehicle.longitude !== null
                                      ? { latitude: vehicle.latitude, longitude: vehicle.longitude }
                                      : null,
                              currentDriverId: vehicle.current_driver_id,
                              standingAt: planning === "standing" && here ? here : undefined,
                          }
                        : null
                }
                visit={editing}
                onClose={() => {
                    setPlanning(null);
                    setEditing(null);
                }}
                onSaved={(_visit, message) => {
                    setPlanning(null);
                    setEditing(null);
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
            <DriverPickDialog
                vehicle={picking ? vehicle : null}
                purpose={pickup ? `holt es bei ${pickup.place} ab` : `bringt es zu ${open?.place ?? "der Werkstatt"}`}
                suggested={bringDriver(pickup ?? open)}
                onClose={() => setPicking(false)}
                onAssigned={(message) => {
                    setPicking(false);
                    afterWrite(message);
                }}
            />
            <WorkshopHistoryDialog
                open={showHistory}
                licensePlate={vehicle.license_plate}
                workshop={workshop}
                damages={damages}
                canWrite={canWrite}
                onClose={() => setShowHistory(false)}
                onChanged={(message) => afterWrite(message)}
            />
            <ConfirmDialog
                open={canWrite && confirmCancel && open !== null}
                onClose={() => setConfirmCancel(false)}
                title="Termin absagen?"
                confirmLabel="Absagen"
                busyLabel="Wird abgesagt…"
                isBusy={busy}
                onConfirm={cancel}
                items={
                    open
                        ? [
                              {
                                  key: open.id,
                                  name: vehicle.license_plate,
                                  detail: `${workshopReasonsText(open.reasons)} bei ${open.place}, ${formatIsoDate(open.planned_on)}`,
                              },
                          ]
                        : []
                }
            >
                <p>Der Termin bleibt im Verlauf als abgesagt stehen.</p>
            </ConfirmDialog>
        </>
    );
};
