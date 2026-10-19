import {
    LOW_FUEL_THRESHOLD_PERCENT,
    type VehicleFilterId,
} from "@fleet-live/shared";

/**
 * What each filter and each count on the vehicle list, the fleet map and the
 * Schicht page means, written once as a predicate on `vehicles v`. The list,
 * its tile counts, the map density cells and the briefing all use these, so a
 * number cannot differ between pages because one query drifted.
 */
export const VEHICLE_CONCEPT_SQL: Record<VehicleFilterId, string> = {
    alerts: "v.active_alerts > 0",
    low_fuel: `v.fuel_level < ${LOW_FUEL_THRESHOLD_PERCENT}`,
    unassigned: "v.current_driver_id IS NULL",
    driving: "v.status = 'DRIVING'",
    idle: "v.status = 'IDLE'",
    offline: "v.status = 'OFFLINE'",
    stopped: "v.status = 'STOPPED'",
    in_depot: "v.depot_site_id IS NOT NULL",
    speeding: `EXISTS (
        SELECT 1 FROM alerts a
        WHERE a.vehicle_id = v.id
          AND a.type = 'SPEEDING'
          AND a.ended_at IS NULL
    )`,
};

/** `COALESCE(SUM(<predicate>), 0) AS <id>` for the given concepts. */
export const conceptCountsSql = (ids: readonly VehicleFilterId[]): string =>
    ids
        .map((id) => `COALESCE(SUM(${VEHICLE_CONCEPT_SQL[id]}), 0) AS ${id}`)
        .join(",\n        ");
