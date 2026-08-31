import { z } from "zod";
import { DRIVER_NAME_MAX } from "./vehicle";
import type { VehicleStatus } from "./vehicle";
import { VEHICLE_FILTERS, type VehicleFilterId } from "./vehicleQuery";
import { emptyToUndefined, firstQueryString } from "./queryPreprocess";

/** Hartes Limit, damit ein Welt-Ausschnitt bei großem Seed nicht 50 000 Marker liefert. */
export const FLEET_POSITIONS_MAX = 2_000;

/** Maximale Anzahl per Query ausgewählter Fahrer. */
export const FLEET_DRIVERS_MAX = 50;

export type GeoBBox = {
    west: number;
    south: number;
    east: number;
    north: number;
};

/**
 * Letzte bekannte Position für die Flottenkarte.
 * Schlanker als `Vehicle`: ohne Stammdaten, ohne `active_alerts`.
 */
export type FleetPosition = {
    id: number;
    license_plate: string;
    driver_name: string;
    status: VehicleStatus;
    latitude: number;
    longitude: number;
    speed: number;
    recorded_at: string;
};

export type FleetPositionsQuery = {
    bbox?: GeoBBox;
    filter?: VehicleFilterId;
    search?: string;
    /** Leer/fehlt = alle Fahrer. Sonst nur Fahrzeuge dieser Namen. */
    drivers?: string[];
};

/** Seitengröße der Fahrersuche — nicht die Trefferanzahl. */
export const FLEET_DRIVERS_LIST_LIMIT = 50;

export type FleetDriver = {
    name: string;
    license_plate: string;
};

export type FleetDriversQuery = {
    search?: string;
    /**
     * Hydration bereits gewählter Fahrer. Eigenes Query-Feld neben
     * Positions-`drivers`, weil Suche/`page` hier ignoriert werden.
     */
    names?: string[];
    page?: number;
};

export type FleetDriversResponse = {
    data: FleetDriver[];
    meta: {
        /** Bei Suche: passende Fahrer. Sonst: Größe der Flotte. */
        total: number;
        page: number;
        limit: number;
        pageCount: number;
    };
};

export type FleetPositionsResponse = {
    data: FleetPosition[];
    meta: {
        /** `true`, wenn mehr Treffer als `FLEET_POSITIONS_MAX` liegen. Dann ist `data` leer — kein Sample. */
        truncated: boolean;
    };
};

const toDriverList = (value: unknown): unknown => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    const raw = Array.isArray(value)
        ? value
        : typeof value === "object"
          ? Object.values(value)
          : [value];
    const names = raw
        .flatMap((entry) => String(entry).split(","))
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    return names.length > 0 ? names : undefined;
};

const driverNamesSchema = z
    .array(
        z
            .string()
            .min(1, "Fahrername fehlt.")
            .max(
                DRIVER_NAME_MAX,
                `Fahrername darf höchstens ${DRIVER_NAME_MAX} Zeichen haben.`,
            ),
    )
    .max(
        FLEET_DRIVERS_MAX,
        `Höchstens ${FLEET_DRIVERS_MAX} Fahrer.`,
    );

const bboxSchema = z
    .string({ error: "bbox muss west,south,east,north sein." })
    .transform((value, ctx): GeoBBox => {
        const parts = value.split(",").map((part) => part.trim());

        if (parts.length !== 4) {
            ctx.addIssue({
                code: "custom",
                message: "bbox muss west,south,east,north sein.",
            });
            return z.NEVER;
        }

        const [west, south, east, north] = parts.map(Number);

        if (
            [west, south, east, north].some(
                (value) => !Number.isFinite(value),
            )
        ) {
            ctx.addIssue({
                code: "custom",
                message: "bbox muss vier Zahlen sein.",
            });
            return z.NEVER;
        }

        if (
            west < -180 ||
            east > 180 ||
            south < -90 ||
            north > 90
        ) {
            ctx.addIssue({
                code: "custom",
                message: "bbox liegt außerhalb des gültigen Bereichs.",
            });
            return z.NEVER;
        }

        if (west >= east || south >= north) {
            ctx.addIssue({
                code: "custom",
                message: "bbox ist ungültig.",
            });
            return z.NEVER;
        }

        return { west, south, east, north };
    });

export const fleetPositionsQuerySchema = z.object({
    bbox: z.preprocess(emptyToUndefined, bboxSchema.optional()),
    filter: z.preprocess(
        emptyToUndefined,
        z
            .enum(VEHICLE_FILTERS, { error: "Ungültiger Filter." })
            .optional(),
    ),
    search: z.preprocess(
        firstQueryString,
        z
            .string()
            .trim()
            .max(100, "Suche darf höchstens 100 Zeichen haben.")
            .default(""),
    ),
    drivers: z.preprocess(
        toDriverList,
        driverNamesSchema.optional(),
    ),
});

export function parseFleetPositionsQuery(
    input: unknown,
): FleetPositionsQuery {
    return fleetPositionsQuerySchema.parse(input);
}

export function serializeFleetPositionsQuery(
    query: FleetPositionsQuery,
): URLSearchParams {
    const params = new URLSearchParams();

    if (query.bbox) {
        const { west, south, east, north } = query.bbox;
        params.set("bbox", `${west},${south},${east},${north}`);
    }

    if (query.filter) {
        params.set("filter", query.filter);
    }

    if (query.search) {
        params.set("search", query.search);
    }

    for (const name of query.drivers ?? []) {
        params.append("drivers", name);
    }

    return params;
}

export const fleetDriversQuerySchema = z.object({
    search: z.preprocess(
        firstQueryString,
        z
            .string()
            .trim()
            .max(100, "Suche darf höchstens 100 Zeichen haben.")
            .default(""),
    ),
    names: z.preprocess(
        toDriverList,
        driverNamesSchema.optional(),
    ),
    page: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Seite muss eine Zahl sein." })
            .int("Seite muss eine ganze Zahl sein.")
            .min(1, "Seite muss mindestens 1 sein.")
            .default(1),
    ),
});

export function parseFleetDriversQuery(input: unknown): FleetDriversQuery {
    return fleetDriversQuerySchema.parse(input);
}

export function serializeFleetDriversQuery(
    query: FleetDriversQuery,
): URLSearchParams {
    const params = new URLSearchParams();

    if (query.search) {
        params.set("search", query.search);
    }

    if (query.page && query.page !== 1) {
        params.set("page", String(query.page));
    }

    for (const name of query.names ?? []) {
        params.append("names", name);
    }

    return params;
}
