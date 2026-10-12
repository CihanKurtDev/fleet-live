import type { VehicleStatus } from "@fleet-live/shared";
import { config } from "../config";
import { offsetAroundMeters } from "./geo";

/** Hof-Versatz, damit Marker nicht übereinander liegen. */
export const START_OFFSET_MIN_M = 50;
export const START_OFFSET_MAX_M = 300;

/** Sim-Untergrenze, damit eine neue Fahrt nicht mit Tempo 0 losfährt. */
export const DRIVING_START_SPEED_KMH = 30;

export type DepotAnchor = {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
};

export type StartPlacement = {
    latitude: number;
    longitude: number;
    /** Depotname oder `Fallback` für die Dry-Run-Zählung. */
    label: string;
};

/** Trim, zusammengezogene Leerzeichen, ohne Groß-/Kleinschreibung. */
export function normalizeDepotKey(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function speedForStatus(status: VehicleStatus): number {
    return status === "DRIVING" ? DRIVING_START_SPEED_KMH : 0;
}

function placeAround(
    latitude: number,
    longitude: number,
    label: string,
): StartPlacement {
    const shifted = offsetAroundMeters(
        { lat: latitude, lng: longitude },
        START_OFFSET_MIN_M,
        START_OFFSET_MAX_M,
    );

    return {
        latitude: shifted.lat,
        longitude: shifted.lng,
        label,
    };
}

/**
 * Datei-Koordinaten ohne Versatz, sonst Depot, sonst Standarddepot,
 * sonst die konfigurierte Fallback-Koordinate mit Versatz.
 */
export function resolveStartPosition(input: {
    latitude?: number | null;
    longitude?: number | null;
    depot?: DepotAnchor | null;
    defaultDepot?: DepotAnchor | null;
}): StartPlacement {
    if (
        input.latitude !== null &&
        input.latitude !== undefined &&
        input.longitude !== null &&
        input.longitude !== undefined
    ) {
        return {
            latitude: input.latitude,
            longitude: input.longitude,
            label: "Datei",
        };
    }

    if (input.depot) {
        return placeAround(
            input.depot.latitude,
            input.depot.longitude,
            input.depot.name,
        );
    }

    if (input.defaultDepot) {
        return placeAround(
            input.defaultDepot.latitude,
            input.defaultDepot.longitude,
            input.defaultDepot.name,
        );
    }

    return placeAround(
        config.importFallbackLatitude,
        config.importFallbackLongitude,
        "Fallback",
    );
}
