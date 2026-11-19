import type { DatabaseSync } from "node:sqlite";
import { RETENTION_FALLBACK } from "@fleet-live/shared";

/** Whether a damage still holds anything about a person or a place. */
export const DAMAGE_HOLDS_DETAILS = `(
    d.latitude IS NOT NULL
    OR d.longitude IS NOT NULL
    OR d.driver_id IS NOT NULL
    OR d.driver_name IS NOT NULL
    OR EXISTS (SELECT 1 FROM damage_photos p WHERE p.damage_id = d.id)
)`;

const DUE_IDS = `
    SELECT d.id
    FROM vehicle_damages d
    INNER JOIN vehicles v ON v.id = d.vehicle_id
    INNER JOIN companies c ON c.id = v.company_id
    WHERE d.state <> 'OPEN'
      AND d.closed_on < date(
          'now',
          '-' || COALESCE(c.damage_retention_days, ${RETENTION_FALLBACK.damages}) || ' days'
      )
      AND ${DAMAGE_HOLDS_DETAILS}
`;

/**
 * A closed damage keeps what happened, its day and how bad it was. Its photos,
 * place and driver go as many days after it was closed as the company set.
 * Open damages keep everything. The row stays, so the vehicle's history and
 * its workshop stay stay whole. Returns the number of damages changed.
 */
export function pruneClosedDamages(database: DatabaseSync): number {
    const ids = database.prepare(DUE_IDS).all() as Array<{ id: number }>;
    const clearPhotos = database.prepare("DELETE FROM damage_photos WHERE damage_id = ?");
    const clearDetails = database.prepare(
        `UPDATE vehicle_damages
         SET latitude = NULL, longitude = NULL, driver_id = NULL, driver_name = NULL
         WHERE id = ?`,
    );

    for (const { id } of ids) {
        clearPhotos.run(id);
        clearDetails.run(id);
    }

    return ids.length;
}
