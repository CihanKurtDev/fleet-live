import {
    ALERT_TYPES,
    berlinTodayIso,
    vehicleDeadlines,
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
import chipStyles from "../alerts/WarningChip.module.scss";
import { dayText, isReturnLate, shortDate } from "./workshopText";
import { speedBandTitle, SPEED_BAND_COLORS } from "./speedBand";
import { VEHICLE_TILE_HINTS } from "./vehicleTileHints";
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
    hint: VEHICLE_TILE_HINTS.status,
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
    /** The tile's line under the number: what it counts. */
    hint?: string;
};

/**
 * KPI tiles on `/vehicles`: the main filter. The four status tiles add up to
 * "Alle". A filter from "Weitere Filter" replaces the tile filter, then no
 * tile is pressed and the toolbar shows the active filter.
 */
export const vehicleTileFilters: VehicleFilterOption[] = [
    { id: null, label: "Alle", count: "all", hint: VEHICLE_TILE_HINTS.all },
    { ...statusTile("DRIVING"), tone: "positive" },
    statusTile("IDLE"),
    statusTile("STOPPED"),
    { ...statusTile("OFFLINE"), tone: "critical" },
    { id: "unavailable", label: "Ausfall", count: "unavailable", hint: VEHICLE_TILE_HINTS.unavailable },
    { id: "speeding", label: "Tempo jetzt", count: "speeding", tone: "critical", hint: VEHICLE_TILE_HINTS.speeding },
    { id: "alerts", label: "Mit Warnung", count: "alerts", tone: "critical", hint: VEHICLE_TILE_HINTS.alerts },
    { id: "low_fuel", label: "Wenig Tank", count: "low_fuel", tone: "warning", hint: VEHICLE_TILE_HINTS.low_fuel },
];

/** The rarer filters behind "Weitere Filter" in the toolbar. */
export const vehicleMoreFilters: VehicleFilterOption[] = [
    { id: "unassigned", label: "Kein Fahrer", count: "unassigned" },
    { id: "in_workshop", label: "In der Werkstatt", count: "in_workshop" },
    { id: "deadline_overdue", label: "Frist abgelaufen", count: "deadline_overdue", tone: "critical" },
    { id: "deadline_soon", label: "Frist bald fällig", count: "deadline_soon", tone: "warning" },
    { id: "in_depot", label: "Im Depot", count: "in_depot" },
    { id: "workshop_due", label: "Werkstatt fällig", count: "workshop_due" },
    { id: "out_of_service", label: "Außer Dienst", count: "out_of_service" },
    { id: "damage_open", label: "Schaden offen", count: "damage_open" },
    { id: "not_drivable", label: "Nicht fahrbereit", count: "not_drivable" },
    { id: "damage_unplanned", label: "Schaden ohne Termin", count: "damage_unplanned" },
];

/**
 * A vehicle that is not in the workshop but has business there: the
 * appointment (red when missed, „kein Fahrer“ when nobody takes it today),
 * or finished and waiting there, or parked there without a stay. The same
 * rows as the filter Werkstatt fällig, plus planned appointments. Short, so
 * the warning chips after it still fit the column.
 */
function workshopHint(row: Vehicle) {
    const text =
        row.workshop_task === "missed"
            ? "verpasst"
            : row.workshop_task === "trip_no_driver"
              ? "kein Fahrer"
              : row.workshop_task === "pickup"
                ? "abholen"
                : row.workshop_task === "unplanned"
                  ? "ohne Termin"
                  : row.workshop?.state === "PLANNED"
                    ? `Termin ${dayText(row.workshop.planned_on)}`
                    : null;

    if (!text) {
        return null;
    }

    return (
        <>
            <span className={chipStyles.chip}>Werkstatt</span>
            <span className={row.workshop_task === "missed" ? styles.late : styles.muted}>{text}</span>
        </>
    );
}

/**
 * „Werkstatt · fertig 31.10.“ (red when late), „Nicht fahrbereit“ or „Außer
 * Dienst“, and „Schaden“ for an open damage it can still be driven with.
 */
function availabilityHint(row: Vehicle) {
    if (row.availability === "NOT_DRIVABLE") {
        return (
            <span className={chipStyles.chip} data-tone="danger">
                Nicht fahrbereit
            </span>
        );
    }

    const damage =
        row.open_damages > 0 ? <span className={chipStyles.chip} data-tone="warning">Schaden</span> : null;

    if (row.availability === "OUT_OF_SERVICE") {
        return (
            <>
                <span className={chipStyles.chip}>Außer Dienst</span>
                {damage}
            </>
        );
    }

    if (row.availability === "READY") {
        return (
            <>
                {workshopHint(row)}
                {damage}
            </>
        );
    }

    if (row.availability !== "WORKSHOP" || !row.workshop) {
        return null;
    }

    return (
        <>
            <span className={chipStyles.chip}>Werkstatt</span>
            {row.workshop.expected_on && (
                <span
                    className={
                        isReturnLate(row.workshop) ? styles.late : styles.muted
                    }
                >
                    fertig {shortDate(row.workshop.expected_on)}
                </span>
            )}
        </>
    );
}

type DeadlineMark = "overdue" | "today" | "soon" | null;

/**
 * HU and UVV of a row as the list marks them: past, due today, or due within
 * the company lead (`hu_state` / `uvv_state` from the server, the rule of
 * /fristen). „Today“ is the same rule with a lead of 0 days.
 */
function deadlineMarks(row: Vehicle): Record<"HU" | "UVV", DeadlineMark> {
    const dueToday = vehicleDeadlines(row, berlinTodayIso(), 0);
    const mark = (reason: "HU" | "UVV", state: Vehicle["hu_state"]): DeadlineMark =>
        state === "overdue"
            ? "overdue"
            : dueToday.find((deadline) => deadline.reason === reason)?.state === "soon"
              ? "today"
              : state === "soon"
                ? "soon"
                : null;

    return { HU: mark("HU", row.hu_state), UVV: mark("UVV", row.uvv_state) };
}

/**
 * „HU abgelaufen“, „UVV heute“, „HU/UVV abgelaufen“, unless the open workshop
 * stay already takes care of it (then the Werkstatt hint says when).
 */
function deadlineHint(row: Vehicle) {
    const covered = (reason: "HU" | "UVV") => row.workshop?.reasons.includes(reason) ?? false;
    const marks = deadlineMarks(row);
    const of = (state: DeadlineMark) =>
        (["HU", "UVV"] as const).filter((reason) => marks[reason] === state && !covered(reason));
    const expired = of("overdue");
    const today = of("today");

    if (expired.length === 0 && today.length === 0) {
        return null;
    }

    return (
        <>
            {expired.length > 0 && (
                <span className={chipStyles.chip} data-tone="accent">
                    {expired.join("/")} abgelaufen
                </span>
            )}
            {today.length > 0 && (
                <span className={chipStyles.chip} data-tone="accent">
                    {today.join("/")} heute
                </span>
            )}
        </>
    );
}

const MARK_TEXT: Record<Exclude<DeadlineMark, null>, string> = {
    overdue: "abgelaufen",
    today: "heute fällig",
    soon: "bald fällig",
};

/** A deadline cell: yellow with a dot when past or due today, a ring when due within the lead. */
function deadlineCell(text: string, mark: DeadlineMark) {
    if (mark === null) {
        return text;
    }

    return (
        <span className={styles.deadline} data-state={mark} title={MARK_TEXT[mark]}>
            <span className={styles.deadlineDot} aria-hidden="true" />
            {text}
            <span className={styles.srOnly}>, {MARK_TEXT[mark]}</span>
        </span>
    );
}

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
        render: (value, { row }) => deadlineCell(formatYearMonth(value), deadlineMarks(row).HU),
    },
    {
        key: "uvv_due_on",
        displayText: "UVV",
        width: "100px",
        sortable: true,
        render: (value, { row }) => deadlineCell(formatIsoDate(value), deadlineMarks(row).UVV),
    },
    {
        key: "active_alerts",
        displayText: "Hinweise",
        // Without a width this column got 0 px in a narrow window and the
        // hints (Werkstatt, Kein Signal, Tempo, Tank) were out of reach.
        width: "200px",
        sortable: true,
        render: (_value, { row }) => {
            const types = warningTypes(row);
            const availability = availabilityHint(row);
            const deadline = deadlineHint(row);

            if (types.length === 0 && !availability && !deadline) {
                return <span className={styles.muted}>—</span>;
            }

            return (
                <span className={styles.chips}>
                    {availability}
                    {deadline}
                    {types.map((type) => (
                        <WarningChip key={type} type={type} />
                    ))}
                </span>
            );
        },
    },
];
