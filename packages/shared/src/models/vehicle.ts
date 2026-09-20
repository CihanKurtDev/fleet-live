import { z } from "zod";
import type { AlertType } from "./alert";

export const VEHICLE_STATUSES = [
    "IDLE",
    "DRIVING",
    "STOPPED",
    "OFFLINE",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_TYPES = [
    "TRUCK",
    "VAN",
    "CAR",
    "TRAILER",
    "OTHER",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
    TRUCK: "LKW",
    VAN: "Transporter",
    CAR: "PKW",
    TRAILER: "Anhänger",
    OTHER: "Sonstiges",
};

const VEHICLE_TYPE_ALIASES: Record<string, VehicleType> = {
    truck: "TRUCK",
    lkw: "TRUCK",
    lastwagen: "TRUCK",
    sattelzug: "TRUCK",
    van: "VAN",
    transporter: "VAN",
    sprinter: "VAN",
    car: "CAR",
    pkw: "CAR",
    trailer: "TRAILER",
    anhaenger: "TRAILER",
    anhänger: "TRAILER",
    other: "OTHER",
    sonstiges: "OTHER",
    sonstige: "OTHER",
};

export const FUEL_LEVEL_MIN = 0;
export const FUEL_LEVEL_MAX = 100;
export const LICENSE_PLATE_MAX = 32;
export const DRIVER_NAME_MAX = 80;
export const VIN_LENGTH = 17;
export const DEPOT_MAX = 80;
export const COST_CENTER_MAX = 32;

const VIN_CHAR_PATTERN = /^[A-HJ-NPR-Z0-9]+$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const GERMAN_DATE_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/**
 * Antwortform von GET /api/vehicles und GET /api/vehicles/:id.
 *
 * Die Telemetriefelder stammen aus dem jeweils letzten Datenpunkt und sind
 * null, solange ein Fahrzeug noch keine Telemetrie gemeldet hat.
 */
export type Vehicle = {
    id: number;
    license_plate: string;
    /** Name des aktuellen Fahrers; `null` bei Poolfahrzeugen. */
    driver_name: string | null;
    fuel_level: number;
    status: VehicleStatus;
    vin: string | null;
    vehicle_type: VehicleType | null;
    hu_due_on: string | null;
    depot: string | null;
    cost_center: string | null;
    latitude: number | null;
    longitude: number | null;
    speed: number | null;
    /**
     * Aktuelles Sim-Streckenlimit (Stadt 50 / Autobahn 120), nicht StVO.
     * `null`, solange noch kein Tick gelaufen ist.
     */
    speed_limit_kmh: number | null;
    recorded_at: string | null;
    active_alerts: number;
    /**
     * Offenes SPEEDING-Ereignis (`ended_at` null). Steuert die rote Tempo-Zelle,
     * unabhängig davon ob der Dispatcher die Inbox-Zeile schon erledigt hat.
     */
    speeding_open: boolean;
    /**
     * Offene Inbox-Typen (`resolved_at` null). Die Tempo-Anzeige kommt zusätzlich
     * aus `speeding_open`, auch wenn die Inbox-Zeile schon erledigt ist.
     */
    open_alert_types: AlertType[];
    created_at: string;
    current_driver_id: number | null;
};

/** Die vom Client beschreibbaren Felder eines Fahrzeugs. */
export type VehicleInput = {
    license_plate: string;
    fuel_level: number;
    status: VehicleStatus;
    vin?: string | null;
    vehicle_type?: VehicleType | null;
    hu_due_on?: string | null;
    depot?: string | null;
    cost_center?: string | null;
};

export type VehicleFieldErrors = Partial<Record<keyof VehicleInput, string>>;

const VEHICLE_INPUT_KEYS = [
    "license_plate",
    "fuel_level",
    "status",
    "vin",
    "vehicle_type",
    "hu_due_on",
    "depot",
    "cost_center",
] as const;

export function isVehicleStatus(
    value: unknown,
): value is VehicleStatus {
    return (
        typeof value === "string" &&
        (VEHICLE_STATUSES as readonly string[]).includes(value)
    );
}

export function isVehicleType(value: unknown): value is VehicleType {
    return (
        typeof value === "string" &&
        (VEHICLE_TYPES as readonly string[]).includes(value)
    );
}

export function isValidIsoDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

export function parseVehicleType(raw: string): VehicleType | null {
    const trimmed = raw.trim();
    if (trimmed === "") {
        return null;
    }

    const upper = trimmed.toUpperCase();
    if (isVehicleType(upper)) {
        return upper;
    }

    const aliasKey = trimmed
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();

    return VEHICLE_TYPE_ALIASES[aliasKey] ?? null;
}

/** ISO `YYYY-MM-DD`, or German `TT.MM.JJJJ`. */
export function parseHuDate(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed === "") {
        return null;
    }

    const iso = ISO_DATE_PATTERN.exec(trimmed);
    if (iso) {
        return isValidIsoDate(trimmed) ? trimmed : null;
    }

    const german = GERMAN_DATE_PATTERN.exec(trimmed);
    if (!german || !german[1] || !german[2] || !german[3]) {
        return null;
    }

    const value = `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`;
    return isValidIsoDate(value) ? value : null;
}

export function normalizeVin(raw: string): string {
    return raw.replace(/[\s-]/g, "").toUpperCase();
}

const licensePlateSchema = z
    .string({ error: "Kennzeichen ist erforderlich." })
    .trim()
    .min(1, "Kennzeichen ist erforderlich.")
    .max(
        LICENSE_PLATE_MAX,
        `Kennzeichen darf höchstens ${LICENSE_PLATE_MAX} Zeichen haben.`,
    );

export const driverNameSchema = z
    .string({ error: "Fahrer ist erforderlich." })
    .trim()
    .min(1, "Fahrer ist erforderlich.")
    .max(
        DRIVER_NAME_MAX,
        `Fahrer darf höchstens ${DRIVER_NAME_MAX} Zeichen haben.`,
    );

const fuelLevelSchema = z
    .number({ error: "Tankstand muss eine Zahl sein." })
    .refine(
        (value) => !Number.isNaN(value),
        "Tankstand muss eine Zahl sein.",
    )
    .min(
        FUEL_LEVEL_MIN,
        `Tankstand muss zwischen ${FUEL_LEVEL_MIN} und ${FUEL_LEVEL_MAX} liegen.`,
    )
    .max(
        FUEL_LEVEL_MAX,
        `Tankstand muss zwischen ${FUEL_LEVEL_MIN} und ${FUEL_LEVEL_MAX} liegen.`,
    );

const statusSchema = z.enum(VEHICLE_STATUSES, {
    error: `Status muss einer von ${VEHICLE_STATUSES.join(", ")} sein.`,
});

const vinSchema = z.union([
    z.null(),
    z
        .string()
        .length(
            VIN_LENGTH,
            `VIN muss ${VIN_LENGTH} Zeichen haben.`,
        )
        .regex(VIN_CHAR_PATTERN, "VIN darf I, O und Q nicht enthalten."),
]);

const vehicleTypeSchema = z.union([
    z.null(),
    z.enum(VEHICLE_TYPES, { error: "Fahrzeugtyp ist ungültig." }),
]);

const huDueOnSchema = z.union([
    z.null(),
    z
        .string()
        .regex(ISO_DATE_PATTERN, "HU-Datum muss JJJJ-MM-TT sein.")
        .refine(isValidIsoDate, "HU-Datum ist ungültig."),
]);

const depotSchema = z.union([
    z.null(),
    z
        .string()
        .min(1, "Standort darf nicht leer sein.")
        .max(
            DEPOT_MAX,
            `Standort darf höchstens ${DEPOT_MAX} Zeichen haben.`,
        ),
]);

const costCenterSchema = z.union([
    z.null(),
    z
        .string()
        .min(1, "Kostenstelle darf nicht leer sein.")
        .max(
            COST_CENTER_MAX,
            `Kostenstelle darf höchstens ${COST_CENTER_MAX} Zeichen haben.`,
        ),
]);

export const vehicleInputSchema = z.object({
    license_plate: licensePlateSchema,
    fuel_level: fuelLevelSchema,
    status: statusSchema,
    vin: vinSchema.optional(),
    vehicle_type: vehicleTypeSchema.optional(),
    hu_due_on: huDueOnSchema.optional(),
    depot: depotSchema.optional(),
    cost_center: costCenterSchema.optional(),
});

interface ValidateOptions {
    /**
     * Für PATCH und POST: nur die tatsächlich übergebenen Felder prüfen.
     * Fehlende Felder gelten dann nicht als Fehler.
     */
    partial?: boolean;
}

function emptyToNull(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

function normalizeVehicleInput(
    input: Partial<VehicleInput>,
): Partial<VehicleInput> {
    const vinRaw = input.vin;
    let vin: string | null | undefined;

    if (vinRaw === undefined) {
        vin = undefined;
    } else if (vinRaw === null) {
        vin = null;
    } else {
        const compact = normalizeVin(vinRaw);
        vin = compact === "" ? null : compact;
    }

    return {
        ...input,
        vin,
        depot: emptyToNull(input.depot),
        cost_center: emptyToNull(input.cost_center),
        hu_due_on: emptyToNull(input.hu_due_on),
        vehicle_type: input.vehicle_type,
    };
}

function fieldErrorsFromZod(error: z.ZodError): VehicleFieldErrors {
    const fields: VehicleFieldErrors = {};
    const allowed = new Set<string>(VEHICLE_INPUT_KEYS);

    for (const issue of error.issues) {
        const key = issue.path[0];

        if (typeof key === "string" && allowed.has(key)) {
            fields[key as keyof VehicleInput] ??= issue.message;
        }
    }

    return fields;
}

/**
 * Prüft die Eingabefelder eines Fahrzeugs.
 *
 * Wird auf beiden Seiten verwendet: die API beantwortet damit ungültige
 * Requests, das Formular zeigt damit Feldfehler an.
 */
export function validateVehicleInput(
    input: Partial<VehicleInput>,
    options: ValidateOptions = {},
): VehicleFieldErrors {
    const schema = options.partial
        ? vehicleInputSchema.partial()
        : vehicleInputSchema;
    const result = schema.safeParse(normalizeVehicleInput(input));

    if (result.success) {
        return {};
    }

    return fieldErrorsFromZod(result.error);
}
