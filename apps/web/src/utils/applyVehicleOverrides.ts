import type { Vehicle } from "@fleet-live/shared";
import type { OverridableVehicle } from "../types/liveVehicle";

const OVERRIDE_KEYS = [
    "status",
    "latitude",
    "longitude",
    "speed",
    "recorded_at",
    "fuel_level",
    "speed_limit_kmh",
    "speeding_open",
] as const satisfies readonly (keyof OverridableVehicle)[];

export const applyVehicleOverrides = <T extends { id: number }>(
    rows: T[],
    overrides: Record<number, Partial<Vehicle>>,
): T[] => {
    if (Object.keys(overrides).length === 0) {
        return rows;
    }

    return rows.map((row) => {
        const patch = overrides[row.id];

        if (!patch) {
            return row;
        }

        let next: T | null = null;

        for (const key of OVERRIDE_KEYS) {
            if (!(key in row)) {
                continue;
            }

            const value = patch[key];

            if (value === undefined) {
                continue;
            }

            if (next === null) {
                next = { ...row };
            }

            (next as Record<string, unknown>)[key] = value;
        }

        return next ?? row;
    });
};
