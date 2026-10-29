import { z } from "zod";
import { ALERT_RETENTION_DAYS } from "./alert";

/**
 * How long a company keeps what the app records about its drivers. A works
 * agreement usually sets these; the company enters them, the app deletes.
 * Open warnings and open trips are never deleted; the month sums of the
 * Schicht charts stay (`alert_month_stats`, `trip_month_km`).
 */
export const RETENTION_KINDS = ["trips", "alerts", "audit"] as const;

export type RetentionKind = (typeof RETENTION_KINDS)[number];

export const RETENTION_LIMITS: Record<RetentionKind, { min: number; max: number }> = {
    trips: { min: 7, max: 365 },
    alerts: { min: 30, max: 365 },
    audit: { min: 90, max: 1825 },
};

/** Without a company value: alerts and the log; trips follow the server's `TRIP_RETENTION_DAYS`. */
export const RETENTION_FALLBACK = {
    alerts: ALERT_RETENTION_DAYS,
    audit: 365,
} as const;

export const RETENTION_LABELS: Record<RetentionKind, string> = {
    trips: "Fahrten",
    alerts: "Erledigte Warnungen",
    audit: "Protokoll",
};

/** Stored company values (`null` = default) and the days the app uses. */
export type PrivacySettings = {
    /**
     * Whether viewers see who drove: driver names on Tempo warnings and trips,
     * and the driver pages (each driver's violation history). Dispatchers
     * always do. Who drives which vehicle right now stays visible.
     */
    viewer_driver_names: boolean;
    trips_days: number | null;
    alerts_days: number | null;
    audit_days: number | null;
    /** Days in use; trips 0 means the server keeps them. */
    trips: number;
    alerts: number;
    audit: number;
    /** What an empty field falls back to. */
    defaults: Record<RetentionKind, number>;
};

const days = (kind: RetentionKind) => {
    const { min, max } = RETENTION_LIMITS[kind];

    return z
        .number({ error: "Ganze Zahl in Tagen." })
        .int("Ganze Zahl in Tagen.")
        .min(min, `Mindestens ${min} Tage.`)
        .max(max, `Höchstens ${max} Tage.`);
};

const privacyPatchSchema = z.object({
    viewer_driver_names: z.boolean({ error: "Ja oder nein." }).optional(),
    trips_days: z.union([z.null(), days("trips")]).optional(),
    alerts_days: z.union([z.null(), days("alerts")]).optional(),
    audit_days: z.union([z.null(), days("audit")]).optional(),
});

export type PrivacyPatch = z.infer<typeof privacyPatchSchema>;

export function parsePrivacyPatch(input: unknown): PrivacyPatch {
    return privacyPatchSchema.parse(input);
}
