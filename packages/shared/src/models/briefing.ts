import type { Alert } from "./alert";

/** Newest open inbox rows on the Schicht page. */
export const BRIEFING_OPEN_ALERT_LIMIT = 6;

/** Offline vehicles in the Kein-Signal list. */
export const BRIEFING_OFFLINE_LIMIT = 8;

/** Drivers with the most open warnings. */
export const BRIEFING_DRIVER_LIMIT = 5;

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
    driver_id: number;
    driver_name: string;
    recorded_at: string | null;
};

export type BriefingDriver = {
    id: number;
    name: string;
    open_warnings: number;
};

export type BriefingData = {
    counts: BriefingCounts;
    open_alerts: Alert[];
    offline_vehicles: BriefingOfflineVehicle[];
    drivers: BriefingDriver[];
};

export type BriefingResponse = {
    data: BriefingData;
};
