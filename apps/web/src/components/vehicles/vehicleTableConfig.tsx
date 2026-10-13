import {
    ALERT_TYPES,
    speedBand,
    VEHICLE_TYPE_LABELS,
    type AlertType,
    type Vehicle,
    type VehicleFilterId,
} from "@fleet-live/shared";
import type {
    TableColumn,
    TableFilter,
} from "../../types/table";
import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";
import { DriverNameLink } from "../drivers/DriverNameLink";
import { WarningChip } from "../alerts/WarningChip";
import { speedBandTitle, SPEED_BAND_COLORS } from "./speedBand";
import { VehicleStatusChip } from "./VehicleStatusChip";
import styles from "./vehicleTableConfig.module.scss";

export const vehicleFilters: Array<
    TableFilter<Vehicle> & { id: VehicleFilterId }
> = [
    { id: "alerts", displayText: "Warnungen" },
    { id: "low_fuel", displayText: "Wenig Tank" },
    { id: "unassigned", displayText: "Kein Fahrer" },
    { id: "driving", displayText: "Auf Fahrt" },
    { id: "idle", displayText: "Standby" },
    { id: "offline", displayText: "Kein Signal" },
    { id: "in_depot", displayText: "Im Depot" },
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
        width: "128px",
        sortable: true,
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        sortable: true,
        render: (value, { row }) =>
            row.current_driver_id ? (
                <DriverNameLink
                    driverId={row.current_driver_id}
                    name={value ?? "—"}
                    title={value ?? undefined}
                />
            ) : (
                "—"
            ),
    },
    {
        key: "vehicle_type",
        displayText: "Typ",
        width: "96px",
        sortable: true,
        render: (value) => (value ? VEHICLE_TYPE_LABELS[value] : "—"),
    },
    {
        key: "depot",
        displayText: "Stammstandort",
        headerText: "Depot",
        sortable: true,
        render: (value) =>
            value ? (
                <span className={styles.clip} title={value}>
                    {value}
                </span>
            ) : (
                "—"
            ),
    },
    {
        key: "hu_due_on",
        displayText: "HU",
        width: "76px",
        sortable: true,
        render: (value) => formatYearMonth(value),
    },
    {
        key: "uvv_due_on",
        displayText: "UVV",
        width: "108px",
        sortable: true,
        render: (value) => formatIsoDate(value),
    },
    {
        key: "status",
        displayText: "Status",
        width: "118px",
        sortable: true,
        render: (value) => <VehicleStatusChip status={value} />,
    },
    {
        key: "fuel_level",
        displayText: "Tankstand",
        headerText: "Tank",
        width: "80px",
        sortable: true,
        render: (value) => `${Math.round(value)}%`,
    },
    {
        key: "speed",
        displayText: "Geschwindigkeit",
        headerText: "km/h",
        width: "100px",
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
        width: "116px",
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
