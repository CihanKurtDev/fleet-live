import {
    briefingMonthKeys,
    dueCounts,
    resolveDueSettings,
    type BriefingCounts,
    type BriefingHistoryMonth,
    type BriefingResponse,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { conceptCountsSql } from "../db/vehicleConcepts";
import { CompanyModel } from "./company.model";
import { DueModel } from "./due.model";

/** What Schicht counts about vehicles; each is one concept in `db/vehicleConcepts.ts`. */
const BRIEFING_VEHICLE_CONCEPTS = [
    "driving",
    "idle",
    "stopped",
    "offline",
    "low_fuel",
    "in_depot",
    "speeding",
    "unavailable",
] as const;

type VehicleCountRow = Record<
    | "driving"
    | "idle"
    | "stopped"
    | "offline"
    | "low_fuel"
    | "in_depot"
    | "speeding"
    | "unavailable",
    number
>;

type OpenCountRow = {
    open_count: number;
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

    // Who drove in a month comes from that month's trips, not today's roster.
    const rosterRows = stmt(
        `
        SELECT
            strftime('%Y-%m', t.started_at) AS month,
            COUNT(DISTINCT t.vehicle_id) AS active_vehicles,
            COUNT(DISTINCT t.driver_id) AS active_drivers
        FROM trips t
        INNER JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.company_id = ?
          AND t.started_at >= ?
          AND t.started_at < ?
        GROUP BY 1
        `,
    ).all(companyId, from, until) as (RosterRow & { month: string })[];
    const rosterByMonth = new Map(rosterRows.map((row) => [row.month, row] as const));

    // Low tank and no signal count the vehicles that had such a warning at any
    // time in the month, also one opened before it: a state, not an event.
    const stateRows = keys.map((month) => {
        const range = historyRange([month]);
        return {
            month,
            ...(stmt(
                `
                SELECT
                    COUNT(DISTINCT CASE WHEN a.type = 'LOW_FUEL' THEN a.vehicle_id END) AS low_fuel_vehicles,
                    COUNT(DISTINCT CASE WHEN a.type = 'OFFLINE' THEN a.vehicle_id END) AS offline_vehicles
                FROM alerts a
                INNER JOIN vehicles v ON v.id = a.vehicle_id
                WHERE v.company_id = ?
                  AND a.type IN ('LOW_FUEL', 'OFFLINE')
                  AND a.created_at < ?
                  AND (a.resolved_at IS NULL OR a.resolved_at >= ?)
                `,
            ).get(companyId, range.until, range.from) as {
                low_fuel_vehicles: number;
                offline_vehicles: number;
            }),
        };
    });
    const stateByMonth = new Map(stateRows.map((row) => [row.month, row] as const));

    const alertRows = stmt(
        `
        SELECT
            strftime('%Y-%m', a.created_at) AS month,
            COUNT(DISTINCT CASE WHEN a.type = 'SPEEDING' THEN a.driver_id END)
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

    // Months whose old warnings were deleted keep their sums here.
    const storedRows = stmt(
        `
        SELECT month, speeding_drivers, speeding_events, speeding_high,
               low_fuel_vehicles, offline_vehicles
        FROM alert_month_stats
        WHERE company_id = ?
          AND month >= ?
          AND month <= ?
        `,
    ).all(companyId, firstMonth, lastMonth) as AlertMonthRow[];

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
        [...alertRows, ...storedRows].map((row) => [row.month, row] as const),
    );
    const kmByMonth = new Map(
        kmRows.map((row) => [row.month, Number(row.distance_m)] as const),
    );

    const openDistance = Number(openKm.distance_m);

    return keys.map((month) => {
        const alerts = alertsByMonth.get(month);
        const closedKm = kmByMonth.get(month) ?? 0;
        const distance = month === lastMonth ? closedKm + openDistance : closedKm;
        const roster = rosterByMonth.get(month);
        const state = stateByMonth.get(month);
        // Trips older than the retention are gone while their km stay: then
        // nobody can say who drove, which is not the same as nobody.
        const unknownRoster = !roster && distance > 0;
        const stateCount = (key: "low_fuel_vehicles" | "offline_vehicles") =>
            Number(state?.[key] ?? 0) || Number(alerts?.[key] ?? 0);

        return {
            month,
            active_drivers: unknownRoster ? null : Number(roster?.active_drivers ?? 0),
            active_vehicles: unknownRoster ? null : Number(roster?.active_vehicles ?? 0),
            speeding_drivers: Number(alerts?.speeding_drivers ?? 0),
            speeding_events: Number(alerts?.speeding_events ?? 0),
            speeding_high: Number(alerts?.speeding_high ?? 0),
            low_fuel_vehicles: stateCount("low_fuel_vehicles"),
            offline_vehicles: stateCount("offline_vehicles"),
            distance_m: distance,
        };
    });
};

const dueForCompany = (companyId: number) =>
    dueCounts(DueModel.rowsForCompany(companyId));

export class BriefingModel {
    static forCompany(companyId: number): BriefingResponse {
        // The same predicates as the vehicle list and the fleet map.
        const vehicles = stmt(
            `
            SELECT
                ${conceptCountsSql(BRIEFING_VEHICLE_CONCEPTS)}
            FROM vehicles v
            WHERE v.company_id = ?
            `,
        ).get(companyId) as VehicleCountRow;

        const open = stmt(
            `
            SELECT COUNT(*) AS open_count
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              AND a.resolved_at IS NULL
            `,
        ).get(companyId) as OpenCountRow;

        const counts: BriefingCounts = {
            open: Number(open.open_count),
            offline: Number(vehicles.offline),
            driving: Number(vehicles.driving),
            idle: Number(vehicles.idle),
            stopped: Number(vehicles.stopped),
            low_fuel: Number(vehicles.low_fuel),
            in_depot: Number(vehicles.in_depot),
            speeding: Number(vehicles.speeding),
            unavailable: Number(vehicles.unavailable),
        };

        return {
            data: {
                counts,
                history: listHistory(companyId),
                due: dueForCompany(companyId),
                due_lead_days: resolveDueSettings(
                    CompanyModel.dueSettings(companyId),
                ).lead_days,
            },
        };
    }
}
