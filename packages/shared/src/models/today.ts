import { z } from "zod";

import type { DueKind } from "./dueDates";
import { emptyToUndefined } from "./queryPreprocess";
import type { Damage } from "./damage";
import type { WorkshopPlace, WorkshopTask, WorkshopVisit } from "./workshop";

/**
 * What needs doing today, most urgent kind first. The order is the product
 * decision: a driver with an expired licence at the wheel, workshop stays that
 * need someone (missed first), vehicles that cannot be driven without a date,
 * vehicles without signal, overdue deadlines, deadlines due today, drivers due
 * for a talk, low fuel, deadlines coming up.
 */
export const TODAY_KINDS = [
    "licence_driving",
    "workshop_due",
    "damage_unplanned",
    "offline",
    "deadline_overdue",
    "deadline_today",
    "driver_talk",
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
    /** The stay for `workshop_due` rows: the open one, or the finished one to pick up. */
    workshop: WorkshopVisit | null;
    /** What the `workshop_due` row asks for, and where the vehicle stands for pickup or without a stay. */
    workshop_task: WorkshopTask | null;
    workshop_place: Pick<WorkshopPlace, "id" | "name" | "phone"> | null;
    /** The damage for `damage_unplanned` rows (the oldest not drivable one). */
    damage: Damage | null;
    /** `licence_driving`: the vehicle the driver is on, and whether it drives now. */
    vehicle_plate: string | null;
    vehicle_driving: boolean | null;
    /** Whom to call: the driver (`licence_driving`) or the vehicle's current driver (`offline`). */
    phone: string | null;
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
