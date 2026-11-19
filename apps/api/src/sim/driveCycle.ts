import { stmt } from "../db/statements";
import { isCompanySimRunning } from "../lib/simControl";
import { sqliteFromMs } from "../lib/sqlTime";
import { DriveModel } from "../models/drive.model";

/** About this share of the vehicles with a driver is on the road at any time. */
export const SIM_ON_ROAD_SHARE = 0.25;
/** A vehicle stands at least this long after a trip, so a small fleet does not drive nonstop. */
export const SIM_MIN_REST_MS = 4 * 60 * 60_000;

type CrewedVehicle = {
    id: number;
    company_id: number;
    status: "IDLE" | "DRIVING";
    recorded_at: string;
};

/**
 * In the demo the vehicles take turns: a trip ends at the end of its road, the
 * vehicle stands, and the one that has stood longest sets off next. Real
 * devices replace this. Returns the companies whose vehicles changed.
 */
export function playNextTrips(nowMs = Date.now()): number[] {
    const rows = stmt(
        `SELECT v.id, v.company_id, v.status, t.recorded_at
         FROM vehicles v
         JOIN telemetry t ON t.id = v.last_telemetry_id
         JOIN drivers d ON d.id = v.current_driver_id
         WHERE v.active = 1
           -- A driver whose licence has run out does not set off.
           AND (d.licence_expires_on IS NULL OR d.licence_expires_on >= berlin_today())
           AND v.at_workshop_id IS NULL
           AND v.status IN ('IDLE', 'DRIVING')
         ORDER BY t.recorded_at`,
    ).all() as CrewedVehicle[];
    const rested = sqliteFromMs(nowMs - SIM_MIN_REST_MS);
    const fleets = new Map<number, CrewedVehicle[]>();
    const companies: number[] = [];

    for (const row of rows) {
        fleets.set(row.company_id, [...(fleets.get(row.company_id) ?? []), row]);
    }

    for (const [companyId, fleet] of fleets) {
        if (!isCompanySimRunning(companyId)) {
            continue;
        }

        const onRoad = fleet.filter((row) => row.status === "DRIVING").length;
        const free = Math.ceil(fleet.length * SIM_ON_ROAD_SHARE) - onRoad;
        const next = fleet
            .filter((row) => row.status === "IDLE" && row.recorded_at <= rested)
            .slice(0, Math.max(0, free));

        for (const row of next) {
            DriveModel.report(row.id, companyId, "DRIVING");
        }

        if (next.length > 0) {
            companies.push(companyId);
        }
    }

    return companies;
}
