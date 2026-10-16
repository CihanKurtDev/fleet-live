import type { Driver } from "@fleet-live/shared";

import styles from "./DriverTableCells.module.scss";

/** "Kein Fahrzeug" or the current plate, with the number of releases below. */
export const DriverVehicleCell = ({ driver }: { driver: Driver }) => (
    <span className={styles.identity}>
        {driver.current_vehicle_plate ? (
            <span className={styles.strong}>{driver.current_vehicle_plate}</span>
        ) : (
            <span className={styles.muted}>Kein Fahrzeug</span>
        )}
        {driver.vehicle_count > 0 && (
            <span className={styles.meta}>
                {driver.vehicle_count} freigegeben
            </span>
        )}
    </span>
);

/** Open speeding warnings as a pill; "keine offen" stays quiet. */
export const DriverWarningCell = ({ driver }: { driver: Driver }) => (
    <span
        className={styles.warning}
        data-active={driver.open_warnings > 0 ? "true" : "false"}
    >
        {driver.open_warnings > 0
            ? `${driver.open_warnings} offen`
            : "keine offen"}
    </span>
);

/** "N offene Tempo-Warnungen" for the detail header (red pill). */
export const DriverOpenWarningsPill = ({ count }: { count: number }) =>
    count > 0 ? (
        <span className={styles.warning} data-active="true">
            {count === 1
                ? "1 offene Tempo-Warnung"
                : `${count} offene Tempo-Warnungen`}
        </span>
    ) : null;
