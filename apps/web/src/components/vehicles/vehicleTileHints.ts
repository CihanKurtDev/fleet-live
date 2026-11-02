import { LOW_FUEL_THRESHOLD_PERCENT } from "@fleet-live/shared";

/**
 * What a vehicle tile counts, as its hint line: the same words on Fahrzeuge,
 * Karte, Schicht and Warnungen, so a tile reads the same wherever it is.
 */
export const VEHICLE_TILE_HINTS = {
    all: "im Bestand",
    /** Auf Fahrt, Standby, Feierabend, Kein Signal: what the vehicle reports. */
    status: "laut Fahrzeug",
    in_workshop: "in der Werkstatt",
    /** Werkstatt, nicht fahrbereit oder außer Dienst. */
    unavailable: "fahren heute nicht",
    speeding: "fahren zu schnell",
    alerts: "mit offener Warnung",
    low_fuel: `unter ${LOW_FUEL_THRESHOLD_PERCENT} % Tank`,
    in_depot: "stehen im Depot",
} as const;
