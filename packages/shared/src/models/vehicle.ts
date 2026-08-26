export const VEHICLE_STATUSES = [
    "IDLE",
    "DRIVING",
    "STOPPED",
    "OFFLINE",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const FUEL_LEVEL_MIN = 0;
export const FUEL_LEVEL_MAX = 100;

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
    recorded_at: string | null;
    activeAlerts: number;
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

interface ValidateOptions {
    /**
     * Für PATCH: nur die tatsächlich übergebenen Felder prüfen.
     * Fehlende Felder gelten dann nicht als Fehler.
     */
    partial?: boolean;
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
    const { partial = false } = options;
    const errors: VehicleFieldErrors = {};

    const isProvided = (key: keyof VehicleInput) =>
        input[key] !== undefined;

    const shouldCheck = (key: keyof VehicleInput) =>
        partial ? isProvided(key) : true;

    if (shouldCheck("license_plate")) {
        const { license_plate } = input;

        if (
            typeof license_plate !== "string" ||
            license_plate.trim() === ""
        ) {
            errors.license_plate =
                "Kennzeichen ist erforderlich.";
        }
    }

    if (shouldCheck("driver_name")) {
        const { driver_name } = input;

        if (
            typeof driver_name !== "string" ||
            driver_name.trim() === ""
        ) {
            errors.driver_name = "Fahrer ist erforderlich.";
        }
    }

    if (shouldCheck("fuel_level")) {
        const { fuel_level } = input;

        if (
            typeof fuel_level !== "number" ||
            Number.isNaN(fuel_level)
        ) {
            errors.fuel_level = "Tankstand muss eine Zahl sein.";
        } else if (
            fuel_level < FUEL_LEVEL_MIN ||
            fuel_level > FUEL_LEVEL_MAX
        ) {
            errors.fuel_level = `Tankstand muss zwischen ${FUEL_LEVEL_MIN} und ${FUEL_LEVEL_MAX} liegen.`;
        }
    }

    if (shouldCheck("status")) {
        if (!isVehicleStatus(input.status)) {
            errors.status = `Status muss einer von ${VEHICLE_STATUSES.join(", ")} sein.`;
        }
    }

    return errors;
}
