import type { SpeedBand, SpeedBandResult } from "@fleet-live/shared";

/**
 * Tempo-Indikator — eigene Palette, nicht die Statusfarben
 * (sonst vermischt sich „Auf Fahrt“-Grün mit Tempo-Grün).
 */
export const SPEED_BAND_COLORS: Record<SpeedBand, string> = {
    normal: "#ffffff",
    warning: "#ea580c",
    critical: "#dc2626",
};

export const SPEED_BAND_TITLES: Record<SpeedBand, string> = {
    normal: "Tempo im Rahmen",
    warning: "Tempo über Schwelle",
    critical: "Geschwindigkeitsereignis",
};

export function speedBandTitle(result: SpeedBandResult): string {
    return SPEED_BAND_TITLES[result.band];
}
