import {
    BRIEFING_DRIVER_LIMIT,
    BRIEFING_OFFLINE_LIMIT,
    BRIEFING_OPEN_ALERT_LIMIT,
    type BriefingCounts,
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
