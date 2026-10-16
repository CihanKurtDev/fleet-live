import type { SpeedBand, SpeedBandResult } from "@fleet-live/shared";

/**
 * Tempo-Indikator — eigene Palette, nicht die Statusfarben
 * (sonst vermischt sich „Auf Fahrt“-Grün mit Tempo-Grün).
 */
export const SPEED_BAND_COLORS: Record<SpeedBand, string> = {
    normal: "var(--text-h)",
    warning: "var(--speed-warning)",
    critical: "var(--danger)",
};

export const SPEED_BAND_TITLES: Record<SpeedBand, string> = {
    normal: "Tempo im Rahmen",
    warning: "Über dem Simulationslimit (Stadt oder Autobahn). Warnung noch nicht offen.",
    critical: "Tempo-Warnung läuft. Erledigen ändert die Farbe nicht.",
};

export function speedBandTitle(result: SpeedBandResult): string {
    return SPEED_BAND_TITLES[result.band];
}
