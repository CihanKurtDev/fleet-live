import {
    formatAlertEvent,
    isSpeedingAlertDetails,
    type Alert,
    type AlertType,
    type AlertTypeCounts,
} from "@fleet-live/shared";

/** Reihenfolge der Typ-Chips in den Live-Ereignissen. */
export const FLEET_EVENT_TYPES: AlertType[] = ["SPEEDING", "OFFLINE", "LOW_FUEL"];

/** Läuft noch: Tempo über dem Limit oder Funkstille ohne Ende. */
export const isRunningEvent = (alert: Pick<Alert, "type" | "ended_at">) =>
    alert.ended_at === null &&
    (alert.type === "SPEEDING" || alert.type === "OFFLINE");

/**
 * Kurze Ereigniszeile. Eine laufende Überschreitung hat noch keine
 * endgültige Dauer, darum steht dort „läuft“ statt der Zeit.
 */
export const fleetEventDetail = (
    alert: Pick<Alert, "type" | "message" | "details" | "ended_at">,
): string => {
    if (!isRunningEvent(alert)) {
        return formatAlertEvent(alert);
    }

    if (alert.type === "SPEEDING" && isSpeedingAlertDetails(alert.details)) {
        return `${Math.round(alert.details.max_speed_kmh)} km/h bei Limit ${Math.round(alert.details.limit_kmh)} · läuft`;
    }

    return `${formatAlertEvent(alert).replace(/\.$/, "")} · läuft`;
};

/** Nur Typen mit Ereignissen; der gewählte bleibt sichtbar. */
export const visibleEventTypes = (
    counts: AlertTypeCounts | undefined,
    active: AlertType | null,
): AlertType[] =>
    FLEET_EVENT_TYPES.filter(
        (type) => type === active || (counts?.[type] ?? 0) > 0,
    );
