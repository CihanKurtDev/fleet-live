import type { Driver } from "@fleet-live/shared";

import { DriverNameLink } from "./DriverNameLink";
import styles from "./DriverTableCells.module.scss";

export const DriverVehicleCell = ({ driver }: { driver: Driver }) => {
    if (driver.vehicle_count === 0) {
        return <span className={styles.muted}>Kein Fahrzeug</span>;
    }

    return (
        <span className={styles.assignment}>
            {driver.current_vehicle_plate ? (
                <strong>{driver.current_vehicle_plate}</strong>
            ) : (
                <span className={styles.muted}>Kein aktuelles Fahrzeug</span>
            )}
            {driver.vehicle_count > 1 ? (
                <span className={styles.meta}>
                    {driver.vehicle_count} freigegeben
                </span>
            ) : null}
        </span>
    );
};

export const DriverWarningCell = ({ driver }: { driver: Driver }) => (
    <span
        className={styles.warning}
        data-active={driver.open_warnings > 0 ? "true" : "false"}
    >
        {driver.open_warnings > 0
            ? `${driver.open_warnings} offen`
            : "Keine offenen"}
    </span>
);

export const DriverNameCell = ({
    driver,
}: {
    driver: Driver;
}) => <DriverNameLink driverId={driver.id} name={driver.name} />;
