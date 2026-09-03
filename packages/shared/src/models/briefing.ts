import type { Alert } from "./alert";

/** Newest open inbox rows on the Schicht page — enough to fill the left column. */
export const BRIEFING_OPEN_ALERT_LIMIT = 25;

/** Offline vehicles in the Kein-Signal list. */
export const BRIEFING_OFFLINE_LIMIT = 15;

/** Drivers with the most open warnings. */
export const BRIEFING_DRIVER_LIMIT = 12;

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

export type BriefingOfflineVehicle = {
    id: number;
    license_plate: string;
    driver_id: number | null;
    driver_name: string | null;
    recorded_at: string | null;
};

export type BriefingDriver = {
    id: number;
    name: string;
    open_warnings: number;
};

export type BriefingData = {
    counts: BriefingCounts;
    history: BriefingHistoryMonth[];
    open_alerts: Alert[];
    offline_vehicles: BriefingOfflineVehicle[];
    drivers: BriefingDriver[];
};

export type BriefingResponse = {
    data: BriefingData;
};
