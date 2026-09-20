import type { VehicleStatus } from "@fleet-live/shared";

import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./VehicleStatusChip.module.scss";

export const VehicleStatusChip = ({ status }: { status: VehicleStatus }) => (
    <span className={styles.chip} data-status={status}>
        <span className={styles.dot} aria-hidden="true" />
        {vehicleStatusLabel(status)}
    </span>
);
