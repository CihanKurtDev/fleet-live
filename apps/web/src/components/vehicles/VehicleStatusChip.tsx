import {
    VEHICLE_AVAILABILITY_LABELS,
    type VehicleAvailability,
    type VehicleStatus,
} from "@fleet-live/shared";

import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./VehicleStatusChip.module.scss";

export const VehicleStatusChip = ({ status }: { status: VehicleStatus }) => (
    <span className={styles.chip} data-status={status}>
        <span className={styles.dot} aria-hidden="true" />
        {vehicleStatusLabel(status)}
    </span>
);

/** Shown next to the status when a vehicle cannot be given to a driver. */
export const AvailabilityChip = ({
    availability,
}: {
    availability: VehicleAvailability;
}) =>
    availability === "READY" ? null : (
        <span className={styles.chip}>{VEHICLE_AVAILABILITY_LABELS[availability]}</span>
    );
