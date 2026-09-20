import type { VehicleStatus } from "@fleet-live/shared";

/**
 * Der Status beschreibt, was das Fahrzeug meldet — er ist keine Eingabe.
 */
export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
    DRIVING: "Auf Fahrt",
    IDLE: "Standby",
    STOPPED: "Feierabend",
    OFFLINE: "Kein Signal",
};

/** Farben für Marker, Spur und Legende — gleiche Semantik wie die Labels. */
export const VEHICLE_STATUS_COLORS: Record<VehicleStatus, string> = {
    DRIVING: "#15803d",
    IDLE: "#b45309",
    STOPPED: "#475569",
    OFFLINE: "#b91c1c",
};

export const vehicleStatusLabel = (status: VehicleStatus) =>
    VEHICLE_STATUS_LABELS[status];

/** Reihenfolge der Kartenlegende: Bewegung zuerst, dann Ruhe. */
export const MAP_STATUS_LEGEND: VehicleStatus[] = [
    "DRIVING",
    "IDLE",
    "STOPPED",
    "OFFLINE",
];

/** Ein neu angelegtes Fahrzeug hat noch nichts gemeldet. */
export const NEW_VEHICLE_STATUS: VehicleStatus = "OFFLINE";
