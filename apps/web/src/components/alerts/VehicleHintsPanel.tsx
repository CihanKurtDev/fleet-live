import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
    DUE_KIND_LABELS,
    berlinTodayIso,
    classifyDueOn,
    explainHuMonth,
    explainUvv,
    isLowFuelLevel,
    type Alert,
    type Vehicle,
} from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import { listAlerts, resolveAlert } from "../../api/alerts";
import { retryTransient } from "../../api/retryTransient";
import { useVehicles } from "../../context/vehiclesContext";
import { formatIsoDate } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { WarningChip } from "./WarningChip";
import styles from "./VehicleHintsPanel.module.scss";

interface VehicleHintsPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
    /** Opens the master-data form, where a missing or past date is entered. */
    onEditMaster?: () => void;
}

type DueHint = {
    kind: "hu" | "uvv";
    state: "overdue" | "missing";
    due_on: string | null;
};

const liveOffline = (alerts: Alert[]): Alert | undefined =>
    alerts.find((alert) => alert.type === "OFFLINE" && alert.ended_at === null);

/**
 * HU and UVV of this vehicle that need a date now: missing or past. "Soon"
 * depends on the company lead and stays on /fristen.
 */
const dueHintsFor = (vehicle: Vehicle): DueHint[] => {
    const today = berlinTodayIso();
    const dates = [
        {
            kind: "hu" as const,
            due_on: explainHuMonth(vehicle.hu_due_on).due_on,
        },
        {
            kind: "uvv" as const,
            due_on: explainUvv({
                checkedOn: vehicle.uvv_checked_on,
                manualDueOn: vehicle.uvv_due_on,
                today,
            }).due_on,
        },
    ];

    return dates.flatMap(({ kind, due_on }) => {
        const state = classifyDueOn(due_on, today, 0);

        return state === "overdue" || state === "missing"
            ? [{ kind, state, due_on }]
            : [];
    });
};

const dueHintText = (hint: DueHint): string =>
    hint.state === "missing"
        ? `${DUE_KIND_LABELS[hint.kind]}-Datum fehlt`
        : `${DUE_KIND_LABELS[hint.kind]} war am ${formatIsoDate(hint.due_on)} fällig`;

export const VehicleHintsPanel = ({
    vehicle,
    canWrite,
    onEditMaster,
}: VehicleHintsPanelProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [liveOfflineAlert, setLiveOfflineAlert] = useState<
        Alert | undefined
    >();
    const [error, setError] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<number | null>(null);

    const inboxHref = `/alerts?vehicle_id=${vehicle.id}&type=OFFLINE`;
    const tankLow = isLowFuelLevel(vehicle.fuel_level);
    const noSignal =
        vehicle.status === "OFFLINE" ||
        vehicle.open_alert_types.includes("OFFLINE");

    const requestKey = `${vehicle.id}\0${listEpoch}`;
    const [fetchKey, setFetchKey] = useState(requestKey);
    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        setError(null);
        setLiveOfflineAlert(undefined);
    }

    useEffect(() => {
        const controller = new AbortController();

        retryTransient(
            () =>
                listAlerts(
                    {
                        filter: "open",
                        type: "OFFLINE",
                        sort: "created_at",
                        dir: "desc",
                        page: 1,
                        limit: 10,
                        vehicle_id: vehicle.id,
                    },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((offline) => {
                setLiveOfflineAlert(liveOffline(offline.data));
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Hinweise konnten nicht geladen werden.",
                );
            });

        return () => controller.abort();
    }, [vehicle.id, listEpoch]);

    const handleResolve = async (id: number) => {
        setResolvingId(id);
        setError(null);

        try {
            await resolveAlert(id);
            refetchLists();
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Warnung konnte nicht erledigt werden.",
            );
        } finally {
            setResolvingId(null);
        }
    };

    const showTank = tankLow;
    const showFunk = noSignal || liveOfflineAlert !== undefined;
    const dueHints = dueHintsFor(vehicle);

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Hinweise</h2>
                {showFunk ? (
                    <Link className={styles.inboxLink} to={inboxHref}>
                        Zu den Warnungen
                    </Link>
                ) : null}
            </div>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {!showTank && !showFunk && dueHints.length === 0 ? (
                <p className={styles.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {showFunk && (
                        <li className={styles.item} data-tone="danger">
                            <WarningChip type="OFFLINE" />
                            <p className={styles.message}>Kein Signal</p>
                            {canWrite && liveOfflineAlert ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={resolvingId === liveOfflineAlert.id}
                                    title={
                                        liveOfflineAlert.type === "SPEEDING"
                                            ? "Aus der Liste nehmen. Zustand und Tempo-Farbe bleiben."
                                            : "Aus der Liste nehmen. Zustand am Fahrzeug bleibt."
                                    }
                                    onClick={() =>
                                        void handleResolve(liveOfflineAlert.id)
                                    }
                                >
                                    Erledigen
                                </Button>
                            ) : null}
                        </li>
                    )}
                    {showTank && (
                        <li className={styles.item}>
                            <WarningChip type="LOW_FUEL" />
                            <p className={styles.message}>
                                Tank bei {Math.round(vehicle.fuel_level)} % —
                                nach der Fahrt im Stammdaten-Formular
                                eintragen.
                            </p>
                        </li>
                    )}
                    {dueHints.map((hint) => (
                        <li key={hint.kind} className={styles.item}>
                            <span className={styles.dueChip}>Frist</span>
                            <p className={styles.message}>
                                {dueHintText(hint)}
                            </p>
                            {canWrite && onEditMaster ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onEditMaster}
                                >
                                    Eintragen
                                </Button>
                            ) : (
                                <Link
                                    className={styles.inboxLink}
                                    to={`/fristen?state=${hint.state}&kind=${hint.kind}&search=${encodeURIComponent(vehicle.license_plate)}`}
                                >
                                    Fristen
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
};
