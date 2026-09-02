import {
    BRIEFING_DRIVER_LIMIT,
    BRIEFING_OFFLINE_LIMIT,
    BRIEFING_OPEN_ALERT_LIMIT,
    briefingMonthKeys,
    type BriefingCounts,
    type BriefingHistoryMonth,
    type BriefingOfflineVehicle,
    type BriefingResponse,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { AlertModel } from "./alert.model";
import { DriverModel } from "./driver.model";

type StatusCountRow = {
    driving: number;
    idle: number;
    offline: number;
};

type OpenCountRow = {
    open_count: number;
    low_fuel_count: number;
};

type RosterRow = {
    active_drivers: number;
    active_vehicles: number;
};

type AlertMonthRow = {
    month: string;
    speeding_drivers: number;
    speeding_events: number;
    speeding_high: number;
    low_fuel_vehicles: number;
    offline_vehicles: number;
};

type KmMonthRow = {
    month: string;
    distance_m: number;
};

type OpenKmRow = {
    distance_m: number;
};

const historyRange = (keys: string[]) => {
    const first = keys[0];
    const last = keys[keys.length - 1];

    if (!first || !last) {
        return { from: "1970-01-01 00:00:00", until: "1970-01-01 00:00:00" };
    }

    const [year, month] = last.split("-").map(Number);
    const until = new Date(Date.UTC(year, month, 1));

    return {
        from: `${first}-01 00:00:00`,
        until: until.toISOString().slice(0, 19).replace("T", " "),
    };
};

const listHistory = (companyId: number): BriefingHistoryMonth[] => {
    const keys = briefingMonthKeys();
    const { from, until } = historyRange(keys);
    const firstMonth = keys[0] ?? "1970-01";
    const lastMonth = keys[keys.length - 1] ?? "1970-01";

    const roster = stmt(
        `
        SELECT
            COUNT(*) AS active_vehicles,
            COUNT(DISTINCT driver_id) AS active_drivers
        FROM vehicles
        WHERE company_id = ?
          AND driver_id IS NOT NULL
        `,
    ).get(companyId) as RosterRow;

    const alertRows = stmt(
        `
        SELECT
            strftime('%Y-%m', a.created_at) AS month,
            COUNT(DISTINCT CASE WHEN a.type = 'SPEEDING' THEN v.driver_id END)
                AS speeding_drivers,
            COALESCE(SUM(a.type = 'SPEEDING'), 0) AS speeding_events,
            COALESCE(SUM(a.type = 'SPEEDING' AND a.severity = 'HIGH'), 0)
                AS speeding_high,
            COUNT(DISTINCT CASE WHEN a.type = 'LOW_FUEL' THEN a.vehicle_id END)
                AS low_fuel_vehicles,
            COUNT(DISTINCT CASE WHEN a.type = 'OFFLINE' THEN a.vehicle_id END)
                AS offline_vehicles
        FROM alerts a
        INNER JOIN vehicles v ON v.id = a.vehicle_id
        WHERE v.company_id = ?
          AND a.created_at >= ?
          AND a.created_at < ?
        GROUP BY 1
        `,
    ).all(companyId, from, until) as AlertMonthRow[];

    const kmRows = stmt(
        `
        SELECT month, distance_m
        FROM trip_month_km
        WHERE company_id = ?
          AND month >= ?
          AND month <= ?
        `,
    ).all(companyId, firstMonth, lastMonth) as KmMonthRow[];

    const openKm = stmt(
        `
        SELECT COALESCE(SUM(t.distance_m), 0) AS distance_m
        FROM trips t
        INNER JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.company_id = ?
          AND t.ended_at IS NULL
          AND strftime('%Y-%m', t.started_at) = ?
        `,
    ).get(companyId, lastMonth) as OpenKmRow;

    const alertsByMonth = new Map(
        alertRows.map((row) => [row.month, row] as const),
    );
    const kmByMonth = new Map(
        kmRows.map((row) => [row.month, Number(row.distance_m)] as const),
    );

    const active_drivers = Number(roster.active_drivers);
    const active_vehicles = Number(roster.active_vehicles);
    const openDistance = Number(openKm.distance_m);

    return keys.map((month) => {
        const alerts = alertsByMonth.get(month);
        const closedKm = kmByMonth.get(month) ?? 0;

        return {
            month,
            active_drivers,
            active_vehicles,
            speeding_drivers: Number(alerts?.speeding_drivers ?? 0),
            speeding_events: Number(alerts?.speeding_events ?? 0),
            speeding_high: Number(alerts?.speeding_high ?? 0),
            low_fuel_vehicles: Number(alerts?.low_fuel_vehicles ?? 0),
            offline_vehicles: Number(alerts?.offline_vehicles ?? 0),
            distance_m:
                month === lastMonth ? closedKm + openDistance : closedKm,
        };
    });
};

export class BriefingModel {
    static forCompany(companyId: number): BriefingResponse {
        const status = stmt(
            `
            SELECT
                COALESCE(SUM(status = 'DRIVING'), 0) AS driving,
                COALESCE(SUM(status = 'IDLE'), 0) AS idle,
                COALESCE(SUM(status = 'OFFLINE'), 0) AS offline
            FROM vehicles
            WHERE company_id = ?
            `,
        ).get(companyId) as StatusCountRow;

        const open = stmt(
            `
            SELECT
                COUNT(*) AS open_count,
                COALESCE(SUM(a.type = 'LOW_FUEL'), 0) AS low_fuel_count
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              AND a.resolved_at IS NULL
            `,
        ).get(companyId) as OpenCountRow;

        const counts: BriefingCounts = {
            open: Number(open.open_count),
            offline: Number(status.offline),
            driving: Number(status.driving),
            idle: Number(status.idle),
            low_fuel: Number(open.low_fuel_count),
        };

        const offlineVehicles = stmt(
            `
            SELECT
                v.id,
                v.license_plate,
                v.driver_id,
                v.driver_name,
                t.recorded_at
            FROM vehicles v
            LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
              AND v.status = 'OFFLINE'
            ORDER BY
                (t.recorded_at IS NULL),
                t.recorded_at ASC,
                v.license_plate COLLATE NOCASE
            LIMIT ?
            `,
        ).all(companyId, BRIEFING_OFFLINE_LIMIT) as BriefingOfflineVehicle[];

        return {
            data: {
                counts,
                history: listHistory(companyId),
                open_alerts: AlertModel.listOpenNewest(
                    companyId,
                    BRIEFING_OPEN_ALERT_LIMIT,
                ),
                offline_vehicles: offlineVehicles.map((row) => ({
                    ...row,
                    recorded_at: row.recorded_at ?? null,
                })),
                drivers: DriverModel.listTopByOpenWarnings(
                    companyId,
                    BRIEFING_DRIVER_LIMIT,
                ),
            },
        };
    }
}
