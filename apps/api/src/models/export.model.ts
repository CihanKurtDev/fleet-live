import type { AlertDetails, VehicleStatus, VehicleType } from "@fleet-live/shared";
import {
    VEHICLE_STATUS_LABELS,
    VEHICLE_TYPE_LABELS,
    formatAlertEvent,
    fuelLitersFromMeters,
    isVehicleType,
    parsePeriodMonth,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { toCsv } from "../lib/csv";

const ALERT_TYPE_LABELS = {
    SPEEDING: "Geschwindigkeit",
    LOW_FUEL: "Wenig Tank",
    OFFLINE: "Funk",
} as const;

const ALERT_SEVERITY_LABELS = {
    LOW: "Niedrig",
    MEDIUM: "Mittel",
    HIGH: "Hoch",
} as const;

const VEHICLE_HEADER = [
    "Kennzeichen",
    "Tank",
    "Status",
    "Fahrer",
    "VIN",
    "Fahrzeugtyp",
    "Depot",
    "HU",
    "UVV",
    "UVV fällig",
    "Kostenstelle",
];

const ALERT_HEADER = [
    "Kennzeichen",
    "Fahrer",
    "Art",
    "Schwere",
    "Ereignis",
    "Zeitpunkt",
    "Ende",
    "Erledigt am",
];

const TRIP_HEADER = [
    "Kennzeichen",
    "Start",
    "Ende",
    "Strecke km",
    "Höchstgeschwindigkeit",
    "Punkte",
    "Verbrauch l",
];

const PERIOD_HEADER = [
    "Monat",
    "Kilometer",
    "Angelegt und offen",
    "Angelegt und erledigt",
    "Verbrauch l",
];

const stamp = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
});

type VehicleRow = {
    license_plate: string;
    driver_name: string | null;
    status: VehicleStatus;
    fuel_level: number | null;
    vin: string | null;
    vehicle_type: string | null;
    depot: string | null;
    hu_due_on: string | null;
    uvv_checked_on: string | null;
    uvv_due_on: string | null;
    cost_center: string | null;
};

type AlertRow = {
    license_plate: string;
    driver_name: string | null;
    type: keyof typeof ALERT_TYPE_LABELS;
    severity: keyof typeof ALERT_SEVERITY_LABELS;
    message: string;
    details: string | null;
    created_at: string;
    ended_at: string | null;
    resolved_at: string | null;
};

type TripRow = {
    license_plate: string;
    started_at: string;
    ended_at: string | null;
    distance_m: number | null;
    max_speed: number | null;
    point_count: number | null;
};

export class ExportModel {
    /** Stammdaten, die der Import wieder einliest. Ohne Position und ohne Spur. */
    static vehiclesCsv(companyId: number): string {
        const rows = stmt(
            `
            SELECT
                license_plate,
                driver_name,
                status,
                fuel_level,
                vin,
                vehicle_type,
                depot,
                hu_due_on,
                uvv_checked_on,
                uvv_due_on,
                cost_center
            FROM vehicles
            WHERE company_id = ?
            ORDER BY license_plate COLLATE NOCASE, id
            `,
        ).all(companyId) as VehicleRow[];

        return toCsv([
            VEHICLE_HEADER,
            ...rows.map((row) => [
                row.license_plate,
                row.fuel_level === null ? "" : String(Math.round(row.fuel_level)),
                VEHICLE_STATUS_LABELS[row.status],
                row.driver_name ?? "",
                row.vin ?? "",
                vehicleTypeLabel(row.vehicle_type),
                row.depot ?? "",
                row.hu_due_on ?? "",
                row.uvv_checked_on ?? "",
                row.uvv_due_on ?? "",
                row.cost_center ?? "",
            ]),
        ]);
    }

    /** Jede Warnung der Firma, offen und erledigt. */
    static alertsCsv(companyId: number): string {
        const rows = stmt(
            `
            SELECT
                v.license_plate,
                d.name AS driver_name,
                a.type,
                a.severity,
                a.message,
                a.details,
                a.created_at,
                a.ended_at,
                a.resolved_at
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            LEFT JOIN drivers d ON d.id = a.driver_id
            WHERE v.company_id = ?
            ORDER BY a.created_at DESC, a.id DESC
            `,
        ).all(companyId) as AlertRow[];

        return toCsv([
            ALERT_HEADER,
            ...rows.map((row) => [
                row.license_plate,
                row.driver_name ?? "",
                ALERT_TYPE_LABELS[row.type],
                ALERT_SEVERITY_LABELS[row.severity],
                formatAlertEvent({
                    type: row.type,
                    message: row.message,
                    details: parseDetails(row.details),
                }),
                formatStamp(row.created_at),
                formatStamp(row.ended_at),
                formatStamp(row.resolved_at),
            ]),
        ]);
    }

    /** Fahrten der Firma ohne den kodierten Pfad. */
    static tripsCsv(companyId: number): string {
        const rows = stmt(
            `
            SELECT
                v.license_plate,
                t.started_at,
                t.ended_at,
                t.distance_m,
                t.max_speed,
                t.point_count
            FROM trips t
            INNER JOIN vehicles v ON v.id = t.vehicle_id
            WHERE v.company_id = ?
            ORDER BY t.started_at DESC, t.id DESC
            `,
        ).all(companyId) as TripRow[];

        return toCsv([
            TRIP_HEADER,
            ...rows.map((row) => [
                row.license_plate,
                formatStamp(row.started_at),
                formatStamp(row.ended_at),
                formatKm(row.distance_m),
                row.max_speed === null ? "" : String(Math.round(row.max_speed)),
                row.point_count === null ? "" : String(row.point_count),
                formatLiters(fuelLitersFromMeters(row.distance_m ?? 0)),
            ]),
        ]);
    }

    /**
     * Ein Monat der Firma. Kilometer sind geschlossene Fahrten plus noch
     * offene, die in dem Monat begonnen haben. Warnungen sind die in dem
     * Monat angelegten, geteilt danach ob sie erledigt sind.
     */
    static periodCsv(companyId: number, rawMonth: unknown): string {
        const month = parsePeriodMonth(rawMonth);
        const closed = stmt(
            `
            SELECT COALESCE(distance_m, 0) AS distance_m
            FROM trip_month_km
            WHERE company_id = ? AND month = ?
            `,
        ).get(companyId, month) as { distance_m: number } | undefined;
        const open = stmt(
            `
            SELECT COALESCE(SUM(t.distance_m), 0) AS distance_m
            FROM trips t
            INNER JOIN vehicles v ON v.id = t.vehicle_id
            WHERE v.company_id = ?
              AND t.ended_at IS NULL
              AND strftime('%Y-%m', t.started_at) = ?
            `,
        ).get(companyId, month) as { distance_m: number };
        const alerts = stmt(
            `
            SELECT
                COALESCE(SUM(a.resolved_at IS NULL), 0) AS open_count,
                COALESCE(SUM(a.resolved_at IS NOT NULL), 0) AS resolved_count
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              AND strftime('%Y-%m', a.created_at) = ?
            `,
        ).get(companyId, month) as {
            open_count: number;
            resolved_count: number;
        };
        const meters = Number(closed?.distance_m ?? 0) + Number(open.distance_m);

        return toCsv([
            PERIOD_HEADER,
            [
                month,
                formatKm(meters),
                String(Number(alerts.open_count)),
                String(Number(alerts.resolved_count)),
                formatLiters(fuelLitersFromMeters(meters)),
            ],
        ]);
    }
}

function vehicleTypeLabel(value: string | null): string {
    if (value && isVehicleType(value)) {
        return VEHICLE_TYPE_LABELS[value as VehicleType];
    }

    return value ?? "";
}

function parseDetails(value: string | null): AlertDetails | null {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value) as AlertDetails;
    } catch {
        return null;
    }
}

function formatStamp(value: string | null): string {
    if (!value) {
        return "";
    }

    const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return stamp.format(date);
}

function formatKm(meters: number | null): string {
    return formatLiters(meters === null ? 0 : meters / 1000);
}

function formatLiters(value: number): string {
    return value.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
}
