import type { DueCounts } from "./dueDates";

/** Months on the Schicht charts, ending at the current UTC month. */
export const BRIEFING_HISTORY_MONTHS = 9;

export type BriefingHistoryMonth = {
    month: string;
    /** Drivers and vehicles with a trip that month; `null` once those trips are past the retention. */
    active_drivers: number | null;
    active_vehicles: number | null;
    speeding_drivers: number;
    speeding_events: number;
    speeding_high: number;
    low_fuel_vehicles: number;
    offline_vehicles: number;
    /** Closed-trip km for the month; open drives add to the current month only. */
    distance_m: number;
};

export function briefingMonthKeys(
    now = new Date(),
    count = BRIEFING_HISTORY_MONTHS,
): string[] {
    const keys: string[] = [];
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();

    for (let offset = count - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(year, month - offset, 1));
        const stamp = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        keys.push(stamp);
    }

    return keys;
}

export type BriefingCounts = {
    open: number;
    offline: number;
    driving: number;
    idle: number;
    /** Status `STOPPED`, auf den Listen „Feierabend“. */
    stopped: number;
    low_fuel: number;
    /** Letzte Position liegt in einem Depot-Radius der Firma. */
    in_depot: number;
    /** Fahrzeuge mit laufender Tempoüberschreitung (`speeding_open`). */
    speeding: number;
    /** Fahren heute nicht: Werkstatt, nicht fahrbereit, außer Dienst (Filter `unavailable`). */
    unavailable: number;
};

export type BriefingData = {
    counts: BriefingCounts;
    history: BriefingHistoryMonth[];
    /** HU, UVV, Führerschein. Nur Zähler, die Zeilen liegen unter /api/due. */
    due: DueCounts;
    /** Aufgelöster Vorlauf, mit dem `due.soon` gezählt wurde. */
    due_lead_days: number;
};

export type BriefingResponse = {
    data: BriefingData;
};
