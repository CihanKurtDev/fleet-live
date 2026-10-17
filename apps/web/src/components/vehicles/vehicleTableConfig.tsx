import {
    ALERT_TYPES,
    isLowFuelLevel,
    speedBand,
    VEHICLE_TYPE_LABELS,
    type AlertType,
    type Vehicle,
    type VehicleFilterId,
    type VehicleListCounts,
} from "@fleet-live/shared";
import type {
    TableColumn,
    TableFilter,
} from "../../types/table";
import type { KpiTileTone } from "../ui/KpiTiles/KpiTiles";
import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";
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
    { id: "driving_unassigned", displayText: "Fährt ohne Fahrer" },
];

type VehicleFilterOption = {
    /** `null` is "Alle". */
    id: Exclude<VehicleFilterId, "speeding"> | null;
    label: string;
    count: keyof VehicleListCounts;
    tone?: KpiTileTone;
};

/** KPI tiles on `/vehicles`: the main filter, exactly one is pressed. */
export const vehicleTileFilters: VehicleFilterOption[] = [
    { id: null, label: "Alle", count: "all" },
    { id: "driving", label: "Auf Fahrt", count: "driving", tone: "positive" },
    { id: "idle", label: "Standby", count: "idle" },
    { id: "offline", label: "Kein Signal", count: "offline", tone: "critical" },
    { id: "alerts", label: "Mit Warnung", count: "alerts", tone: "critical" },
    { id: "low_fuel", label: "Wenig Tank", count: "low_fuel", tone: "warning" },
];

/** The rarer filters behind "Weitere Filter" in the toolbar. */
export const vehicleMoreFilters: VehicleFilterOption[] = [
    { id: "unassigned", label: "Kein Fahrer", count: "unassigned" },
    { id: "in_depot", label: "Im Depot", count: "in_depot" },
    {
        id: "driving_unassigned",
        label: "Fährt ohne Fahrer",
        count: "driving_unassigned",
    },
];

function warningTypes(row: Vehicle): AlertType[] {
    const types = new Set(row.open_alert_types ?? []);

    if (row.speeding_open) {
        types.add("SPEEDING");
    }

    return ALERT_TYPES.filter((type) => types.has(type));
}

/** "Transporter · Köln"; a missing part is left out. */
function vehicleSubline(row: Pick<Vehicle, "vehicle_type" | "depot">) {
    return [
        row.vehicle_type ? VEHICLE_TYPE_LABELS[row.vehicle_type] : null,
        row.depot,
    ]
        .filter(Boolean)
        .join(" · ");
}

export const vehicleColumns: TableColumn<Vehicle>[] = [
    {
        key: "license_plate",
        displayText: "Fahrzeug",
        width: "220px",
        sortable: true,
        render: (value, { row }) => {
            const subline = vehicleSubline(row);

            return (
                <span className={styles.identity}>
                    <span className={styles.plate}>{value}</span>
                    {subline && (
                        <span className={styles.subline} title={subline}>
                            {subline}
                        </span>
                    )}
                </span>
            );
        },
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        width: "170px",
        sortable: true,
        // Plain text: the row opens the vehicle, the driver is one click
        // further on the detail page.
        render: (value) =>
            value ? (
                <span title={value}>{value}</span>
            ) : (
                <span className={styles.muted}>—</span>
            ),
    },
    {
        key: "status",
        displayText: "Status",
        width: "130px",
        sortable: true,
        render: (value) => <VehicleStatusChip status={value} />,
    },
    {
        key: "fuel_level",
        displayText: "Tankstand",
        headerText: "Tank",
        width: "140px",
        sortable: true,
        render: (value) => {
            const percent = Math.max(0, Math.min(100, Math.round(value)));
            const low = isLowFuelLevel(value);

            return (
                <span className={styles.fuel} data-low={low || undefined}>
                    <span className={styles.fuelBar} aria-hidden="true">
                        <span
                            className={styles.fuelFill}
                            style={{ width: `${percent}%` }}
                        />
                    </span>
                    {percent} %
                </span>
            );
        },
    },
    {
        key: "speed",
        displayText: "Geschwindigkeit",
        headerText: "km/h",
        width: "100px",
        sortable: true,
        render: (value, { row }) => {
            if (value === null) {
                return <span className={styles.muted}>—</span>;
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
                    {value}
                </span>
            );
        },
    },
    {
        key: "hu_due_on",
        displayText: "HU",
        width: "100px",
        sortable: true,
        render: (value) => formatYearMonth(value),
    },
    {
        key: "uvv_due_on",
        displayText: "UVV",
        width: "100px",
        sortable: true,
        render: (value) => formatIsoDate(value),
    },
    {
        key: "active_alerts",
        displayText: "Warnungen",
        sortable: true,
        render: (_value, { row }) => {
            const types = warningTypes(row);

            if (types.length === 0) {
                return <span className={styles.muted}>—</span>;
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
