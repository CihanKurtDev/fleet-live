import { useEffect, useState } from "react";
import {
    WORKSHOP_REASON_LABELS,
    WORKSHOP_STATE_LABELS,
    type Damage,
    type Vehicle,
    type VehicleWorkshop,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import {
    arriveWorkshopVisit,
    cancelWorkshopVisit,
    getVehicleWorkshop,
} from "../../api/workshop";
import { useVehicles } from "../../context/vehiclesContext";
import { formatIsoDate } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { WorkshopFinishDialog } from "./WorkshopFinishDialog";
import { WorkshopHistoryDialog } from "./WorkshopHistoryDialog";
import { WorkshopPlanDialog } from "./WorkshopPlanDialog";
import statusStyles from "./VehicleStatusChip.module.scss";
import { isReturnLate } from "./workshopText";
import styles from "./workshop.module.scss";

export type PageNotice = { text: string; tone: "ok" | "error" } | null;

interface WorkshopPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
    /** The page's one status line (header): what a write did, or why it failed. */
    onNotice: (notice: PageNotice) => void;
    /** The vehicle's damages, for the history. */
    damages?: Damage[];
}

/**
 * Werkstatt on the vehicle page, a strip above the map: the open stay with
 * its one next step, or how to start one.
 */
export const WorkshopPanel = ({
    vehicle,
    canWrite,
    onNotice,
    damages = [],
}: WorkshopPanelProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [loaded, setLoaded] = useState<{ id: number; data: VehicleWorkshop } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const [planning, setPlanning] = useState(false);
    const [editing, setEditing] = useState<WorkshopVisit | null>(null);
    const [finishing, setFinishing] = useState<WorkshopVisit | null>(null);
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
                    setError(
                        caught instanceof Error
                            ? caught.message
                            : "Werkstatt konnte nicht geladen werden.",
                    );
                }
            });
        return () => controller.abort();
    }, [vehicle.id, listEpoch, reload]);

    const workshop = loaded?.id === vehicle.id ? loaded.data : null;
    const open = workshop?.open ?? null;
    const last = workshop?.past.find((visit) => visit.state === "DONE") ?? null;
    const hasHistory =
        workshop !== null && (open !== null || workshop.past.length > 0 || damages.length > 0);

    const afterWrite = (text: string) => {
        onNotice({ text, tone: "ok" });
        setReload((value) => value + 1);
        refetchLists();
    };

    const failed = (caught: unknown) =>
        onNotice({
            text: caught instanceof ApiError ? caught.message : "Das hat nicht geklappt.",
            tone: "error",
        });

    const arrive = async () => {
        if (!open) return;
        setBusy(true);
        onNotice(null);
        try {
            await arriveWorkshopVisit(open.id);
            afterWrite(
                vehicle.driver_name
                    ? `${vehicle.license_plate} ist in der Werkstatt. ${vehicle.driver_name} ist frei.`
                    : `${vehicle.license_plate} ist in der Werkstatt.`,
            );
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

    const actions = canWrite ? (
        open ? (
            <div className={styles.actions}>
                {open.state === "PLANNED" ? (
                    <Button
                        variant="primary"
                        size="sm"
                        busy={busy}
                        busyLabel="Wird eingetragen…"
                        onClick={arrive}
                    >
                        Angekommen
                    </Button>
                ) : (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            onNotice(null);
                            setFinishing(open);
                        }}
                    >
                        Fertig melden
                    </Button>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        onNotice(null);
                        setEditing(open);
                    }}
                >
                    Bearbeiten
                </Button>
                {open.state === "PLANNED" && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            onNotice(null);
                            setConfirmCancel(true);
                        }}
                    >
                        Absagen
                    </Button>
                )}
            </div>
        ) : workshop ? (
            <div className={styles.actions}>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        onNotice(null);
                        setPlanning(true);
                    }}
                >
                    In die Werkstatt
                </Button>
            </div>
        ) : null
    ) : null;

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.title}>Werkstatt</h2>
                {open ? (
                    <span className={statusStyles.chip}>{WORKSHOP_STATE_LABELS[open.state]}</span>
                ) : error && !workshop ? (
                    <p className={styles.line} data-tone="error">
                        {error}{" "}
                        <button
                            type="button"
                            className={styles.link}
                            onClick={() => setReload((value) => value + 1)}
                        >
                            Erneut versuchen
                        </button>
                    </p>
                ) : (
                    <p className={styles.line}>
                        {workshop
                            ? `Kein offener Aufenthalt.${
                                  last
                                      ? ` Zuletzt ${WORKSHOP_REASON_LABELS[last.reason]} bei ${last.place}, fertig am ${formatIsoDate(last.finished_on)}.`
                                      : ""
                              }`
                            : " "}
                    </p>
                )}
                <span className={styles.spacer} />
                {hasHistory && (
                    <button
                        type="button"
                        className={styles.link}
                        onClick={() => setShowHistory(true)}
                    >
                        Verlauf
                    </button>
                )}
                {actions}
            </div>

            {open && (
                <dl className={styles.facts}>
                    <div>
                        <dt>Grund</dt>
                        <dd>{WORKSHOP_REASON_LABELS[open.reason]}</dd>
                    </div>
                    <div>
                        <dt>{open.state === "IN_WORKSHOP" ? "Dort seit" : "Termin"}</dt>
                        <dd>
                            {formatIsoDate(
                                open.state === "IN_WORKSHOP"
                                    ? (open.arrived_on ?? open.planned_on)
                                    : open.planned_on,
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt>Fertig erwartet</dt>
                        <dd className={isReturnLate(open) ? styles.late : undefined}>
                            {formatIsoDate(open.expected_on)}
                        </dd>
                    </div>
                    <div>
                        <dt>Werkstatt</dt>
                        <dd>{open.place}</dd>
                    </div>
                    <div>
                        <dt>Zuständig</dt>
                        <dd>{open.assignee_name ?? "—"}</dd>
                    </div>
                </dl>
            )}

            <WorkshopPlanDialog
                target={
                    planning
                        ? { vehicleId: vehicle.id, licensePlate: vehicle.license_plate }
                        : null
                }
                visit={editing}
                onClose={() => {
                    setPlanning(false);
                    setEditing(null);
                }}
                onSaved={(_visit, message) => {
                    setPlanning(false);
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
            <WorkshopHistoryDialog
                open={showHistory}
                licensePlate={vehicle.license_plate}
                workshop={workshop}
                damages={damages}
                onClose={() => setShowHistory(false)}
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
                                  detail: `${WORKSHOP_REASON_LABELS[open.reason]} bei ${open.place}, ${formatIsoDate(open.planned_on)}`,
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
