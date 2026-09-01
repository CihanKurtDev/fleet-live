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
    /** Kennzeichen, wenn genau ein Fahrzeug zugewiesen ist. */
    vehicle_plate: string | null;
    open_warnings: number;
    counts: DriverIncidentCounts;
};

export type DriverVehicle = {
    id: number;
    license_plate: string;
    status: VehicleStatus;
    active_alerts: number;
};

export type DriverDetail = Driver & {
    vehicles: DriverVehicle[];
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

    if (query.page !== 1) {
        params.set("page", String(query.page));
    }

    if (query.limit !== 10) {
        params.set("limit", String(query.limit));
    }

    return params;
}

/** Compile-time check that incident counts cover every alert type. */
export const DRIVER_INCIDENT_TYPES = ALERT_TYPES;
