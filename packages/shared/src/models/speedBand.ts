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
 * Demo-Schwellen für den Live-Indikator und SPEEDING-Events — nicht gesetzlich
 * und nicht die Sim-Kinematik (50/120). OSM-Limits würden später nur die
 * Konstanten ersetzen, nicht die Zustandsmaschine.
 */
export const SPEED_HIGH_WARNING_KMH = 90;
export const SPEED_HIGH_CRITICAL_KMH = 110;

/** Zusammenhängende Überschreitung, bevor eine `alerts`-Zeile entsteht. */
export const SPEEDING_OPEN_AFTER_MS = 8_000;

/** Unter der Schwelle, bevor `ended_at` gesetzt wird. */
export const SPEEDING_HYSTERESIS_MS = 2_000;

export function speedBand(input: {
    speed: number | null;
    status: VehicleStatus;
    speeding_open?: boolean;
}): SpeedBandResult {
    if (input.status !== "DRIVING" || input.speed === null) {
        return { band: "normal", reason: null };
    }

    if (input.speeding_open) {
        return { band: "critical", reason: "high" };
    }

    if (input.speed >= SPEED_HIGH_WARNING_KMH) {
        return { band: "warning", reason: "high" };
    }

    return { band: "normal", reason: null };
}
