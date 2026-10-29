import {
    RETENTION_FALLBACK,
    type RetentionPatch,
    type RetentionSettings,
} from "@fleet-live/shared";
import { config } from "../config";
import { stmt } from "../db/statements";

type RetentionRow = {
    trip_retention_days: number | null;
    alert_retention_days: number | null;
    audit_retention_days: number | null;
};

const COLUMN = {
    trips_days: "trip_retention_days",
    alerts_days: "alert_retention_days",
    audit_days: "audit_retention_days",
} as const;

export const RetentionModel = {
    get(companyId: number): RetentionSettings {
        const row = stmt(
            "SELECT trip_retention_days, alert_retention_days, audit_retention_days FROM companies WHERE id = ?",
        ).get(companyId) as RetentionRow | undefined;
        const defaults = {
            trips: config.tripRetentionDays,
            alerts: RETENTION_FALLBACK.alerts,
            audit: RETENTION_FALLBACK.audit,
        };

        return {
            trips_days: row?.trip_retention_days ?? null,
            alerts_days: row?.alert_retention_days ?? null,
            audit_days: row?.audit_retention_days ?? null,
            trips: row?.trip_retention_days ?? defaults.trips,
            alerts: row?.alert_retention_days ?? defaults.alerts,
            audit: row?.audit_retention_days ?? defaults.audit,
            defaults,
        };
    },

    /** Writes the fields that are present; `null` goes back to the default. */
    update(companyId: number, patch: RetentionPatch) {
        for (const key of Object.keys(COLUMN) as (keyof typeof COLUMN)[]) {
            const value = patch[key];

            if (value !== undefined) {
                stmt(`UPDATE companies SET ${COLUMN[key]} = ? WHERE id = ?`).run(
                    value,
                    companyId,
                );
            }
        }
    },

    /** Days closed trips of this company are kept; 0 keeps them. */
    tripDays(companyId: number): number {
        const row = stmt("SELECT trip_retention_days FROM companies WHERE id = ?").get(
            companyId,
        ) as { trip_retention_days: number | null } | undefined;

        return row?.trip_retention_days ?? config.tripRetentionDays;
    },
};
