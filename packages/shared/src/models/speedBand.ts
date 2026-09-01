import type { VehicleStatus } from "./vehicle";

export const SPEED_BANDS = ["normal", "warning", "critical"] as const;
export const SPEED_BAND_REASONS = ["high"] as const;

export type SpeedBand = (typeof SPEED_BANDS)[number];
export type SpeedBandReason = (typeof SPEED_BAND_REASONS)[number];

export type SpeedBandResult = {
    band: SpeedBand;
    reason: SpeedBandReason | null;
};

/**
 * HIGH-Schwere, sobald die Spitze so weit über dem aktuellen Streckenlimit
 * liegt. Die 8 s-Maschine bleibt unverändert; OSM würde später nur
 * `limit_kmh` ersetzen.
 */
export const SPEED_CRITICAL_OVER_LIMIT_KMH = 20;

/** Zusammenhängende Überschreitung, bevor eine `alerts`-Zeile entsteht. */
export const SPEEDING_OPEN_AFTER_MS = 8_000;

/** Unter der Schwelle, bevor `ended_at` gesetzt wird. */
export const SPEEDING_HYSTERESIS_MS = 2_000;

/**
 * Tempo über dem aktuellen Routenlimit (Stadt/Autobahn der Simulation,
 * später OSM). Fahren genau am Limit ist kein Event.
 */
export function isOverSpeedLimit(
    speed: number | null,
    status: VehicleStatus,
    limitKmh: number | null | undefined,
): speed is number {
    return (
        status === "DRIVING" &&
        speed !== null &&
        typeof limitKmh === "number" &&
        speed > limitKmh
    );
}

export function speedBand(input: {
    speed: number | null;
    status: VehicleStatus;
    speeding_open?: boolean;
    limit_kmh?: number | null;
}): SpeedBandResult {
    if (input.status !== "DRIVING" || input.speed === null) {
        return { band: "normal", reason: null };
    }

    if (input.speeding_open) {
        return { band: "critical", reason: "high" };
    }

    if (isOverSpeedLimit(input.speed, input.status, input.limit_kmh)) {
        return { band: "warning", reason: "high" };
    }

    return { band: "normal", reason: null };
}
