import type { VehicleStatus } from "@fleet-live/shared";

/**
 * Live-Felder, die SSE-Overrides auf Listen- und Kartenzeilen schreiben.
 * Schlanker als `Vehicle`; `FleetPosition` teilt die Positionsfelder.
 */
export type OverridableVehicle = {
    id: number;
    status?: VehicleStatus;
    latitude?: number | null;
    longitude?: number | null;
    speed?: number | null;
    recorded_at?: string | null;
    fuel_level?: number;
    speed_limit_kmh?: number | null;
    speeding_open?: boolean;
};
