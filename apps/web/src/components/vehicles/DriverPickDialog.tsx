import { useEffect, useState } from "react";
import { parseDriverListQuery, type Driver } from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { listDrivers, setDriverCurrentVehicle } from "../../api/drivers";
import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import styles from "./workshop.module.scss";

interface DriverPickDialogProps {
    /** The vehicle that needs a driver; `null` keeps the dialog closed. */
    vehicle: { id: number; license_plate: string } | null;
    /** What the driver does with it: „holt es bei Karosserie Schmitz ab“. */
    purpose: string;
    /** The driver planned for it (or who brought it), listed first with that note. */
    suggested?: { id: number; note: string } | null;
    onClose: () => void;
    onAssigned: (message: string) => void;
}

/**
 * Picks the driver who takes a vehicle now (to the workshop or back from it):
 * the drivers allowed to drive it, each with „Zuweisen“.
 */
export const DriverPickDialog = ({ vehicle, purpose, suggested, onClose, onAssigned }: DriverPickDialogProps) => {
    const [drivers, setDrivers] = useState<Driver[] | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!vehicle) {
            return;
        }
        const controller = new AbortController();
        listDrivers(parseDriverListQuery({ vehicle_id: vehicle.id, limit: 100 }), controller.signal)
            .then((response) => setDrivers(response.data))
            .catch(() => setDrivers([]));
        return () => controller.abort();
    }, [vehicle]);

    const assign = async (driver: Driver) => {
        if (!vehicle) return;
        setBusyId(driver.id);
        setError(null);
        try {
            await setDriverCurrentVehicle(driver.id, { vehicle_id: vehicle.id });
            onAssigned(`${driver.name} fährt ${vehicle.license_plate}.`);
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "Zuweisen hat nicht geklappt.");
        } finally {
            setBusyId(null);
        }
    };

    const suggestedId = suggested?.id ?? null;
    // The planned driver first, then the free ones: taking a driver who is on
    // another vehicle moves them off it.
    const rank = (driver: Driver) => (driver.id === suggestedId ? 0 : driver.current_vehicle_plate ? 2 : 1);
    const sorted = [...(drivers ?? [])].sort((left, right) => rank(left) - rank(right));

    return (
        <Modal open={vehicle !== null} onClose={onClose} title="Fahrer zuweisen">
            {vehicle && (
                <div className={styles.pick}>
                    <p className={styles.context}>
                        {vehicle.license_plate} · {purpose}
                    </p>
                    {drivers === null ? (
                        <p className={styles.historyNote}>Wird geladen …</p>
                    ) : sorted.length === 0 ? (
                        <p className={styles.historyNote}>
                            Kein Fahrer ist für dieses Fahrzeug freigegeben. Freigaben stehen am Fahrzeug unter „Fahrer“.
                        </p>
                    ) : (
                        <ul className={styles.pickList}>
                            {sorted.map((driver) => (
                                <li key={driver.id} className={styles.pickRow}>
                                    <span>
                                        <b>{driver.name}</b>
                                        <small>
                                            {driver.id === suggestedId
                                                ? suggested?.note
                                                : driver.current_vehicle_plate
                                                  ? `aktuell an ${driver.current_vehicle_plate}`
                                                  : "frei"}
                                        </small>
                                    </span>
                                    <Button
                                        size="row"
                                        variant="secondary"
                                        busy={busyId === driver.id}
                                        busyLabel="Wird zugewiesen…"
                                        onClick={() => assign(driver)}
                                    >
                                        Zuweisen
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {error && (
                        <p className={styles.pickError} role="alert">
                            {error}
                        </p>
                    )}
                </div>
            )}
        </Modal>
    );
};
