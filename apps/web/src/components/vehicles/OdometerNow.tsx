import { useEffect, useState } from "react";
import type { OdometerReading, Vehicle } from "@fleet-live/shared";

import { getVehicleOdometer } from "../../api/odometer";
import { useVehicles } from "../../context/vehiclesContext";
import { formatClock, formatDay } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { formatKm } from "./odometerText";
import styles from "./OdometerNow.module.scss";

interface OdometerNowProps {
    vehicle: Pick<Vehicle, "id" | "odometer_km" | "odometer_reported_at">;
    canWrite: boolean;
    /** Opens the reading with its history to correct or enter it. */
    onEdit: () => void;
}

const stamp = (value: string) => `${formatDay(value)}, ${formatClock(value)}`;

/** „beim Anlegen“, „aus dem Import“, „laut Werkstattrechnung · Autohaus Weber“, „eingetragen“. */
const origin = (reading: OdometerReading) =>
    reading.source === "CREATE"
        ? "beim Anlegen"
        : reading.source === "IMPORT"
          ? "aus dem Import"
          : reading.note
            ? `laut ${reading.note}`
            : reading.previous_km === null
              ? "eingetragen"
              : "korrigiert";

/**
 * The Kilometerstand under „Jetzt“ and where it comes from: the dashboard,
 * read by the device (nothing to enter), or counted from the distance since
 * the last reading someone entered (a GPS box, marked „≈“).
 */
export const OdometerNow = ({ vehicle, canWrite, onEdit }: OdometerNowProps) => {
    const { listEpoch } = useVehicles();
    const fromDevice = vehicle.odometer_reported_at !== null;
    const counted = !fromDevice && vehicle.odometer_km !== null;
    const [base, setBase] = useState<OdometerReading | null>(null);

    // A counted reading names the reading it counts from; a correction
    // elsewhere (vehicles-changed) moves it.
    useEffect(() => {
        if (!counted) {
            return;
        }
        const controller = new AbortController();
        getVehicleOdometer(vehicle.id, controller.signal)
            .then((response) => setBase(response.data.readings[0] ?? null))
            .catch(() => setBase(null));
        return () => controller.abort();
    }, [vehicle.id, counted, listEpoch]);

    return (
        <div className={styles.row}>
            <div className={styles.value}>
                <span className={styles.label}>Kilometerstand</span>
                <span className={styles.km}>
                    {vehicle.odometer_km === null
                        ? "—"
                        : `${counted ? "≈ " : ""}${formatKm(vehicle.odometer_km)}`}
                </span>
            </div>
            <p className={styles.source}>
                {fromDevice ? (
                    <>
                        vom Fahrzeug gemeldet, wie auf dem Tacho · zuletzt{" "}
                        {stamp(vehicle.odometer_reported_at as string)}
                    </>
                ) : counted ? (
                    <>
                        {base
                            ? `berechnet: ${formatKm(base.km)} ${origin(base)} (${stamp(base.created_at)}) plus die gefahrene Strecke`
                            : "berechnet aus der gefahrenen Strecke"}
                        {canWrite && (
                            <>
                                {" · "}
                                <button type="button" className={styles.link} onClick={onEdit}>
                                    Korrigieren
                                </button>
                            </>
                        )}
                    </>
                ) : canWrite ? (
                    "Noch kein Stand vom Fahrzeug gemeldet. Einmal den Stand eintragen, danach rechnet fleet-live jede Fahrt dazu."
                ) : (
                    "Noch kein Stand vom Fahrzeug gemeldet oder eingetragen."
                )}
            </p>
            {!fromDevice && !counted && canWrite && (
                <Button variant="secondary" size="sm" className={styles.enter} onClick={onEdit}>
                    Stand vom Tacho eintragen
                </Button>
            )}
        </div>
    );
};
