import {
    ALERT_TYPES,
    isLowFuelLevel,
    speedBand,
    VEHICLE_STATUS_FILTER,
    VEHICLE_STATUS_LABELS,
    VEHICLE_TYPE_LABELS,
    type AlertType,
    type Vehicle,
    type VehicleFilterId,
    type VehicleListCounts,
    type VehicleStatus,
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

/** Filter and tile of a status: id, name and count come from shared. */
const statusFilter = (status: VehicleStatus) => ({
    id: VEHICLE_STATUS_FILTER[status],
    displayText: VEHICLE_STATUS_LABELS[status],
});

const statusTile = (status: VehicleStatus) => ({
    id: VEHICLE_STATUS_FILTER[status],
    label: VEHICLE_STATUS_LABELS[status],
    count: VEHICLE_STATUS_FILTER[status],
});

export const vehicleFilters: Array<
    TableFilter<Vehicle> & { id: VehicleFilterId }
> = [
    { id: "alerts", displayText: "Warnungen" },
    { id: "low_fuel", displayText: "Wenig Tank" },
    { id: "unassigned", displayText: "Kein Fahrer" },
    statusFilter("DRIVING"),
    statusFilter("IDLE"),
    statusFilter("OFFLINE"),
    statusFilter("STOPPED"),
    { id: "in_depot", displayText: "Im Depot" },
    { id: "speeding", displayText: "Tempo jetzt" },
];

type VehicleFilterOption = {
    /** `null` is "Alle". */
    id: VehicleFilterId | null;
    label: string;
    count: keyof VehicleListCounts;
    tone?: KpiTileTone;
};

/**
 * KPI tiles on `/vehicles`: the main filter. The four status tiles add up to
 * "Alle". A filter from "Weitere Filter" replaces the tile filter, then no
 * tile is pressed and the toolbar shows the active filter.
 */
export const vehicleTileFilters: VehicleFilterOption[] = [
    { id: null, label: "Alle", count: "all" },
    { ...statusTile("DRIVING"), tone: "positive" },
    statusTile("IDLE"),
    statusTile("STOPPED"),
    { ...statusTile("OFFLINE"), tone: "critical" },
    { id: "speeding", label: "Tempo jetzt", count: "speeding", tone: "critical" },
    { id: "alerts", label: "Mit Warnung", count: "alerts", tone: "critical" },
    { id: "low_fuel", label: "Wenig Tank", count: "low_fuel", tone: "warning" },
];

/** The rarer filters behind "Weitere Filter" in the toolbar. */
export const vehicleMoreFilters: VehicleFilterOption[] = [
    { id: "unassigned", label: "Kein Fahrer", count: "unassigned" },
    { id: "in_depot", label: "Im Depot", count: "in_depot" },
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
        // The longest chip ("Kein Signal") plus the cell padding, so no "…".
        width: "150px",
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
        displayText: "Tempo",
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
        // Without a width this column got 0 px in a narrow window and the
        // hints (Kein Signal, Tempo, Tank) were out of reach.
        width: "180px",
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
