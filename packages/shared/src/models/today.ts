import { z } from "zod";

import type { DueKind } from "./dueDates";
import { emptyToUndefined } from "./queryPreprocess";

/**
 * What needs doing today, most urgent kind first. The order is the product
 * decision: legal deadlines, a vehicle driving without a driver, drivers due
 * for a talk, vehicles without signal, low fuel, deadlines coming up.
 */
export const TODAY_KINDS = [
    "deadline_overdue",
    "driving_unassigned",
    "driver_talk",
    "offline",
    "low_fuel",
    "deadline_soon",
] as const;

export type TodayKind = (typeof TODAY_KINDS)[number];

export type TodayItem = {
    kind: TodayKind;
    /** Unique within one response. */
    key: string;
    vehicle_id: number | null;
    driver_id: number | null;
    /** License plate, or the driver's name. */
    subject: string;
    /** Deadline kind for deadline rows, so "Eintragen" opens the right field. */
    due_kind: DueKind | null;
    /** Deadline date; null when it was never set (e.g. no licence check yet). */
    due_on: string | null;
    /** Open OFFLINE alert (naive UTC creation time) for "Erledigen". */
    alert_id: number | null;
    since: string | null;
    open_warnings: number | null;
    fuel_level: number | null;
};

export type TodayCounts = Record<TodayKind, number>;

export type TodayResponse = {
    data: TodayItem[];
    meta: {
        counts: TodayCounts;
        /** Sum of all counts: every open task, not only the listed ones. */
        total: number;
        limit: number;
        /** Company lead in days, for the "In N Tagen" label. */
        lead_days: number;
    };
};

export const TODAY_LIMIT_DEFAULT = 12;
export const TODAY_LIMIT_MAX = 50;

const todayQuerySchema = z.object({
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .min(1, `Limit muss zwischen 1 und ${TODAY_LIMIT_MAX} liegen.`)
            .max(
                TODAY_LIMIT_MAX,
                `Limit muss zwischen 1 und ${TODAY_LIMIT_MAX} liegen.`,
            )
            .default(TODAY_LIMIT_DEFAULT),
    ),
});

export type TodayQuery = z.infer<typeof todayQuerySchema>;

export function parseTodayQuery(input: unknown): TodayQuery {
    return todayQuerySchema.parse(input ?? {});
}
