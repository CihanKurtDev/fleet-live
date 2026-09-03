import { z } from "zod";
import { ALERT_TYPES } from "./alert";
import { emptyToUndefined, firstQueryString } from "./queryPreprocess";
import type { VehicleStatus } from "./vehicle";
import { VEHICLE_PAGE_LIMITS } from "./vehicleQuery";

export type DriverIncidentCounts = {
    all: number;
    SPEEDING: number;
    LOW_FUEL: number;
    OFFLINE: number;
};

export type Driver = {
    id: number;
    name: string;
    created_at: string;
    vehicle_count: number;
    /** Kennzeichen, wenn genau ein Fahrzeug freigegeben ist. */
    vehicle_plate: string | null;
    /** Kennzeichen des aktuellen Fahrzeugs. */
    current_vehicle_plate: string | null;
    open_warnings: number;
    counts: DriverIncidentCounts;
};

export type DriverVehicle = {
    id: number;
    license_plate: string;
    status: VehicleStatus;
    active_alerts: number;
    is_current: boolean;
};

export type DriverDetail = Driver & {
    vehicles: DriverVehicle[];
    current_vehicle: DriverVehicle | null;
};

export type DriverListMeta = {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
};

export type DriverListResponse = {
    data: Driver[];
    meta: DriverListMeta;
};

export type DriverDetailResponse = {
    data: DriverDetail;
};

export const DRIVER_SORT_KEYS = [
    "name",
    "vehicle_count",
    "open_warnings",
    "counts",
] as const;

export type DriverSortKey = (typeof DRIVER_SORT_KEYS)[number];

export const driverListQuerySchema = z.object({
    search: z.preprocess(
        firstQueryString,
        z
            .string()
            .trim()
            .max(100, "Suche darf höchstens 100 Zeichen haben.")
            .default(""),
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
    sort: z.preprocess(
        emptyToUndefined,
        z.enum(DRIVER_SORT_KEYS, { error: "Ungültiges Sortierfeld." }).optional(),
    ),
    dir: z.preprocess(
        emptyToUndefined,
        z.enum(["asc", "desc"], { error: "Ungültige Sortierrichtung." }).default("asc"),
    ),
    vehicle_id: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Fahrzeug-ID muss eine Zahl sein." })
            .int("Fahrzeug-ID muss eine ganze Zahl sein.")
            .min(1, "Fahrzeug-ID muss mindestens 1 sein.")
            .optional(),
    ),
});

export type DriverListQuery = z.infer<typeof driverListQuerySchema>;

export function parseDriverListQuery(input: unknown): DriverListQuery {
    return driverListQuerySchema.parse(input);
}

export function serializeDriverListQuery(
    query: DriverListQuery,
): URLSearchParams {
    const params = new URLSearchParams();

    if (query.search) {
        params.set("search", query.search);
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

    if (query.vehicle_id !== undefined) {
        params.set("vehicle_id", String(query.vehicle_id));
    }

    return params;
}

/** Compile-time check that incident counts cover every alert type. */
export const DRIVER_INCIDENT_TYPES = ALERT_TYPES;

export function isDriverSortKey(value: unknown): value is DriverSortKey {
    return (
        typeof value === "string" &&
        (DRIVER_SORT_KEYS as readonly string[]).includes(value)
    );
}

export const driverCreateSchema = z.object({
    name: z
        .string({ error: "Name ist erforderlich." })
        .trim()
        .min(1, "Name ist erforderlich.")
        .max(80, "Name darf höchstens 80 Zeichen haben."),
});

export const driverVehicleAssignSchema = z.object({
    vehicle_id: z.coerce
        .number({ error: "Fahrzeug-ID muss eine Zahl sein." })
        .int("Fahrzeug-ID muss eine ganze Zahl sein.")
        .min(1, "Fahrzeug-ID muss mindestens 1 sein."),
});

export const driverCurrentVehicleSchema = z.object({
    vehicle_id: z
        .union([
            z.null(),
            z.coerce
                .number({ error: "Fahrzeug-ID muss eine Zahl sein." })
                .int("Fahrzeug-ID muss eine ganze Zahl sein.")
                .min(1, "Fahrzeug-ID muss mindestens 1 sein."),
        ]),
});

export type DriverCreateInput = z.infer<typeof driverCreateSchema>;
export type DriverVehicleAssignInput = z.infer<
    typeof driverVehicleAssignSchema
>;
export type DriverCurrentVehicleInput = z.infer<
    typeof driverCurrentVehicleSchema
>;

export function parseDriverCreate(input: unknown): DriverCreateInput {
    return driverCreateSchema.parse(input);
}

export function parseDriverVehicleAssign(
    input: unknown,
): DriverVehicleAssignInput {
    return driverVehicleAssignSchema.parse(input);
}

export function parseDriverCurrentVehicle(
    input: unknown,
): DriverCurrentVehicleInput {
    return driverCurrentVehicleSchema.parse(input);
}
