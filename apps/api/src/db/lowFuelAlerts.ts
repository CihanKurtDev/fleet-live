import type { DatabaseSync } from "node:sqlite";
import {
    LOW_FUEL_CRITICAL_PERCENT,
    LOW_FUEL_THRESHOLD_PERCENT,
} from "@fleet-live/shared";

export const LOW_FUEL_MESSAGE = "Tankstand ist niedrig.";

export type LowFuelScope = {
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
export function syncLowFuelAlerts(
    database: DatabaseSync,
    scope: LowFuelScope = {},
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
             WHERE type = 'LOW_FUEL'
               AND ended_at IS NULL
               AND resolved_at IS NOT NULL
               AND vehicle_id IN (${IN_SCOPE})`,
        )
        .run(...scopeParams);

    // An ended row nobody closed would sit in the inbox next to a new one.
    database
        .prepare(
            `UPDATE alerts SET resolved_at = ended_at
             WHERE type = 'LOW_FUEL'
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
}
