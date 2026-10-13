import { z } from "zod";
import { berlinTodayIso } from "./dueDates";

/**
 * Ein Satz für die ganze Simulation, Liter je 100 km.
 * Der Tankzeiger (`fuel_level`) bewegt sich davon nicht.
 */
export const FUEL_LITERS_PER_100KM = 25;

export function fuelLitersFromMeters(meters: number): number {
    if (!(meters > 0)) {
        return 0;
    }

    return (meters / 1000) * (FUEL_LITERS_PER_100KM / 100);
}

const periodMonthSchema = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat muss JJJJ-MM sein.");

/** Leer heißt der laufende Monat in Europe/Berlin. */
export function parsePeriodMonth(
    raw: unknown,
    today = berlinTodayIso(),
): string {
    if (raw === undefined || raw === "") {
        return today.slice(0, 7);
    }

    return periodMonthSchema.parse(raw);
}
