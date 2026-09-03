import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isLowFuelLevel, type Alert, type Vehicle } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import { listAlerts, resolveAlert } from "../../api/alerts";
import { retryTransient } from "../../api/retryTransient";
import { useVehicles } from "../../context/vehiclesContext";
import { Button } from "../ui/Button/Button";
import styles from "./VehicleHintsPanel.module.scss";

interface VehicleHintsPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
}

const liveOffline = (alerts: Alert[]): Alert | undefined =>
    alerts.find((alert) => alert.type === "OFFLINE" && alert.ended_at === null);

export const VehicleHintsPanel = ({
    vehicle,
    canWrite,
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

    useEffect(() => {
        const controller = new AbortController();
        setError(null);

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

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Hinweise</h2>
                {showFunk ? (
                    <Link className={styles.inboxLink} to={inboxHref}>
                        Zur Inbox
                    </Link>
                ) : null}
            </div>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {!showTank && !showFunk ? (
                <p className={styles.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {showTank && (
                        <li className={styles.item}>
                            <p className={styles.message}>
                                Tank bei {Math.round(vehicle.fuel_level)} % —
                                nach der Fahrt im Stammdaten-Formular
                                eintragen.
                            </p>
                        </li>
                    )}
                    {showFunk && (
                        <li className={styles.item}>
                            <p className={styles.message}>Kein Signal</p>
                            {canWrite && liveOfflineAlert ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={resolvingId === liveOfflineAlert.id}
                                    onClick={() =>
                                        void handleResolve(liveOfflineAlert.id)
                                    }
                                >
                                    Erledigen
                                </Button>
                            ) : null}
                        </li>
                    )}
                </ul>
            )}
        </>
    );
};
