import { z } from "zod";
import type { Vehicle } from "./vehicle";
import { emptyToUndefined, firstQueryString } from "./queryPreprocess";

export const VEHICLE_SORT_KEYS = [
    "license_plate",
    "driver_name",
    "status",
    "fuel_level",
    "speed",
    "active_alerts",
] as const;

export const VEHICLE_FILTERS = [
    "alerts",
    "low_fuel",
    "driving",
    "offline",
] as const;

export const VEHICLE_PAGE_LIMITS = [10, 25, 50, 100] as const;

export type VehicleSortKey = (typeof VEHICLE_SORT_KEYS)[number];
export type VehicleFilterId = (typeof VEHICLE_FILTERS)[number];
export type VehiclePageLimit = (typeof VEHICLE_PAGE_LIMITS)[number];

export const vehicleListQuerySchema = z.object({
    search: z.preprocess(
        firstQueryString,
        z.string().trim().max(100, "Suche darf höchstens 100 Zeichen haben.").default(""),
    ),
    filter: z.preprocess(
        emptyToUndefined,
        z.enum(VEHICLE_FILTERS, { error: "Ungültiger Filter." }).optional(),
    ),
    sort: z.preprocess(
        emptyToUndefined,
        z.enum(VEHICLE_SORT_KEYS, { error: "Ungültiges Sortierfeld." }).optional(),
    ),
    dir: z.preprocess(
        emptyToUndefined,
        z.enum(["asc", "desc"], { error: "Ungültige Sortierrichtung." }).default("asc"),
    ),
    page: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Seite muss eine Zahl sein." })
            .int("Seite muss eine ganze Zahl sein.")
            .min(1, "Seite muss mindestens 1 sein.")
            .default(1),
    ),
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .refine(
                (value) =>
                    (VEHICLE_PAGE_LIMITS as readonly number[]).includes(value),
                { message: "Limit muss 10, 25, 50 oder 100 sein." },
            )
            .default(10),
    ),
});

export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;

export type VehicleListCounts = {
    all: number;
    alerts: number;
    low_fuel: number;
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
