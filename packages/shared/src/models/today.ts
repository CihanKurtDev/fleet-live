import type { DueKind } from "./dueDates";
import type { Damage } from "./damage";
import type { WorkshopPlace, WorkshopSummary, WorkshopTask, WorkshopVisit } from "./workshop";

/**
 * Schicht, block „Heute“: everything in use that may not or cannot drive today,
 * and what runs out before the next working day. In use means a vehicle with a
 * current driver and a driver who is current on a vehicle. The order is the
 * product decision, most urgent first.
 */
export const TODAY_KINDS = [
    // Darf oder kann heute nicht fahren
    "licence_driving",
    "deadline_overdue",
    "workshop_due",
    "damage_unplanned",
    "offline",
    // Nicht geprüft, aber im Einsatz
    "check_overdue",
    "date_missing",
    // Läuft vor dem nächsten Werktag ab
    "licence_ending",
    "deadline_ending",
] as const;

export type TodayKind = (typeof TODAY_KINDS)[number];

export const TODAY_SECTIONS = ["blocked", "unchecked", "ending"] as const;

export type TodaySection = (typeof TODAY_SECTIONS)[number];

export const TODAY_SECTION_OF: Record<TodayKind, TodaySection> = {
    licence_driving: "blocked",
    deadline_overdue: "blocked",
    workshop_due: "blocked",
    damage_unplanned: "blocked",
    offline: "blocked",
    check_overdue: "unchecked",
    date_missing: "unchecked",
    licence_ending: "ending",
    deadline_ending: "ending",
};

/** At most this many rows per kind come along; the count is always the full one. */
export const TODAY_GROUP_MAX = 50;

/** An open workshop stay of the vehicle, so a deadline row can say it is booked. */
export type TodayStay = Pick<WorkshopSummary, "id" | "state" | "planned_on" | "planned_time" | "place">;

export type TodayItem = {
    kind: TodayKind;
    /** Unique within one response. */
    key: string;
    vehicle_id: number | null;
    driver_id: number | null;
    /** License plate, or the driver's name. */
    subject: string;
    /** Deadline kind for deadline rows, so the dialog opens the right field. */
    due_kind: DueKind | null;
    /** Deadline date; null when it was never set. */
    due_on: string | null;
    /** Open OFFLINE alert. */
    alert_id: number | null;
    since: string | null;
    /** The stay for `workshop_due` rows: the open one, or the finished one to pick up. */
    workshop: WorkshopVisit | null;
    workshop_task: WorkshopTask | null;
    workshop_place: Pick<WorkshopPlace, "id" | "name" | "phone"> | null;
    /** The damage for `damage_unplanned` rows (the oldest not drivable one). */
    damage: Damage | null;
    /** Driver rows: the vehicle the driver is current on. */
    vehicle_plate: string | null;
    /** The vehicle reports a trip right now. */
    vehicle_driving: boolean | null;
    /** Vehicle rows: the current driver. */
    driver_name: string | null;
    /** Whom to call: the driver, or the vehicle's current driver. */
    phone: string | null;
    /** Vehicle deadline rows: the vehicle's open workshop stay, if any. */
    stay: TodayStay | null;
    /** `licence_driving`: trips and km the driver started after the licence ended. */
    trips_since: number | null;
    km_since: number | null;
    /** Licence rows: a free driver with a valid licence who may drive the vehicle. */
    replacement: { id: number; name: string } | null;
};

export type TodayGroup = {
    kind: TodayKind;
    count: number;
    /** Up to `TODAY_GROUP_MAX` rows, most urgent first. */
    items: TodayItem[];
};

/** A deadline or appointment in the next working days. */
export const WEEK_KINDS = ["licence_expiry", "hu", "uvv", "licence_check", "workshop"] as const;

export type WeekKind = (typeof WEEK_KINDS)[number];

export type WeekItem = {
    key: string;
    kind: WeekKind;
    due_on: string;
    vehicle_id: number | null;
    driver_id: number | null;
    subject: string;
    /** Driver items: the vehicle the driver is current on. */
    vehicle_plate: string | null;
    /** Vehicle items: the current driver. */
    driver_name: string | null;
    vehicle_driving: boolean;
    /** HU/UVV items: the vehicle's open stay. `workshop` items: the stay itself. */
    stay: TodayStay | null;
};

/** Only days that have something; the plan never shows an empty day. */
export type WeekDay = {
    date: string;
    /** Everything due that day; `items` holds up to `TODAY_GROUP_MAX`. */
    count: number;
    items: WeekItem[];
};

/** The plan looks at least this many days ahead, also when the company lead is shorter. */
export const WEEK_MIN_DAYS = 7;

export type TodayCounts = Record<TodayKind, number>;

export type TodayResponse = {
    data: {
        /** Kinds with at least one task, in `TODAY_KINDS` order. */
        groups: TodayGroup[];
        /** What runs out or comes due after `ending_until` up to `week_until`, by day. */
        week: WeekDay[];
    };
    meta: {
        today: string;
        /** Last day of „Läuft vor … ab“: today on Monday to Thursday, Sunday on a Friday. */
        ending_until: string;
        next_workday: string;
        counts: TodayCounts;
        /** Every task of „Heute“ once. */
        total: number;
        /** Last day the plan looks at: `ending_until` plus the company lead (at least `WEEK_MIN_DAYS`). */
        week_until: string;
        /** Every item of the plan once. */
        week_total: number;
        /** Company lead in days, for the tile „In N Tagen“. */
        lead_days: number;
    };
};

const isWeekend = (iso: string) => {
    const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
};

const nextDay = (iso: string) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
};

/** The next Monday to Friday after `iso`. */
export function nextWorkday(iso: string): string {
    let day = nextDay(iso);
    while (isWeekend(day)) {
        day = nextDay(day);
    }
    return day;
}

/** The last day before the next working day: what must be settled today. */
export function endingUntil(today: string): string {
    let last = today;
    while (isWeekend(nextDay(last))) {
        last = nextDay(last);
    }
    return last;
}

