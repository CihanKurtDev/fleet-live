import {
    RETENTION_FALLBACK,
    type PrivacyPatch,
    type PrivacySettings,
} from "@fleet-live/shared";
import { config } from "../config";
import { stmt } from "../db/statements";

type RetentionRow = {
    viewer_driver_names: number;
    trip_retention_days: number | null;
    alert_retention_days: number | null;
    audit_retention_days: number | null;
};

const COLUMN = {
    trips_days: "trip_retention_days",
    alerts_days: "alert_retention_days",
    audit_days: "audit_retention_days",
} as const;

export const PrivacyModel = {
    get(companyId: number): PrivacySettings {
        const row = stmt(
            "SELECT viewer_driver_names, trip_retention_days, alert_retention_days, audit_retention_days FROM companies WHERE id = ?",
        ).get(companyId) as RetentionRow | undefined;
        const defaults = {
            trips: config.tripRetentionDays,
            alerts: RETENTION_FALLBACK.alerts,
            audit: RETENTION_FALLBACK.audit,
        };

        return {
            viewer_driver_names: row?.viewer_driver_names !== 0,
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
    update(companyId: number, patch: PrivacyPatch) {
        if (patch.viewer_driver_names !== undefined) {
            stmt("UPDATE companies SET viewer_driver_names = ? WHERE id = ?").run(
                patch.viewer_driver_names ? 1 : 0,
                companyId,
            );
        }

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

    /** Whether a person with this role sees driver names in this company. */
    seesDriverNames(companyId: number, role: "dispatcher" | "viewer"): boolean {
        if (role === "dispatcher") {
            return true;
        }

        const row = stmt("SELECT viewer_driver_names FROM companies WHERE id = ?").get(
            companyId,
        ) as { viewer_driver_names: number } | undefined;

        return row?.viewer_driver_names !== 0;
    },

    /** Days closed trips of this company are kept; 0 keeps them. */
    tripDays(companyId: number): number {
        const row = stmt("SELECT trip_retention_days FROM companies WHERE id = ?").get(
            companyId,
        ) as { trip_retention_days: number | null } | undefined;

        return row?.trip_retention_days ?? config.tripRetentionDays;
    },
};
