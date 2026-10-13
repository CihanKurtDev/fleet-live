import {
    VEHICLE_STATUSES,
    type GeoBBox,
    type VehicleStatus,
} from "@fleet-live/shared";

import { isInsideBBox } from "./clusterFleet";

export type StatusTotals = Record<
    VehicleStatus,
    { inView: number; fleet: number }
>;

type Positioned = {
    status: VehicleStatus;
    has_position: boolean;
    latitude: number | null;
    longitude: number | null;
};

export function emptyStatusTotals(): StatusTotals {
    return {
        IDLE: { inView: 0, fleet: 0 },
        DRIVING: { inView: 0, fleet: 0 },
        STOPPED: { inView: 0, fleet: 0 },
        OFFLINE: { inView: 0, fleet: 0 },
    };
}

export function sumStatus(
    totals: StatusTotals,
    field: "inView" | "fleet",
): number {
    return VEHICLE_STATUSES.reduce(
        (sum, status) => sum + totals[status][field],
        0,
    );
}

/** Zählt nur Fahrzeuge mit Position. `bbox` null zählt den ganzen Bestand als Ausschnitt. */
export function countFleetStatus(
    vehicles: readonly Positioned[],
    bbox: GeoBBox | null,
): StatusTotals {
    const totals = emptyStatusTotals();

    for (const vehicle of vehicles) {
        if (
            !vehicle.has_position ||
            vehicle.latitude === null ||
            vehicle.longitude === null
        ) {
            continue;
        }

        const bucket = totals[vehicle.status];
        bucket.fleet += 1;

        if (
            bbox === null ||
            isInsideBBox(vehicle.latitude, vehicle.longitude, bbox)
        ) {
            bucket.inView += 1;
        }
    }

    return totals;
}

export function bboxesOverlap(left: GeoBBox, right: GeoBBox): boolean {
    return (
        left.west <= right.east &&
        left.east >= right.west &&
        left.south <= right.north &&
        left.north >= right.south
    );
}

/**
 * Dichtezellen haben keine Fahrzeugzeilen. Y ist die Summe der Zellen,
 * X die Summe der Zellen, die den Ausschnitt schneiden. Eine Zelle am Rand
 * zählt vollständig, weil die Schnittstelle sie nicht teilt.
 */
export function countDensityStatus(
    cells: readonly {
        bbox: GeoBBox;
        counts: Record<VehicleStatus, number>;
    }[],
    bbox: GeoBBox | null,
): StatusTotals {
    const totals = emptyStatusTotals();

    for (const cell of cells) {
        const inView = bbox === null || bboxesOverlap(cell.bbox, bbox);

        for (const status of VEHICLE_STATUSES) {
            const count = cell.counts[status] ?? 0;
            totals[status].fleet += count;

            if (inView) {
                totals[status].inView += count;
            }
        }
    }

    return totals;
}

export function filterByStatus<T extends { status: VehicleStatus }>(
    rows: readonly T[],
    status: VehicleStatus | null,
): T[] {
    if (status === null) {
        return rows as T[];
    }

    return rows.filter((row) => row.status === status);
}

export function plateHits<
    T extends {
        license_plate: string;
        has_position: boolean;
        driver_name?: string | null;
    },
>(rows: readonly T[], query: string, limit = 8): T[] {
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
        return [];
    }

    return rows
        .filter(
            (row) =>
                row.license_plate.toLowerCase().includes(needle) ||
                (row.driver_name ?? "").toLowerCase().includes(needle),
        )
        .sort(
            (left, right) =>
                Number(right.has_position) - Number(left.has_position) ||
                left.license_plate.localeCompare(right.license_plate, "de"),
        )
        .slice(0, limit);
}

/** Hinweis, wenn die Karte nichts zeichnet. `inViewCount` null heißt: Ausschnitt noch unbekannt. */
export function fleetEmptyMessage(input: {
    mode: "positions" | "density";
    rowCount: number;
    positionedCount: number;
    inViewCount: number | null;
    hasNarrowingFilter: boolean;
}): string | null {
    if (input.mode === "density") {
        if (input.rowCount > 0) {
            return null;
        }

        return input.hasNarrowingFilter
            ? "Keine Fahrzeuge für diesen Filter."
            : "Keine Fahrzeuge.";
    }

    if (input.rowCount === 0) {
        return input.hasNarrowingFilter
            ? "Keine Fahrzeuge für diesen Filter."
            : "Keine Fahrzeuge.";
    }

    if (input.positionedCount === 0) {
        return "Kein Fahrzeug hat eine Position.";
    }

    if (input.inViewCount === 0) {
        return "In diesem Ausschnitt ist kein Fahrzeug.";
    }

    return null;
}

export function fleetBounds(
    points: readonly {
        latitude: number | null;
        longitude: number | null;
    }[],
): GeoBBox | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    let any = false;

    for (const point of points) {
        if (point.latitude === null || point.longitude === null) {
            continue;
        }

        any = true;
        west = Math.min(west, point.longitude);
        east = Math.max(east, point.longitude);
        south = Math.min(south, point.latitude);
        north = Math.max(north, point.latitude);
    }

    if (!any) {
        return null;
    }

    return { west, south, east, north };
}

export function unionBBoxes(boxes: readonly GeoBBox[]): GeoBBox | null {
    if (boxes.length === 0) {
        return null;
    }

    return boxes.reduce(
        (bounds, box) => ({
            west: Math.min(bounds.west, box.west),
            south: Math.min(bounds.south, box.south),
            east: Math.max(bounds.east, box.east),
            north: Math.max(bounds.north, box.north),
        }),
        { ...boxes[0] },
    );
}
