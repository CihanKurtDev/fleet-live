import type { DatabaseSync } from "node:sqlite";
import { RETENTION_FALLBACK } from "@fleet-live/shared";

/**
 * The company log is kept as long as the company set (`audit_retention_days`,
 * else `RETENTION_FALLBACK.audit`). Runs at start and with the warning
 * clean-up. Returns the number of deleted rows.
 */
export function pruneAuditEvents(database: DatabaseSync): number {
    // schema.sql creates the table; a bare database in a migration test has none.
    const table = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'")
        .get();

    if (!table) {
        return 0;
    }

    const result = database
        .prepare(
            `DELETE FROM audit_events
             WHERE id IN (
                 SELECT e.id
                 FROM audit_events e
                 INNER JOIN companies c ON c.id = e.company_id
                 WHERE e.created_at < datetime(
                     'now',
                     '-' || COALESCE(c.audit_retention_days, ${RETENTION_FALLBACK.audit}) || ' days'
                 )
             )`,
        )
        .run();

    return Number(result.changes);
}
