import { z } from "zod";

import { berlinTodayIso } from "./dueDates";
import { isValidIsoDate } from "./vehicle";

export const DAMAGE_SEVERITIES = ["MINOR", "MEDIUM", "SEVERE"] as const;

export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];

export const DAMAGE_SEVERITY_LABELS: Record<DamageSeverity, string> = {
    MINOR: "leicht",
    MEDIUM: "mittel",
    SEVERE: "schwer",
};

/** Offen → behoben (by a finished workshop stay) or erledigt without one. */
export const DAMAGE_STATES = ["OPEN", "REPAIRED", "CLOSED"] as const;

export type DamageState = (typeof DAMAGE_STATES)[number];

export const DAMAGE_STATE_LABELS: Record<DamageState, string> = {
    OPEN: "Offen",
    REPAIRED: "Behoben",
    CLOSED: "Ohne Werkstatt erledigt",
};

export const DAMAGE_DESCRIPTION_MAX = 300;
/** Damages listed on a vehicle, open ones first. */
export const DAMAGE_LIST_LIMIT = 50;
/** Photos per damage (from the driver's phone, made smaller in the browser). */
export const DAMAGE_PHOTOS_MAX = 3;
/** Bytes per stored photo; the browser sends about 1600 px JPEG, well below. */
export const DAMAGE_PHOTO_MAX_BYTES = 1_500_000;
export const DAMAGE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type DamagePhotoType = (typeof DAMAGE_PHOTO_TYPES)[number];

export type Damage = {
    id: number;
    vehicle_id: number;
    occurred_on: string;
    description: string;
    severity: DamageSeverity;
    drivable: boolean;
    state: DamageState;
    /** The workshop stay that takes care of it, open or finished. */
    workshop_visit_id: number | null;
    /** State of that stay, to say „Termin am …“ / „In der Werkstatt“. */
    workshop_state: "PLANNED" | "IN_WORKSHOP" | "DONE" | "CANCELLED" | null;
    workshop_planned_on: string | null;
    closed_on: string | null;
    reported_by_name: string | null;
    created_at: string;
    /** HH:MM, when known (a breakdown on the road). */
    occurred_time: string | null;
    /** Where it happened; both or neither. */
    latitude: number | null;
    longitude: number | null;
    /** Who drove when it was reported (snapshot, never rewritten). */
    driver_id: number | null;
    driver_name: string | null;
    /** `GET /api/damages/:id/photos/:photoId`, oldest first. */
    photo_ids: number[];
};

export type DamageListResponse = { data: Damage[] };

export type DamageInput = {
    occurred_on: string;
    description: string;
    severity: DamageSeverity;
    drivable: boolean;
    occurred_time?: string | null;
    latitude?: number | null;
    longitude?: number | null;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const placeRefine = (value: { latitude?: number | null; longitude?: number | null }) =>
    (value.latitude === undefined) === (value.longitude === undefined) &&
    (value.latitude === null) === (value.longitude === null);

const PLACE_MESSAGE = "Ort braucht Breite und Länge.";

const fields = (today: string) => ({
    occurred_on: z
        .string({ error: "Datum fehlt." })
        .refine(isValidIsoDate, "Datum ist kein gültiges Datum.")
        .refine((value) => value <= today, "Datum liegt in der Zukunft."),
    description: z
        .string({ error: "Was ist passiert? fehlt." })
        .trim()
        .min(1, "Was ist passiert? fehlt.")
        .max(DAMAGE_DESCRIPTION_MAX, `Höchstens ${DAMAGE_DESCRIPTION_MAX} Zeichen.`),
    severity: z.enum(DAMAGE_SEVERITIES, { error: "Schwere ist ungültig." }),
    drivable: z.boolean({ error: "Fahrbereit fehlt." }),
    occurred_time: z
        .union([z.null(), z.string().regex(TIME_PATTERN, "Uhrzeit als HH:MM, z. B. 08:00.")])
        .optional(),
    latitude: z
        .union([z.null(), z.number().min(-90, "Ort ist ungültig.").max(90, "Ort ist ungültig.")])
        .optional(),
    longitude: z
        .union([z.null(), z.number().min(-180, "Ort ist ungültig.").max(180, "Ort ist ungültig.")])
        .optional(),
});

export function parseDamageInput(input: unknown, today = berlinTodayIso()): DamageInput {
    return z
        .object(fields(today))
        .refine(placeRefine, { message: PLACE_MESSAGE, path: ["latitude"] })
        .parse(input);
}

/** What the photo upload sends as `Content-Type`; anything else is refused. */
export const isDamagePhotoType = (value: string | undefined): value is DamagePhotoType =>
    (DAMAGE_PHOTO_TYPES as readonly string[]).includes(value ?? "");

export function parseDamagePatch(
    input: unknown,
    today = berlinTodayIso(),
): Partial<DamageInput> {
    return z
        .object(fields(today))
        .partial()
        .refine((value) => Object.keys(value).length > 0, {
            message: "Keine Änderung angegeben.",
        })
        .refine(placeRefine, { message: PLACE_MESSAGE, path: ["latitude"] })
        .parse(input);
}
