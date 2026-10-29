import { z } from "zod";

import { berlinTodayIso } from "./dueDates";
import { isValidIsoDate } from "./vehicle";

export const WORKSHOP_REASONS = [
    "HU",
    "UVV",
    "MAINTENANCE",
    "DAMAGE",
    "OTHER",
] as const;

export type WorkshopReason = (typeof WORKSHOP_REASONS)[number];

export const WORKSHOP_REASON_LABELS: Record<WorkshopReason, string> = {
    HU: "HU",
    UVV: "UVV",
    MAINTENANCE: "Wartung",
    DAMAGE: "Schaden",
    OTHER: "Sonstiges",
};

/** Geplant → In der Werkstatt → Fertig; a planned stay can be cancelled. */
export const WORKSHOP_STATES = [
    "PLANNED",
    "IN_WORKSHOP",
    "DONE",
    "CANCELLED",
] as const;

export type WorkshopState = (typeof WORKSHOP_STATES)[number];

export const WORKSHOP_STATE_LABELS: Record<WorkshopState, string> = {
    PLANNED: "Geplant",
    IN_WORKSHOP: "In der Werkstatt",
    DONE: "Fertig",
    CANCELLED: "Abgesagt",
};

/**
 * Whether a vehicle can be given to a driver. Not a `status`: the status is
 * what the device reports, this is what the dispatcher decided.
 */
export const VEHICLE_AVAILABILITIES = [
    "READY",
    "WORKSHOP",
    "OUT_OF_SERVICE",
] as const;

export type VehicleAvailability = (typeof VEHICLE_AVAILABILITIES)[number];

export const VEHICLE_AVAILABILITY_LABELS: Record<VehicleAvailability, string> = {
    READY: "Einsatzbereit",
    WORKSHOP: "In der Werkstatt",
    OUT_OF_SERVICE: "Außer Dienst",
};

export const WORKSHOP_EVENT_ACTIONS = [
    "planned",
    "arrived",
    "updated",
    "finished",
    "cancelled",
] as const;

export type WorkshopEventAction = (typeof WORKSHOP_EVENT_ACTIONS)[number];

export const WORKSHOP_PLACE_MAX = 80;
export const WORKSHOP_NOTE_MAX = 500;
/** 1 Mio. € in cents; a stay costs an amount, not a bookkeeping record. */
export const WORKSHOP_COST_MAX_CENTS = 100_000_000;
/** Earlier stays shown on a vehicle. */
export const WORKSHOP_PAST_LIMIT = 20;

/** The open stay of a vehicle, as list rows and the vehicle carry it. */
export type WorkshopSummary = {
    id: number;
    state: WorkshopState;
    reason: WorkshopReason;
    place: string;
    planned_on: string;
    expected_on: string | null;
};

export type WorkshopVisit = WorkshopSummary & {
    vehicle_id: number;
    license_plate: string;
    /** The vehicle's current HU month, shown as „bisher“ when an HU is finished. */
    hu_due_on: string | null;
    assignee_user_id: number | null;
    assignee_name: string | null;
    note: string | null;
    /** Day it got there; the time is in the events. */
    arrived_on: string | null;
    finished_on: string | null;
    cost_cents: number | null;
    result_note: string | null;
    created_at: string;
};

export type WorkshopEvent = {
    id: number;
    action: WorkshopEventAction;
    actor_name: string | null;
    details: {
        planned_on?: string;
        fields?: string[];
        hu_due_on?: string;
        cost_cents?: number | null;
        finished_on?: string;
    } | null;
    created_at: string;
};

export type VehicleWorkshop = {
    open: WorkshopVisit | null;
    /** Changes of the open stay, newest first. */
    events: WorkshopEvent[];
    /** Finished and cancelled stays, newest first, at most `WORKSHOP_PAST_LIMIT`. */
    past: WorkshopVisit[];
};

export type VehicleWorkshopResponse = { data: VehicleWorkshop };

export type WorkshopCreateInput = {
    reason: WorkshopReason;
    place: string;
    planned_on: string;
    expected_on: string | null;
    assignee_user_id: number;
    note: string | null;
    /** The vehicle is already there: the stay starts in `IN_WORKSHOP`. */
    arrived: boolean;
};

export type WorkshopPatch = Partial<
    Omit<WorkshopCreateInput, "arrived">
>;

export type WorkshopFinishInput = {
    finished_on: string;
    cost_cents: number | null;
    result_note: string | null;
    /** Required for an HU: the month on the new sticker. */
    hu_due_on: string | null;
};

const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const dateSchema = (label: string) =>
    z
        .string({ error: `${label} fehlt.` })
        .refine(isValidIsoDate, `${label} ist kein gültiges Datum.`);

const placeSchema = z
    .string({ error: "Werkstatt fehlt." })
    .trim()
    .min(1, "Werkstatt fehlt.")
    .max(WORKSHOP_PLACE_MAX, `Werkstatt darf höchstens ${WORKSHOP_PLACE_MAX} Zeichen haben.`);

const noteSchema = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.union([
        z.null(),
        z
            .string()
            .trim()
            .max(WORKSHOP_NOTE_MAX, `Notiz darf höchstens ${WORKSHOP_NOTE_MAX} Zeichen haben.`),
    ]),
);

const expectedSchema = z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.null(), dateSchema("Fertig erwartet am")]),
);

const reasonSchema = z.enum(WORKSHOP_REASONS, { error: "Grund ist ungültig." });

const assigneeSchema = z
    .number({ error: "Zuständig fehlt." })
    .int("Zuständig ist ungültig.")
    .positive("Zuständig ist ungültig.");

function checkExpected(
    plannedOn: string | undefined,
    expectedOn: string | null | undefined,
    ctx: z.RefinementCtx,
) {
    if (plannedOn && expectedOn && expectedOn < plannedOn) {
        ctx.addIssue({
            code: "custom",
            path: ["expected_on"],
            message: "Fertig erwartet am liegt vor dem Termin.",
        });
    }
}

export function parseWorkshopCreate(
    input: unknown,
    today = berlinTodayIso(),
): WorkshopCreateInput {
    return z
        .object({
            reason: reasonSchema,
            place: placeSchema,
            planned_on: dateSchema("Termin am"),
            expected_on: expectedSchema.optional().default(null),
            assignee_user_id: assigneeSchema,
            note: noteSchema.optional().default(null),
            arrived: z.boolean({ error: "Angabe ungültig." }).optional().default(false),
        })
        .superRefine((value, ctx) => {
            if (value.arrived && value.planned_on > today) {
                ctx.addIssue({
                    code: "custom",
                    path: ["planned_on"],
                    message: "Dort seit liegt in der Zukunft.",
                });
            }
            checkExpected(value.planned_on, value.expected_on, ctx);
        })
        .parse(input) as WorkshopCreateInput;
}

export function parseWorkshopPatch(input: unknown): WorkshopPatch {
    return z
        .object({
            reason: reasonSchema.optional(),
            place: placeSchema.optional(),
            planned_on: dateSchema("Termin am").optional(),
            expected_on: expectedSchema.optional(),
            assignee_user_id: assigneeSchema.optional(),
            note: noteSchema.optional(),
        })
        .refine((value) => Object.keys(value).length > 0, {
            message: "Keine Änderung angegeben.",
        })
        .parse(input) as WorkshopPatch;
}

/** „128,50“, „128.5“ or 128.5 euros → 12850 cents; empty is no amount. */
export function parseEuroCents(value: unknown): number | null | undefined {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const text = typeof value === "number" ? String(value) : String(value).trim();
    const normalized = text.replace(/\s|€/g, "").replace(",", ".");

    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
        return undefined;
    }

    return Math.round(Number(normalized) * 100);
}

export function parseWorkshopFinish(
    input: unknown,
    reason: WorkshopReason,
    arrivedOn: string,
    today = berlinTodayIso(),
): WorkshopFinishInput {
    return z
        .object({
            finished_on: dateSchema("Fertig am"),
            cost: z.unknown().optional(),
            result_note: noteSchema.optional().default(null),
            hu_due_on: z.preprocess(
                (value) => (value === "" ? null : value),
                z
                    .union([
                        z.null(),
                        z.string().regex(YEAR_MONTH_PATTERN, "Neue HU fällig muss MM.JJJJ sein."),
                    ])
                    .optional()
                    .default(null),
            ),
        })
        .superRefine((value, ctx) => {
            if (value.finished_on > today) {
                ctx.addIssue({
                    code: "custom",
                    path: ["finished_on"],
                    message: "Fertig am liegt in der Zukunft.",
                });
            } else if (value.finished_on < arrivedOn) {
                ctx.addIssue({
                    code: "custom",
                    path: ["finished_on"],
                    message: "Fertig am liegt vor der Ankunft in der Werkstatt.",
                });
            }

            const cents = parseEuroCents(value.cost);
            if (cents === undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: ["cost"],
                    message: "Kosten als Betrag in Euro, z. B. 128,50.",
                });
            } else if (cents !== null && cents > WORKSHOP_COST_MAX_CENTS) {
                ctx.addIssue({
                    code: "custom",
                    path: ["cost"],
                    message: "Kosten sind zu hoch.",
                });
            }

            if (reason === "HU" && !value.hu_due_on) {
                ctx.addIssue({
                    code: "custom",
                    path: ["hu_due_on"],
                    message: "Neue HU fällig fehlt.",
                });
            }
        })
        .transform((value) => ({
            finished_on: value.finished_on,
            cost_cents: parseEuroCents(value.cost) ?? null,
            result_note: value.result_note,
            hu_due_on: reason === "HU" ? value.hu_due_on : null,
        }))
        .parse(input);
}

export function parseVehicleAvailabilityPatch(input: unknown): {
    out_of_service: boolean;
} {
    return z
        .object({
            out_of_service: z.boolean({ error: "Angabe ungültig." }),
        })
        .parse(input);
}
