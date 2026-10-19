import type { DatabaseSync } from "node:sqlite";
import {
    LOW_FUEL_CRITICAL_PERCENT,
    LOW_FUEL_THRESHOLD_PERCENT,
    SELF_CLOSING_ALERT_TYPES,
    SPEEDING_OPEN_DAYS,
} from "@fleet-live/shared";

/** `('LOW_FUEL', 'OFFLINE')` for SQL: warnings that follow a state. */
export const SELF_CLOSING_TYPES_SQL = `(${SELF_CLOSING_ALERT_TYPES.map(
    (type) => `'${type}'`,
).join(", ")})`;

export const LOW_FUEL_MESSAGE = "Tankstand ist niedrig.";
export const OFFLINE_MESSAGE = "Fahrzeug sendet kein Signal.";

export type StateAlertScope = {
    /** Only this company's vehicles (import). */
    companyId?: number;
    /** Only this vehicle (create/update). */
    vehicleId?: number;
};

const IN_SCOPE = `
    SELECT v.id FROM vehicles v
    WHERE (? IS NULL OR v.company_id = ?)
      AND (? IS NULL OR v.id = ?)
`;

/**
 * Warnings that report a state (low tank, no signal) follow the state. The
 * first two statements hold for both types: an ended row is closed, and a row
 * clicked away while its state lasted no longer holds the one open slot per
 * vehicle and type. The rest is low fuel:
 *
 * Low fuel is a state, so its warning follows the state: a vehicle under
 * `LOW_FUEL_THRESHOLD_PERCENT` has exactly one open LOW_FUEL warning, and the
 * warning is gone (closed, not waiting for a click) as soon as the tank is
 * above the threshold again. The inbox, the vehicle filter and the Schicht
 * count therefore show the same vehicles.
 *
 * Plain SQL on purpose: it runs on every start for data that already exists
 * (the seed and old dispatcher clicks left LOW_FUEL rows that do not match the
 * tank), and after every write that sets `fuel_level`. It does nothing when
 * everything already matches.
 */
export function syncStateAlerts(
    database: DatabaseSync,
    scope: StateAlertScope = {},
    now = new Date().toISOString().slice(0, 19).replace("T", " "),
): void {
    const company = scope.companyId ?? null;
    const vehicle = scope.vehicleId ?? null;
    const scopeParams = [company, company, vehicle, vehicle];

    // A row clicked away while the tank was still low does not hold the one
    // open slot per vehicle and type any longer: its state ended with the click.
    database
        .prepare(
            `UPDATE alerts SET ended_at = resolved_at
             WHERE type IN ${SELF_CLOSING_TYPES_SQL}
               AND ended_at IS NULL
               AND resolved_at IS NOT NULL
               AND vehicle_id IN (${IN_SCOPE})`,
        )
        .run(...scopeParams);

    // An ended row nobody closed would sit in the inbox next to a new one.
    database
        .prepare(
            `UPDATE alerts SET resolved_at = ended_at
             WHERE type IN ${SELF_CLOSING_TYPES_SQL}
               AND resolved_at IS NULL
               AND ended_at IS NOT NULL
               AND vehicle_id IN (${IN_SCOPE})`,
        )
        .run(...scopeParams);

    // Tank is full again (or never was low): the warning disappears.
    database
        .prepare(
            `UPDATE alerts
             SET ended_at = COALESCE(ended_at, ?), resolved_at = ?
             WHERE type = 'LOW_FUEL'
               AND resolved_at IS NULL
               AND vehicle_id IN (
                   SELECT v.id FROM vehicles v
                   WHERE v.fuel_level >= ?
                     AND (? IS NULL OR v.company_id = ?)
                     AND (? IS NULL OR v.id = ?)
               )`,
        )
        .run(now, now, LOW_FUEL_THRESHOLD_PERCENT, ...scopeParams);

    // Still low: keep the one open row and its reading current.
    database
        .prepare(
            `UPDATE alerts
             SET details = json_object('fuel_level', (
                     SELECT v.fuel_level FROM vehicles v WHERE v.id = alerts.vehicle_id
                 )),
                 severity = CASE
                     WHEN (SELECT v.fuel_level FROM vehicles v WHERE v.id = alerts.vehicle_id)
                          < ${LOW_FUEL_CRITICAL_PERCENT}
                     THEN 'HIGH' ELSE 'MEDIUM'
                 END
             WHERE type = 'LOW_FUEL'
               AND ended_at IS NULL
               AND resolved_at IS NULL
               AND vehicle_id IN (${IN_SCOPE})`,
        )
        .run(...scopeParams);

    // Under the threshold without an open warning: open one.
    database
        .prepare(
            `INSERT INTO alerts (
                 vehicle_id, driver_id, type, severity, message, details, created_at
             )
             SELECT
                 v.id,
                 v.current_driver_id,
                 'LOW_FUEL',
                 CASE WHEN v.fuel_level < ${LOW_FUEL_CRITICAL_PERCENT}
                      THEN 'HIGH' ELSE 'MEDIUM' END,
                 ?,
                 json_object('fuel_level', v.fuel_level),
                 ?
             FROM vehicles v
             WHERE v.fuel_level < ?
               AND (? IS NULL OR v.company_id = ?)
               AND (? IS NULL OR v.id = ?)
               AND NOT EXISTS (
                   SELECT 1 FROM alerts a
                   WHERE a.vehicle_id = v.id
                     AND a.type = 'LOW_FUEL'
                     AND a.ended_at IS NULL
               )`,
        )
        .run(LOW_FUEL_MESSAGE, now, LOW_FUEL_THRESHOLD_PERCENT, ...scopeParams);

    // Status OFFLINE without an open warning: open one.
    database
        .prepare(
            `INSERT INTO alerts (
                 vehicle_id, driver_id, type, severity, message, details, created_at
             )
             SELECT v.id, v.current_driver_id, 'OFFLINE', 'HIGH', ?, NULL, ?
             FROM vehicles v
             WHERE v.status = 'OFFLINE'
               AND (? IS NULL OR v.company_id = ?)
               AND (? IS NULL OR v.id = ?)
               AND NOT EXISTS (
                   SELECT 1 FROM alerts a
                   WHERE a.vehicle_id = v.id
                     AND a.type = 'OFFLINE'
                     AND a.ended_at IS NULL
               )`,
        )
        .run(OFFLINE_MESSAGE, now, ...scopeParams);
}

/**
 * A speeding event that ended and that nobody handled becomes history after
 * `SPEEDING_OPEN_DAYS`: it leaves the open warnings (and the driver's count
 * for the talk) at the moment the period ran out, not at the moment this ran.
 * Open events (still speeding) are never touched.
 */
export function archiveStaleSpeeding(database: DatabaseSync): number[] {
    const due = `
        a.type = 'SPEEDING'
        AND a.resolved_at IS NULL
        AND a.ended_at IS NOT NULL
        AND a.ended_at <= datetime('now', '-${SPEEDING_OPEN_DAYS} days')`;

    const companies = database
        .prepare(
            `SELECT DISTINCT v.company_id AS company_id
             FROM alerts a INNER JOIN vehicles v ON v.id = a.vehicle_id
             WHERE ${due}`,
        )
        .all() as Array<{ company_id: number }>;

    if (companies.length === 0) {
        return [];
    }

    database
        .prepare(
            `UPDATE alerts AS a
             SET resolved_at = datetime(a.ended_at, '+${SPEEDING_OPEN_DAYS} days')
             WHERE ${due}`,
        )
        .run();

    return companies.map((row) => Number(row.company_id));
}
