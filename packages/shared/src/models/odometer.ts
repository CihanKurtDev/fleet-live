import { z } from "zod";

/** Highest reading the app accepts; a car odometer has seven digits at most. */
export const ODOMETER_MAX_KM = 2_000_000;
export const ODOMETER_NOTE_MAX = 200;
/** Readings shown in the history, newest first. */
export const ODOMETER_HISTORY_LIMIT = 20;

/** Where a reading came from: entered at create, by the import, or corrected by hand. */
export const ODOMETER_SOURCES = ["CREATE", "IMPORT", "MANUAL"] as const;

export type OdometerSource = (typeof ODOMETER_SOURCES)[number];

export const ODOMETER_SOURCE_LABELS: Record<OdometerSource, string> = {
    CREATE: "Beim Anlegen",
    IMPORT: "Import",
    MANUAL: "Korrektur",
};

export type OdometerReading = {
    id: number;
    km: number;
    /** The reading it replaced; `null` when the vehicle had none. */
    previous_km: number | null;
    source: OdometerSource;
    note: string | null;
    actor_name: string | null;
    created_at: string;
};

export type VehicleOdometer = {
    /** Current reading in whole km; `null` while nobody entered one. */
    km: number | null;
    readings: OdometerReading[];
};

export type OdometerCorrectionInput = { km: number; note: string | null };

export const odometerKmSchema = z
    .number({ error: "Kilometerstand muss eine Zahl sein." })
    .int("Kilometerstand in ganzen Kilometern angeben.")
    .min(0, "Kilometerstand darf nicht negativ sein.")
    .max(ODOMETER_MAX_KM, `Kilometerstand darf höchstens ${ODOMETER_MAX_KM.toLocaleString("de-DE")} km sein.`);

/**
 * Reads a kilometre figure as people write it: `123456`, `123.456` or
 * `123 456` (thousands groups), or a decimal from a spreadsheet cell
 * (`45210,7`, `45210.75`), which is cut to whole km like an odometer shows it.
 * A single dot followed by exactly three digits is a thousands group.
 * `null` for an empty text, `"invalid"` for anything else.
 */
export function parseKilometerText(raw: string | null | undefined): number | null | "invalid" {
    const text = (raw ?? "").trim();

    if (text === "") {
        return null;
    }

    if (/^\d{1,3}([. ]\d{3})+$/.test(text) || /^\d+$/.test(text)) {
        return Number(text.replace(/[. ]/g, ""));
    }

    if (/^\d+[.,]\d+$/.test(text)) {
        return Math.floor(Number(text.replace(",", ".")));
    }

    return "invalid";
}

export function parseOdometerCorrection(input: unknown): OdometerCorrectionInput {
    return z
        .object({
            km: odometerKmSchema,
            note: z
                .string({ error: "Grund ist ungültig." })
                .trim()
                .max(ODOMETER_NOTE_MAX, `Höchstens ${ODOMETER_NOTE_MAX} Zeichen.`)
                .nullish()
                .transform((value) => (value ? value : null)),
        })
        .parse(input);
}
