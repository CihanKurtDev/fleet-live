import { z } from "zod";
import type { AlertType } from "./alert";

export const VEHICLE_STATUSES = [
    "IDLE",
    "DRIVING",
    "STOPPED",
    "OFFLINE",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const FUEL_LEVEL_MIN = 0;
export const FUEL_LEVEL_MAX = 100;
export const LICENSE_PLATE_MAX = 32;
export const DRIVER_NAME_MAX = 80;

/**
 * Antwortform von GET /api/vehicles und GET /api/vehicles/:id.
 *
 * Die Telemetriefelder stammen aus dem jeweils letzten Datenpunkt und sind
 * null, solange ein Fahrzeug noch keine Telemetrie gemeldet hat.
 */
export type Vehicle = {
    id: number;
    license_plate: string;
    driver_name: string;
    fuel_level: number;
    status: VehicleStatus;
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
    driver_id: number;
};

/** Die vom Client beschreibbaren Felder eines Fahrzeugs. */
export type VehicleInput = {
    license_plate: string;
    driver_name: string;
    fuel_level: number;
    status: VehicleStatus;
};

export type VehicleFieldErrors = Partial<
    Record<keyof VehicleInput, string>
>;

export function isVehicleStatus(
    value: unknown,
): value is VehicleStatus {
    return (
        typeof value === "string" &&
        (VEHICLE_STATUSES as readonly string[]).includes(value)
    );
}

const licensePlateSchema = z
    .string({ error: "Kennzeichen ist erforderlich." })
    .trim()
    .min(1, "Kennzeichen ist erforderlich.")
    .max(
        LICENSE_PLATE_MAX,
        `Kennzeichen darf höchstens ${LICENSE_PLATE_MAX} Zeichen haben.`,
    );

const driverNameSchema = z
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

export const vehicleInputSchema = z.object({
    license_plate: licensePlateSchema,
    driver_name: driverNameSchema,
    fuel_level: fuelLevelSchema,
    status: statusSchema,
});

interface ValidateOptions {
    /**
     * Für PATCH und POST: nur die tatsächlich übergebenen Felder prüfen.
     * Fehlende Felder gelten dann nicht als Fehler.
     */
    partial?: boolean;
}

function fieldErrorsFromZod(error: z.ZodError): VehicleFieldErrors {
    const fields: VehicleFieldErrors = {};

    for (const issue of error.issues) {
        const key = issue.path[0];

        if (
            key === "license_plate" ||
            key === "driver_name" ||
            key === "fuel_level" ||
            key === "status"
        ) {
            fields[key] ??= issue.message;
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
    const result = schema.safeParse(input);

    if (result.success) {
        return {};
    }

    return fieldErrorsFromZod(result.error);
}
