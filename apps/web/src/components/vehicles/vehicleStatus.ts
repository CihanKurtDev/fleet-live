import type { VehicleStatus } from "@fleet-live/shared";
import { isDarkTheme } from "../../utils/theme";

/**
 * Der Status beschreibt, was das Fahrzeug meldet — er ist keine Eingabe.
 */
const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
    DRIVING: "Auf Fahrt",
    IDLE: "Standby",
    STOPPED: "Feierabend",
    OFFLINE: "Kein Signal",
};

/** Farben für Marker, Spur und Legende — gleiche Semantik wie die Labels. */
const VEHICLE_STATUS_COLORS: Record<VehicleStatus, string> = {
    DRIVING: "#15803d",
    IDLE: "#b45309",
    STOPPED: "#475569",
    OFFLINE: "#b91c1c",
};

/** Dieselben Farben, hell genug für die dunkle Karte. */
const VEHICLE_STATUS_COLORS_DARK: Record<VehicleStatus, string> = {
    DRIVING: "#4ade80",
    IDLE: "#fbbf24",
    STOPPED: "#94a3b8",
    OFFLINE: "#f87171",
};

/** Farbe für die Karte im aktuellen Farbschema (Canvas kennt keine CSS-Variablen). */
export const vehicleStatusColor = (status: VehicleStatus) =>
    isDarkTheme()
        ? VEHICLE_STATUS_COLORS_DARK[status]
        : VEHICLE_STATUS_COLORS[status];

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
