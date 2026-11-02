import { z } from "zod";

import { berlinTodayIso } from "./dueDates";
import { ODOMETER_MAX_KM, parseKilometerText } from "./odometer";
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

/** The reasons of a stay in the order of `WORKSHOP_REASONS`, each once. */
export function sortWorkshopReasons(reasons: readonly WorkshopReason[]): WorkshopReason[] {
    return WORKSHOP_REASONS.filter((reason) => reasons.includes(reason));
}

/** The stored JSON list of a stay's reasons, in canonical order. */
export function parseWorkshopReasons(json: string): WorkshopReason[] {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
        ? sortWorkshopReasons(value.filter((item): item is WorkshopReason =>
              (WORKSHOP_REASONS as readonly string[]).includes(String(item)),
          ))
        : [];
}

/** „HU, Schaden“: what a stay is for, as one line. */
export function workshopReasonsText(reasons: readonly WorkshopReason[]): string {
    return sortWorkshopReasons(reasons)
        .map((reason) => WORKSHOP_REASON_LABELS[reason])
        .join(", ");
}

/**
 * How the vehicle gets to the workshop: a driver brings it, it is towed, or
 * the workshop fetches it. A vehicle that cannot be driven is never brought by
 * a driver.
 */
export const WORKSHOP_TRANSPORTS = ["DRIVER", "TOW", "WORKSHOP_PICKUP"] as const;

export type WorkshopTransport = (typeof WORKSHOP_TRANSPORTS)[number];

export const WORKSHOP_TRANSPORT_LABELS: Record<WorkshopTransport, string> = {
    DRIVER: "Fahrer bringt",
    TOW: "Abschleppen",
    WORKSHOP_PICKUP: "Werkstatt holt ab",
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
    "NOT_DRIVABLE",
    "OUT_OF_SERVICE",
] as const;

export type VehicleAvailability = (typeof VEHICLE_AVAILABILITIES)[number];

export const VEHICLE_AVAILABILITY_LABELS: Record<VehicleAvailability, string> = {
    READY: "Einsatzbereit",
    WORKSHOP: "In der Werkstatt",
    NOT_DRIVABLE: "Nicht fahrbereit",
    OUT_OF_SERVICE: "Außer Dienst",
};

export const WORKSHOP_EVENT_ACTIONS = [
    "planned",
    "arrived",
    "updated",
    "finished",
    "cancelled",
    "picked_up",
    "cost_added",
] as const;

export type WorkshopEventAction = (typeof WORKSHOP_EVENT_ACTIONS)[number];

export const WORKSHOP_PLACE_MAX = 80;
export const WORKSHOP_ADDRESS_MAX = 120;
export const WORKSHOP_PHONE_MAX = 40;
/** A workshop yard; big enough for its lot, small enough to leave the next street out. */
export const WORKSHOP_RADIUS_DEFAULT_M = 150;
export const WORKSHOP_RADIUS_MIN_M = 50;
export const WORKSHOP_RADIUS_MAX_M = 1_000;

/**
 * What a workshop stay needs from someone today. Missed: the appointment
 * passed and the vehicle never parked there. Return late: it is still there
 * after „fertig erwartet“. Trip without driver: the appointment is today, the
 * vehicle stands and nobody drives it. Pickup: it is finished and still there
 * without a driver. Unplanned: it parks at a workshop without a stay.
 */
export const WORKSHOP_TASKS = [
    "missed",
    "return_late",
    "trip_no_driver",
    "pickup",
    "unplanned",
] as const;

export type WorkshopTask = (typeof WORKSHOP_TASKS)[number];

export const WORKSHOP_TASK_LABELS: Record<WorkshopTask, string> = {
    missed: "Verpasst",
    return_late: "Rückgabe",
    trip_no_driver: "Hinfahrt",
    pickup: "Abholen",
    unplanned: "Ohne Termin",
};

/** A workshop of the company: a place on the map, like a depot. */
export type WorkshopPlace = {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    latitude: number;
    longitude: number;
    radius_m: number;
    /** Vehicles whose last position is inside the circle. */
    vehicles_here: number;
    /** Those vehicles by plate (at most `WORKSHOP_PLACE_LIST_MAX`). */
    here: WorkshopPlaceVehicle[];
    /** Open stays that name this workshop, the next appointment first. */
    appointments: WorkshopPlaceAppointment[];
};

/** Plates and appointments listed on a workshop card. */
export const WORKSHOP_PLACE_LIST_MAX = 8;

export type WorkshopPlaceVehicle = { vehicle_id: number; license_plate: string };

export type WorkshopPlaceAppointment = {
    visit_id: number;
    vehicle_id: number;
    license_plate: string;
    state: "PLANNED" | "IN_WORKSHOP";
    planned_on: string;
    planned_time: string | null;
    reasons: WorkshopReason[];
};

export type WorkshopPlaceInput = {
    name: string;
    address: string | null;
    phone: string | null;
    latitude: number;
    longitude: number;
    radius_m: number;
};

export type WorkshopPlacePatch = Partial<WorkshopPlaceInput>;

export type WorkshopPlaceListResponse = { data: WorkshopPlace[] };
export const WORKSHOP_NOTE_MAX = 500;
/** 1 Mio. € in cents; a stay costs an amount, not a bookkeeping record. */
export const WORKSHOP_COST_MAX_CENTS = 100_000_000;
/** Earlier stays shown on a vehicle. */
export const WORKSHOP_PAST_LIMIT = 20;

/** The open stay of a vehicle, as list rows and the vehicle carry it. */
export type WorkshopSummary = {
    id: number;
    state: WorkshopState;
    /** What is done there, at least one, in the order of `WORKSHOP_REASONS`. */
    reasons: WorkshopReason[];
    /** The workshop's name, copied at planning; older stays have only this. */
    place: string;
    workshop_id: number | null;
    planned_on: string;
    /** „08:00“; `null` means the whole day. */
    planned_time: string | null;
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
    /** The workshop with its contact, `null` for stays from before workshops were places. */
    workshop: Omit<WorkshopPlace, "vehicles_here" | "here" | "appointments"> | null;
    /** How it gets there; a driver only with `DRIVER`. */
    transport: WorkshopTransport;
    /** Who drives it there. */
    bring_driver_id: number | null;
    bring_driver_name: string | null;
    /** Day it got there. */
    arrived_on: string | null;
    /** Naive UTC time it got there, and how that was known. */
    arrived_at: string | null;
    arrived_by: "POSITION" | "HAND" | null;
    finished_on: string | null;
    /** Naive UTC time it left the workshop after it was finished. */
    picked_up_at: string | null;
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
        /** Kilometerstand laut Rechnung, entered with „Fertig melden“. */
        odometer_km?: number;
        finished_on?: string;
        by?: "position" | "hand";
    } | null;
    created_at: string;
};

export type VehicleWorkshop = {
    open: WorkshopVisit | null;
    /** Changes of the open stay, newest first. */
    events: WorkshopEvent[];
    /** Finished and cancelled stays, newest first, at most `WORKSHOP_PAST_LIMIT`. */
    past: WorkshopVisit[];
    /** The workshop whose circle the vehicle stands in, if any. */
    here: Pick<WorkshopPlace, "id" | "name" | "phone"> | null;
    /** Finished there and still standing there: to be picked up. */
    to_pick_up: WorkshopVisit | null;
};

export type VehicleWorkshopResponse = { data: VehicleWorkshop };

/**
 * A driver who may bring the vehicle to the workshop, with what speaks
 * against it on the appointment day.
 */
export type WorkshopBringer = {
    id: number;
    name: string;
    licence_expires_on: string | null;
    /** Expired licence: cannot be chosen. */
    licence_expired: boolean;
    /** The vehicle's current driver. */
    is_current: boolean;
    /** Another vehicle this driver is driving right now. */
    driving_plate: string | null;
    /** Other vehicles this driver is to bring to a workshop on that day. */
    other_transports: { visit_id: number; license_plate: string; place: string }[];
};

export type WorkshopBringersResponse = { data: WorkshopBringer[] };

export type WorkshopCreateInput = {
    reasons: WorkshopReason[];
    transport: WorkshopTransport;
    workshop_id: number;
    planned_on: string;
    planned_time: string | null;
    expected_on: string;
    bring_driver_id: number | null;
    assignee_user_id: number;
    note: string | null;
    /**
     * The vehicle already parks at that workshop without a stay (seen by its
     * position): the stay starts in `IN_WORKSHOP`. Refused anywhere else.
     */
    arrived: boolean;
    /** Open damages of the vehicle this stay repairs; required for reason DAMAGE. */
    damage_ids: number[];
};

/** `damage_ids` in a patch is the whole set of damages the stay takes. */
export type WorkshopPatch = Partial<Omit<WorkshopCreateInput, "arrived">>;

export type WorkshopFinishInput = {
    finished_on: string;
    cost_cents: number | null;
    result_note: string | null;
    /** Required for an HU: the month on the new sticker. */
    hu_due_on: string | null;
    /** „Kilometerstand laut Rechnung“, optional; only for a GPS box. */
    odometer_km: number | null;
};

const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const dateSchema = (label: string) =>
    z
        .string({ error: `${label} fehlt.` })
        .refine(isValidIsoDate, `${label} ist kein gültiges Datum.`);

const workshopIdSchema = z
    .number({ error: "Werkstatt fehlt." })
    .int("Werkstatt ist ungültig.")
    .positive("Werkstatt ist ungültig.");

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeSchema = z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([z.null(), z.string().regex(TIME_PATTERN, "Uhrzeit als HH:MM, z. B. 08:00.")]),
);

const bringDriverSchema = z.preprocess(
    (value) => (value === "" ? null : value),
    z.union([
        z.null(),
        z.number({ error: "Fahrer ist ungültig." }).int().positive("Fahrer ist ungültig."),
    ]),
);

const optionalText = (max: number, label: string) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.union([
            z.null(),
            z.string().trim().max(max, `${label} darf höchstens ${max} Zeichen haben.`),
        ]),
    );

const workshopPlaceFields = z.object({
    name: z
        .string({ error: "Name fehlt." })
        .trim()
        .min(1, "Name fehlt.")
        .max(WORKSHOP_PLACE_MAX, `Name darf höchstens ${WORKSHOP_PLACE_MAX} Zeichen haben.`),
    address: optionalText(WORKSHOP_ADDRESS_MAX, "Adresse"),
    phone: optionalText(WORKSHOP_PHONE_MAX, "Telefon"),
    latitude: z
        .number({ error: "Ort auf der Karte fehlt." })
        .min(-90, "Ort ist ungültig.")
        .max(90, "Ort ist ungültig."),
    longitude: z
        .number({ error: "Ort auf der Karte fehlt." })
        .min(-180, "Ort ist ungültig.")
        .max(180, "Ort ist ungültig."),
    radius_m: z
        .number({ error: "Kreis ist ungültig." })
        .int("Kreis in ganzen Metern.")
        .min(WORKSHOP_RADIUS_MIN_M, `Kreis mindestens ${WORKSHOP_RADIUS_MIN_M} m.`)
        .max(WORKSHOP_RADIUS_MAX_M, `Kreis höchstens ${WORKSHOP_RADIUS_MAX_M} m.`),
});

export function parseWorkshopPlaceInput(input: unknown): WorkshopPlaceInput {
    return workshopPlaceFields
        .extend({
            address: workshopPlaceFields.shape.address.optional().default(null),
            phone: workshopPlaceFields.shape.phone.optional().default(null),
            radius_m: workshopPlaceFields.shape.radius_m.optional().default(WORKSHOP_RADIUS_DEFAULT_M),
        })
        .parse(input) as WorkshopPlaceInput;
}

export function parseWorkshopPlacePatch(input: unknown): WorkshopPlacePatch {
    return workshopPlaceFields
        .partial()
        .refine((value) => Object.keys(value).length > 0, {
            message: "Keine Änderung angegeben.",
        })
        .parse(input) as WorkshopPlacePatch;
}

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

const expectedSchema = dateSchema("Fertig erwartet");

const reasonsSchema = z
    .array(z.enum(WORKSHOP_REASONS, { error: "Grund ist ungültig." }), {
        error: "Was gemacht wird, fehlt.",
    })
    .min(1, "Was gemacht wird: mindestens einen Punkt ankreuzen.")
    .refine((reasons) => new Set(reasons).size === reasons.length, "Ein Grund doppelt.")
    .transform((reasons) => sortWorkshopReasons(reasons));

const transportSchema = z.enum(WORKSHOP_TRANSPORTS, { error: "Wie es hinkommt, ist ungültig." });

const damageIdsSchema = z
    .array(z.number().int().positive(), { error: "Schäden ungültig." })
    .max(20, "Höchstens 20 Schäden.")
    .refine((ids) => new Set(ids).size === ids.length, "Ein Schaden doppelt.");

/** Only a driver who brings it is kept; towing or a pickup has none. */
function checkTransport(
    value: { transport?: WorkshopTransport; bring_driver_id?: number | null },
    ctx: z.RefinementCtx,
) {
    if (value.transport && value.transport !== "DRIVER" && value.bring_driver_id) {
        ctx.addIssue({
            code: "custom",
            path: ["bring_driver_id"],
            message: `Bei „${WORKSHOP_TRANSPORT_LABELS[value.transport]}“ bringt kein Fahrer das Fahrzeug.`,
        });
    }
}

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
            message: "Fertig erwartet liegt vor dem Termin.",
        });
    }
}

export function parseWorkshopCreate(
    input: unknown,
    today = berlinTodayIso(),
): WorkshopCreateInput {
    return z
        .object({
            reasons: reasonsSchema,
            transport: transportSchema.optional().default("DRIVER"),
            workshop_id: workshopIdSchema,
            planned_on: dateSchema("Termin am"),
            planned_time: timeSchema.optional().default(null),
            expected_on: expectedSchema,
            bring_driver_id: bringDriverSchema.optional().default(null),
            assignee_user_id: assigneeSchema,
            note: noteSchema.optional().default(null),
            arrived: z.boolean({ error: "Angabe ungültig." }).optional().default(false),
            damage_ids: damageIdsSchema.optional().default([]),
        })
        .superRefine((value, ctx) => {
            if (value.arrived && value.planned_on > today) {
                ctx.addIssue({
                    code: "custom",
                    path: ["planned_on"],
                    message: "Dort seit liegt in der Zukunft.",
                });
            }
            if (!value.arrived && value.planned_on < today) {
                ctx.addIssue({
                    code: "custom",
                    path: ["planned_on"],
                    message: "Ein Termin liegt heute oder später.",
                });
            }
            checkDamages(value.reasons, value.damage_ids, ctx);
            checkTransport(value, ctx);
            checkExpected(value.planned_on, value.expected_on, ctx);
        })
        .parse(input) as WorkshopCreateInput;
}

/** A damage among the reasons needs the damages, and damages need that reason. */
function checkDamages(
    reasons: WorkshopReason[] | undefined,
    damageIds: number[] | undefined,
    ctx: z.RefinementCtx,
) {
    if (reasons?.includes("DAMAGE") && damageIds !== undefined && damageIds.length === 0) {
        ctx.addIssue({
            code: "custom",
            path: ["damage_ids"],
            message: "Welcher Schaden? Mindestens einen ankreuzen oder erst melden.",
        });
    }
    if (reasons && !reasons.includes("DAMAGE") && damageIds && damageIds.length > 0) {
        ctx.addIssue({
            code: "custom",
            path: ["reasons"],
            message: "Mit Schäden gehört „Schaden“ zu dem, was gemacht wird.",
        });
    }
}

export function parseWorkshopPatch(input: unknown): WorkshopPatch {
    return z
        .object({
            reasons: reasonsSchema.optional(),
            transport: transportSchema.optional(),
            damage_ids: damageIdsSchema.optional(),
            workshop_id: workshopIdSchema.optional(),
            planned_on: dateSchema("Termin am").optional(),
            planned_time: timeSchema.optional(),
            expected_on: expectedSchema.optional(),
            bring_driver_id: bringDriverSchema.optional(),
            assignee_user_id: assigneeSchema.optional(),
            note: noteSchema.optional(),
        })
        .refine((value) => Object.keys(value).length > 0, {
            message: "Keine Änderung angegeben.",
        })
        .superRefine((value, ctx) => {
            checkDamages(value.reasons, value.damage_ids, ctx);
            checkTransport(value, ctx);
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
    reasons: readonly WorkshopReason[],
    arrivedOn: string,
    today = berlinTodayIso(),
): WorkshopFinishInput {
    return z
        .object({
            finished_on: dateSchema("Fertig am"),
            cost: z.unknown().optional(),
            odometer: z.unknown().optional(),
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

            const km = parseInvoiceKm(value.odometer);
            if (km === "invalid") {
                ctx.addIssue({
                    code: "custom",
                    path: ["odometer"],
                    message: `Kilometerstand in ganzen Kilometern angeben, höchstens ${ODOMETER_MAX_KM.toLocaleString("de-DE")}.`,
                });
            }

            if (reasons.includes("HU") && !value.hu_due_on) {
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
            hu_due_on: reasons.includes("HU") ? value.hu_due_on : null,
            odometer_km: (parseInvoiceKm(value.odometer) as number | null) ?? null,
        }))
        .parse(input);
}

/** The reading from the invoice as text („123.456“) or a number; `"invalid"` otherwise. */
function parseInvoiceKm(value: unknown): number | null | "invalid" {
    const km =
        typeof value === "number"
            ? Number.isInteger(value)
                ? value
                : "invalid"
            : typeof value === "string" || value === null || value === undefined
              ? parseKilometerText(value)
              : "invalid";
    return typeof km === "number" && (km < 0 || km > ODOMETER_MAX_KM) ? "invalid" : km;
}

/** Costs added after the stay, when the invoice comes. */
export function parseWorkshopCostPatch(input: unknown): { cost_cents: number } {
    return z
        .object({ cost: z.unknown() })
        .transform((value, ctx) => {
            const cents = parseEuroCents(value.cost);
            if (cents === undefined || cents === null) {
                ctx.addIssue({
                    code: "custom",
                    path: ["cost"],
                    message: "Kosten als Betrag in Euro, z. B. 128,50.",
                });
                return z.NEVER;
            }
            if (cents > WORKSHOP_COST_MAX_CENTS) {
                ctx.addIssue({ code: "custom", path: ["cost"], message: "Kosten sind zu hoch." });
                return z.NEVER;
            }
            return { cost_cents: cents };
        })
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

/** One hit of the address search for a workshop (`GET /api/workshop/geocode`). */
export type GeocodeHit = { label: string; latitude: number; longitude: number };

export type GeocodeResponse = { data: GeocodeHit[] };

/** Whether the address search is set up, and the data credit it needs. */
export type GeocodeConfigResponse = { data: { enabled: boolean } };

export const GEOCODE_QUERY_MIN = 3;
export const GEOCODE_QUERY_MAX = 200;

export function parseGeocodeQuery(input: unknown): string {
    return z
        .object({
            q: z
                .string({ error: "Adresse fehlt." })
                .trim()
                .min(GEOCODE_QUERY_MIN, `Mindestens ${GEOCODE_QUERY_MIN} Zeichen.`)
                .max(GEOCODE_QUERY_MAX, `Höchstens ${GEOCODE_QUERY_MAX} Zeichen.`),
        })
        .parse(input).q;
}
