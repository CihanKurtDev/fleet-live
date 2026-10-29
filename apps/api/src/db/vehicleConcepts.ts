import {
    LOW_FUEL_THRESHOLD_PERCENT,
    type VehicleFilterId,
} from "@fleet-live/shared";

/**
 * A workshop stay that needs someone today: planned for today or earlier but
 * not there yet, or there and later than expected. Written once for the list
 * filter, the Schicht task list and its chip (`w` is `workshop_visits`).
 */
export const WORKSHOP_DUE_SQL = `(
        (w.state = 'PLANNED' AND w.planned_on <= berlin_today())
        OR (w.state = 'IN_WORKSHOP' AND w.expected_on < berlin_today())
    )`;

/** The vehicle stands in a workshop: its open stay has arrived. */
const IN_WORKSHOP_SQL = `EXISTS (
        SELECT 1 FROM workshop_visits w
        WHERE w.vehicle_id = v.id
          AND w.state = 'IN_WORKSHOP'
    )`;

/** Not to be given to a driver: in a workshop or out of service. */
export const VEHICLE_UNAVAILABLE_SQL = `(${IN_WORKSHOP_SQL} OR v.out_of_service_since IS NOT NULL)`;

/** `availability` of a vehicle row; the workshop wins over out of service. */
export const VEHICLE_AVAILABILITY_SQL = `CASE
        WHEN ${IN_WORKSHOP_SQL} THEN 'WORKSHOP'
        WHEN v.out_of_service_since IS NOT NULL THEN 'OUT_OF_SERVICE'
        ELSE 'READY'
    END`;

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
    in_workshop: IN_WORKSHOP_SQL,
    workshop_due: `EXISTS (
        SELECT 1 FROM workshop_visits w
        WHERE w.vehicle_id = v.id
          AND ${WORKSHOP_DUE_SQL}
    )`,
    out_of_service: "v.out_of_service_since IS NOT NULL",
};

/** `COALESCE(SUM(<predicate>), 0) AS <id>` for the given concepts. */
export const conceptCountsSql = (ids: readonly VehicleFilterId[]): string =>
    ids
        .map((id) => `COALESCE(SUM(${VEHICLE_CONCEPT_SQL[id]}), 0) AS ${id}`)
        .join(",\n        ");
