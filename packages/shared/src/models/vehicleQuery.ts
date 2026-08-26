import { z } from "zod";
import type { Vehicle } from "./vehicle";

export const VEHICLE_SORT_KEYS = [
    "license_plate",
    "driver_name",
    "status",
    "fuel_level",
    "speed",
    "activeAlerts",
] as const;

export const VEHICLE_FILTERS = [
    "alerts",
    "lowFuel",
    "driving",
    "offline",
] as const;

export const VEHICLE_PAGE_LIMITS = [10, 25, 50, 100] as const;

export type VehicleSortKey = (typeof VEHICLE_SORT_KEYS)[number];
export type VehicleFilterId = (typeof VEHICLE_FILTERS)[number];
export type VehiclePageLimit = (typeof VEHICLE_PAGE_LIMITS)[number];

const emptyToUndefined = (value: unknown): unknown => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return emptyToUndefined(value[0]);
    }

    return value;
};

export const vehicleListQuerySchema = z.object({
    search: z.preprocess(
        (value) => (value == null ? "" : Array.isArray(value) ? value[0] : value),
        z.string().trim().max(100).default(""),
    ),
    filter: z.preprocess(
        emptyToUndefined,
        z.enum(VEHICLE_FILTERS).optional(),
    ),
    sort: z.preprocess(
        emptyToUndefined,
        z.enum(VEHICLE_SORT_KEYS).optional(),
    ),
    dir: z.preprocess(
        emptyToUndefined,
        z.enum(["asc", "desc"]).default("asc"),
    ),
    page: z.preprocess(
        emptyToUndefined,
        z.coerce.number().int().min(1).default(1),
    ),
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number()
            .int()
            .refine(
                (value) =>
                    (VEHICLE_PAGE_LIMITS as readonly number[]).includes(value),
                { message: "limit must be 10, 25, 50 or 100" },
            )
            .default(10),
    ),
});

export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;

export type VehicleListCounts = {
    all: number;
    alerts: number;
    lowFuel: number;
    driving: number;
    offline: number;
};

export type VehicleListMeta = {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
    counts: VehicleListCounts;
};

export type VehicleListResponse = {
    data: Vehicle[];
    meta: VehicleListMeta;
};

/** Live-Patch eines Fahrzeugs aus dem Telemetrie-Stream. */
export type TelemetryPatch = {
    id: number;
    speed: number;
    latitude: number;
    longitude: number;
    recorded_at: string;
};

export function parseVehicleListQuery(input: unknown): VehicleListQuery {
    return vehicleListQuerySchema.parse(input);
}

export function serializeVehicleListQuery(
    query: VehicleListQuery,
): URLSearchParams {
    const params = new URLSearchParams();

    if (query.search) {
        params.set("search", query.search);
    }

    if (query.filter) {
        params.set("filter", query.filter);
    }

    if (query.sort) {
        params.set("sort", query.sort);
        params.set("dir", query.dir);
    }

    if (query.page !== 1) {
        params.set("page", String(query.page));
    }

    if (query.limit !== 10) {
        params.set("limit", String(query.limit));
    }

    return params;
}

export function isVehicleSortKey(value: unknown): value is VehicleSortKey {
    return (
        typeof value === "string" &&
        (VEHICLE_SORT_KEYS as readonly string[]).includes(value)
    );
}

export function isVehicleFilterId(value: unknown): value is VehicleFilterId {
    return (
        typeof value === "string" &&
        (VEHICLE_FILTERS as readonly string[]).includes(value)
    );
}
