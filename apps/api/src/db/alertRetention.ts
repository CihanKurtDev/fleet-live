import type { DatabaseSync } from "node:sqlite";
import { ALERT_RETENTION_DAYS } from "@fleet-live/shared";

/** Resolved warnings past their company's retention (`alert_retention_days`, else the default). */
const PRUNABLE_IDS = `
    SELECT a.id
    FROM alerts a
    INNER JOIN vehicles v ON v.id = a.vehicle_id
    INNER JOIN companies c ON c.id = v.company_id
    WHERE a.resolved_at IS NOT NULL
      AND a.resolved_at < datetime(
          'now',
          '-' || COALESCE(c.alert_retention_days, ${ALERT_RETENTION_DAYS}) || ' days'
      )
`;

/**
 * Resolved warnings are kept as many days after they were resolved as the
 * company set (`ALERT_RETENTION_DAYS` without a value). The Schicht charts read whole months from the warnings, so the
 * sums of a month are written to `alert_month_stats` first, from every warning
 * of that month (deleted or not). A month that has its sums is read from there.
 *
 * Open warnings are never deleted. Returns the number of deleted rows.
 */
export function pruneResolvedAlerts(database: DatabaseSync): number {
    const due = database
        .prepare(`SELECT 1 FROM alerts a WHERE a.id IN (${PRUNABLE_IDS}) LIMIT 1`)
        .get();

    if (!due) {
        return 0;
    }

    database.exec("BEGIN IMMEDIATE");

    try {
        database
            .prepare(
                `WITH due AS (
                     SELECT DISTINCT v.company_id AS company_id,
                            strftime('%Y-%m', a.created_at) AS month
                     FROM alerts a
                     INNER JOIN vehicles v ON v.id = a.vehicle_id
                     WHERE a.id IN (${PRUNABLE_IDS})
                 )
                 INSERT OR IGNORE INTO alert_month_stats (
                     company_id, month, speeding_drivers, speeding_events,
                     speeding_high, low_fuel_vehicles, offline_vehicles
                 )
                 SELECT
                     v.company_id,
                     strftime('%Y-%m', a.created_at),
                     COUNT(DISTINCT CASE WHEN a.type = 'SPEEDING' THEN a.driver_id END),
                     COALESCE(SUM(a.type = 'SPEEDING'), 0),
                     COALESCE(SUM(a.type = 'SPEEDING' AND a.severity = 'HIGH'), 0),
                     COUNT(DISTINCT CASE WHEN a.type = 'LOW_FUEL' THEN a.vehicle_id END),
                     COUNT(DISTINCT CASE WHEN a.type = 'OFFLINE' THEN a.vehicle_id END)
                 FROM alerts a
                 INNER JOIN vehicles v ON v.id = a.vehicle_id
                 INNER JOIN due d
                     ON d.company_id = v.company_id
                    AND d.month = strftime('%Y-%m', a.created_at)
                 GROUP BY 1, 2`,
            )
            .run();

        const result = database
            .prepare(
                `DELETE FROM alerts
                 WHERE id IN (${PRUNABLE_IDS})`,
            )
            .run();

        database.exec("COMMIT");

        return Number(result.changes);
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}
