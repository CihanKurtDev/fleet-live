import { useEffect, useState } from "react";
import { Link } from "react-router";
import { formatAlertEvent, type Alert } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import { listAlerts, resolveAlert } from "../../api/alerts";
import { retryTransient } from "../../api/retryTransient";
import { useVehicles } from "../../context/vehiclesContext";
import { Button } from "../ui/Button/Button";
import { formatTimestamp } from "../../utils/dateTime";
import styles from "./VehicleAlertList.module.scss";

interface VehicleAlertListProps {
    vehicleId: number;
    canWrite: boolean;
}

export const VehicleAlertList = ({
    vehicleId,
    canWrite,
}: VehicleAlertListProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<number | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setError(null);

        retryTransient(
            () =>
                listAlerts(
                    {
                        filter: "open",
                        sort: "created_at",
                        dir: "desc",
                        page: 1,
                        limit: 100,
                        vehicle_id: vehicleId,
                    },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                setAlerts(response.data);
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
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [vehicleId, listEpoch]);

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

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Warnungen</h2>
                <Link
                    className={styles.inboxLink}
                    to={`/alerts?vehicle_id=${vehicleId}`}
                >
                    Zur Inbox
                </Link>
            </div>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {isLoading && alerts.length === 0 ? (
                <p className={styles.empty}>Warnungen werden geladen…</p>
            ) : alerts.length === 0 ? (
                <p className={styles.empty}>Keine offenen Warnungen.</p>
            ) : (
                <ul className={styles.list}>
                    {alerts.map((alert) => (
                        <li key={alert.id} className={styles.item}>
                            <div>
                                <p className={styles.message}>
                                    {formatAlertEvent(alert)}
                                </p>
                                <p className={styles.time}>
                                    {formatTimestamp(alert.created_at)}
                                </p>
                            </div>
                            {canWrite && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={resolvingId === alert.id}
                                    onClick={() => void handleResolve(alert.id)}
                                >
                                    Erledigen
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
};
