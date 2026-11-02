import {
    LOW_FUEL_THRESHOLD_PERCENT,
    type VehicleFilterId,
} from "@fleet-live/shared";

/** The vehicle stands in a workshop: its open stay has arrived. */
const IN_WORKSHOP_SQL = `EXISTS (
        SELECT 1 FROM workshop_visits w
        WHERE w.vehicle_id = v.id
          AND w.state = 'IN_WORKSHOP'
    )`;

/** An open damage that the vehicle cannot be driven with. */
const UNDRIVABLE_DAMAGE_SQL = `EXISTS (
        SELECT 1 FROM vehicle_damages d
        WHERE d.vehicle_id = v.id
          AND d.state = 'OPEN'
          AND d.drivable = 0
    )`;

const OPEN_STAY_SQL = `EXISTS (
        SELECT 1 FROM workshop_visits w
        WHERE w.vehicle_id = v.id
          AND w.state IN ('PLANNED', 'IN_WORKSHOP')
    )`;

/** Not to be given to a driver: in a workshop, not drivable or out of service. */
/** A finished stay at the workshop the vehicle stands in, not picked up yet. */
const TO_PICK_UP_SQL = `EXISTS (
        SELECT 1 FROM workshop_visits w
        WHERE w.vehicle_id = v.id
          AND w.state = 'DONE'
          AND w.workshop_id = v.at_workshop_id
          AND w.picked_up_at IS NULL
    )`;

/**
 * What a workshop stay needs from someone today, as a task name or NULL
 * (`WORKSHOP_TASKS` in shared). Missed: the appointment passed, the vehicle
 * never parked there. Return late: still there after „fertig erwartet“. Trip
 * without driver: the appointment is today and the standing vehicle has no
 * driver. Pickup: finished, still there, no driver. Unplanned: parks in a
 * workshop circle without a stay. Written once for the list filter, the
 * Schicht task list and its chip.
 */
export const WORKSHOP_TASK_SQL = `COALESCE(
        (
            SELECT CASE
                WHEN w.state = 'PLANNED' AND w.planned_on < berlin_today() THEN 'missed'
                WHEN w.state = 'IN_WORKSHOP' AND w.expected_on < berlin_today() THEN 'return_late'
                WHEN w.state = 'PLANNED' AND w.planned_on = berlin_today()
                    AND w.transport = 'DRIVER'
                    AND v.status != 'DRIVING' AND v.current_driver_id IS NULL
                    AND v.at_workshop_id IS NOT w.workshop_id THEN 'trip_no_driver'
            END
            FROM workshop_visits w
            WHERE w.vehicle_id = v.id AND w.state IN ('PLANNED', 'IN_WORKSHOP')
        ),
        CASE
            WHEN v.at_workshop_id IS NULL OR v.status = 'DRIVING' OR ${OPEN_STAY_SQL} THEN NULL
            WHEN ${TO_PICK_UP_SQL} THEN CASE WHEN v.current_driver_id IS NULL THEN 'pickup' END
            ELSE 'unplanned'
        END
    )`;

/** `vehicle_deadline` (db/database.ts) of a vehicle row: 'HU', 'UVV' or 'ANY'. */
export const vehicleDeadlineSql = (kind: "HU" | "UVV" | "ANY") => `vehicle_deadline(
        '${kind}', v.hu_due_on, v.uvv_due_on, v.uvv_checked_on,
        (SELECT c.due_lead_days FROM companies c WHERE c.id = v.company_id)
    )`;

const DEADLINE_STATE_SQL = vehicleDeadlineSql("ANY");

export const VEHICLE_UNAVAILABLE_SQL = `(${IN_WORKSHOP_SQL} OR ${UNDRIVABLE_DAMAGE_SQL} OR v.out_of_service_since IS NOT NULL)`;

/**
 * `availability` of a vehicle row: the workshop wins, then a damage it
 * cannot be driven with, then out of service.
 */
export const VEHICLE_AVAILABILITY_SQL = `CASE
        WHEN ${IN_WORKSHOP_SQL} THEN 'WORKSHOP'
        WHEN ${UNDRIVABLE_DAMAGE_SQL} THEN 'NOT_DRIVABLE'
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
    workshop_due: `${WORKSHOP_TASK_SQL} IS NOT NULL`,
    out_of_service: "v.out_of_service_since IS NOT NULL",
    damage_open: `EXISTS (
        SELECT 1 FROM vehicle_damages d
        WHERE d.vehicle_id = v.id AND d.state = 'OPEN'
    )`,
    not_drivable: `(${UNDRIVABLE_DAMAGE_SQL} AND NOT ${IN_WORKSHOP_SQL})`,
    damage_unplanned: `(${UNDRIVABLE_DAMAGE_SQL} AND NOT ${OPEN_STAY_SQL})`,
    unavailable: VEHICLE_UNAVAILABLE_SQL,
    deadline_overdue: `${DEADLINE_STATE_SQL} = 'overdue'`,
    deadline_soon: `${DEADLINE_STATE_SQL} = 'soon'`,
};

/** `COALESCE(SUM(<predicate>), 0) AS <id>` for the given concepts. */
export const conceptCountsSql = (ids: readonly VehicleFilterId[]): string =>
    ids
        .map((id) => `COALESCE(SUM(${VEHICLE_CONCEPT_SQL[id]}), 0) AS ${id}`)
        .join(",\n        ");
