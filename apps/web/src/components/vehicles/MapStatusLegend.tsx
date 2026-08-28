import {
    MAP_STATUS_LEGEND,
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

export const MapStatusLegend = () => (
    <ul className={styles.legend} aria-label="Statusfarben">
        {MAP_STATUS_LEGEND.map((item) => (
            <li key={item}>
                <span
                    className={styles.legendDot}
                    style={{
                        background: VEHICLE_STATUS_COLORS[item],
                    }}
                />
                {vehicleStatusLabel(item)}
            </li>
        ))}
    </ul>
);
