import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isLowFuelLevel, type Alert, type Vehicle } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import { listAlerts, resolveAlert } from "../../api/alerts";
import { retryTransient } from "../../api/retryTransient";
import { useVehicles } from "../../context/vehiclesContext";
import { Button } from "../ui/Button/Button";
import styles from "./VehicleAlertList.module.scss";

interface VehicleAlertListProps {
    vehicle: Vehicle;
    canWrite: boolean;
}

const liveOfType = (alerts: Alert[], type: Alert["type"]): Alert | undefined =>
    alerts.find((alert) => alert.type === type && alert.ended_at === null);

export const VehicleAlertList = ({
    vehicle,
    canWrite,
}: VehicleAlertListProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [liveFuel, setLiveFuel] = useState<Alert | undefined>();
    const [liveOffline, setLiveOffline] = useState<Alert | undefined>();
    const [error, setError] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<number | null>(null);

    const inboxHref = `/alerts?vehicle_id=${vehicle.id}`;
    const tankLow = isLowFuelLevel(vehicle.fuel_level);
    const noSignal =
        vehicle.status === "OFFLINE" ||
        vehicle.open_alert_types.includes("OFFLINE");

    useEffect(() => {
        const controller = new AbortController();
        setError(null);

        Promise.all([
            retryTransient(
                () =>
                    listAlerts(
                        {
                            filter: "open",
                            type: "LOW_FUEL",
                            sort: "created_at",
                            dir: "desc",
                            page: 1,
                            limit: 10,
                            vehicle_id: vehicle.id,
                        },
                        controller.signal,
                    ),
                controller.signal,
            ),
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
            ),
        ])
            .then(([fuel, offline]) => {
                setLiveFuel(liveOfType(fuel.data, "LOW_FUEL"));
                setLiveOffline(liveOfType(offline.data, "OFFLINE"));
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Warnungen konnten nicht geladen werden.",
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

    const showTank = tankLow || liveFuel !== undefined;
    const showFunk = noSignal || liveOffline !== undefined;

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Tank und Funk</h2>
                <Link className={styles.inboxLink} to={inboxHref}>
                    Zur Inbox
                </Link>
            </div>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {!showTank && !showFunk ? (
                <p className={styles.empty}>Tank und Funk in Ordnung.</p>
            ) : (
                <ul className={styles.list}>
                    {showTank && (
                        <li className={styles.item}>
                            <p className={styles.message}>
                                Tank bei {Math.round(vehicle.fuel_level)} %
                            </p>
                            {canWrite && liveFuel ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={resolvingId === liveFuel.id}
                                    onClick={() =>
                                        void handleResolve(liveFuel.id)
                                    }
                                >
                                    Erledigen
                                </Button>
                            ) : null}
                        </li>
                    )}
                    {showFunk && (
                        <li className={styles.item}>
                            <p className={styles.message}>Kein Signal</p>
                            {canWrite && liveOffline ? (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={resolvingId === liveOffline.id}
                                    onClick={() =>
                                        void handleResolve(liveOffline.id)
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
