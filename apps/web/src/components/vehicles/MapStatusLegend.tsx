import type { VehicleStatus } from "@fleet-live/shared";

import {
    MAP_STATUS_LEGEND,
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

type MapStatusLegendProps = {
    vehiclesByStatus?: Partial<Record<VehicleStatus, number>>;
};

export const MapStatusLegend = ({
    vehiclesByStatus = {},
}: MapStatusLegendProps) => (
    <aside className={styles.legend} aria-label="Statuslegende der sichtbaren Fahrzeuge">
        <strong className={styles.legendTitle}>Sichtbare Fahrzeuge</strong>
        <ul className={styles.legendList}>
            {MAP_STATUS_LEGEND.map((item) => (
                <li key={item}>
                    <span
                        className={styles.legendDot}
                        style={{
                            background: VEHICLE_STATUS_COLORS[item],
                        }}
                    />
                    <span>{vehicleStatusLabel(item)}</span>
                    <span className={styles.legendCount}>
                        {vehiclesByStatus[item] ?? 0}
                    </span>
                </li>
            ))}
        </ul>
        <span className={styles.legendHint}>Marker öffnen das Fahrzeug</span>
    </aside>
);
