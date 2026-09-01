import {
    ALERT_TYPES,
    speedBand,
    type AlertType,
    type Vehicle,
    type VehicleFilterId,
} from "@fleet-live/shared";
import type {
    TableColumn,
    TableFilter,
} from "../../types/table";
import { DriverNameLink } from "../drivers/DriverNameLink";
import { WarningChip } from "../alerts/WarningChip";
import { speedBandTitle, SPEED_BAND_COLORS } from "./speedBand";
import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./vehicleTableConfig.module.scss";

export const vehicleFilters: Array<
    TableFilter<Vehicle> & { id: VehicleFilterId }
> = [
    { id: "alerts", displayText: "Warnungen" },
    { id: "low_fuel", displayText: "Wenig Tank" },
    { id: "driving", displayText: "Auf Fahrt" },
    { id: "offline", displayText: "Kein Signal" },
];

function warningTypes(row: Vehicle): AlertType[] {
    const types = new Set(row.open_alert_types ?? []);

    if (row.speeding_open) {
        types.add("SPEEDING");
    }

    return ALERT_TYPES.filter((type) => types.has(type));
}

export const vehicleColumns: TableColumn<Vehicle>[] = [
    {
        key: "license_plate",
        displayText: "Kennzeichen",
        sortable: true,
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        sortable: true,
        render: (value, { row }) => (
            <DriverNameLink driverId={row.driver_id} name={value} />
        ),
    },
    {
        key: "status",
        displayText: "Status",
        sortable: true,
        render: (value) => vehicleStatusLabel(value),
    },
    {
        key: "fuel_level",
        displayText: "Tankstand",
        sortable: true,
        render: (value) => `${Math.round(value)}%`,
    },
    {
        key: "speed",
        displayText: "Geschwindigkeit",
        sortable: true,
        render: (value, { row }) => {
            if (value === null) {
                return "—";
            }

            const band = speedBand({
                speed: value,
                status: row.status,
                speeding_open: row.speeding_open,
                limit_kmh: row.speed_limit_kmh,
            });

            return (
                <span
                    className={styles.speed}
                    data-band={band.band}
                    style={{ color: SPEED_BAND_COLORS[band.band] }}
                    title={speedBandTitle(band)}
                >
                    {value} km/h
                </span>
            );
        },
    },
    {
        key: "active_alerts",
        displayText: "Warnungen",
        sortable: true,
        render: (_value, { row }) => {
            const types = warningTypes(row);

            if (types.length === 0) {
                return "—";
            }

            return (
                <span className={styles.chips}>
                    {types.map((type) => (
                        <WarningChip key={type} type={type} />
                    ))}
                </span>
            );
        },
    },
];
