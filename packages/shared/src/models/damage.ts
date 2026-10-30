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
};

export type DamageListResponse = { data: Damage[] };

export type DamageInput = {
    occurred_on: string;
    description: string;
    severity: DamageSeverity;
    drivable: boolean;
};

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
});

export function parseDamageInput(input: unknown, today = berlinTodayIso()): DamageInput {
    return z.object(fields(today)).parse(input);
}

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
        .parse(input);
}
