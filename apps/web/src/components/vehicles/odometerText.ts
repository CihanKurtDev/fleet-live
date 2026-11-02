import { ODOMETER_SOURCE_LABELS, type OdometerReading } from "@fleet-live/shared";

/** An odometer reading as the dashboard shows it: „123.456 km“. */
export const formatKm = (km: number) => `${km.toLocaleString("de-DE")} km`;

/** „Korrektur“, or „Eingetragen“ for the first reading someone typed in. */
export const readingSourceLabel = (reading: Pick<OdometerReading, "source" | "previous_km">) =>
    reading.source === "MANUAL" && reading.previous_km === null
        ? "Eingetragen"
        : ODOMETER_SOURCE_LABELS[reading.source];
