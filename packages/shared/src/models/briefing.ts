/** Months on the Schicht charts, ending at the current UTC month. */
export const BRIEFING_HISTORY_MONTHS = 9;

export type BriefingHistoryMonth = {
    month: string;
    active_drivers: number;
    active_vehicles: number;
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
    low_fuel: number;
};

export type BriefingData = {
    counts: BriefingCounts;
    history: BriefingHistoryMonth[];
};

export type BriefingResponse = {
    data: BriefingData;
};
