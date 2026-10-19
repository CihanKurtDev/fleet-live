import type { GeoBBox, VehicleStatus } from "@fleet-live/shared";
import { describe, expect, it } from "vitest";

import {
    CLUSTER_INDEX_DEBOUNCE_MS,
    FLEET_CLUSTER_MAX_ZOOM,
    boundsSpanMeters,
    clusterIndexDelay,
    clusterMemberIds,
    clusterOpen,
    clustersFromIndex,
    createFleetClusterIndex,
    isInsideBBox,
} from "../components/vehicles/clusterFleet";
import {
    countDensityStatus,
    countFleetStatus,
    filterByStatus,
    fleetBounds,
    fleetEmptyMessage,
    plateHits,
    sumStatus,
    unionBBoxes,
} from "../components/vehicles/fleetOverview";

const COLOGNE: GeoBBox = { west: 6.8, south: 50.8, east: 7.1, north: 51.1 };

const vehicle = (
    id: number,
    status: VehicleStatus,
    latitude: number | null = 50.94,
    longitude: number | null = 6.96,
    extra: { license_plate?: string; driver_name?: string | null } = {},
) => ({
    id,
    status,
    has_position: latitude !== null && longitude !== null,
    latitude,
    longitude,
    license_plate: extra.license_plate ?? `K-AB ${id}`,
    driver_name: extra.driver_name ?? null,
});

describe("bounding boxes", () => {
    it("knows what lies inside, edges included", () => {
        expect(isInsideBBox(50.94, 6.96, COLOGNE)).toBe(true);
        expect(isInsideBBox(50.8, 6.8, COLOGNE)).toBe(true);
        expect(isInsideBBox(52.5, 13.4, COLOGNE)).toBe(false);
    });

    it("measures the diagonal in metres, a point as 0", () => {
        expect(boundsSpanMeters({ west: 6.9, south: 50.9, east: 6.9, north: 50.9 })).toBe(0);
        const span = boundsSpanMeters(COLOGNE);
        expect(span).toBeGreaterThan(39_000);
        expect(span).toBeLessThan(40_000);
    });

    it("frames the fleet from the vehicles that have a position", () => {
        expect(fleetBounds([])).toBeNull();
        expect(fleetBounds([{ latitude: null, longitude: null }])).toBeNull();
        expect(
            fleetBounds([
                { latitude: 50.9, longitude: 6.9 },
                { latitude: 51.5, longitude: 7.2 },
                { latitude: null, longitude: null },
            ]),
        ).toEqual({ west: 6.9, south: 50.9, east: 7.2, north: 51.5 });
    });

    it("unions boxes", () => {
        expect(unionBBoxes([])).toBeNull();
        expect(
            unionBBoxes([
                { west: 1, south: 2, east: 3, north: 4 },
                { west: 0, south: 3, east: 5, north: 3.5 },
            ]),
        ).toEqual({ west: 0, south: 2, east: 5, north: 4 });
    });
});

describe("status counts", () => {
    const fleet = [
        vehicle(1, "DRIVING"),
        vehicle(2, "DRIVING", 52.5, 13.4),
        vehicle(3, "IDLE"),
        vehicle(4, "OFFLINE", null, null),
    ];

    it("counts only vehicles with a position, in view and in the fleet", () => {
        const totals = countFleetStatus(fleet, COLOGNE);

        expect(totals.DRIVING).toEqual({ inView: 1, fleet: 2 });
        expect(totals.IDLE).toEqual({ inView: 1, fleet: 1 });
        expect(totals.OFFLINE).toEqual({ inView: 0, fleet: 0 });
        expect(sumStatus(totals, "fleet")).toBe(3);
    });

    it("counts the whole fleet as in view while the view is unknown", () => {
        expect(sumStatus(countFleetStatus(fleet, null), "inView")).toBe(3);
    });

    it("sums density cells, a cell at the edge counts completely", () => {
        const counts = (n: number): Record<VehicleStatus, number> => ({
            DRIVING: n,
            IDLE: 0,
            STOPPED: 0,
            OFFLINE: 0,
        });
        const totals = countDensityStatus(
            [
                { bbox: { west: 6.9, south: 50.9, east: 7.0, north: 51.0 }, counts: counts(10) },
                { bbox: { west: 13.3, south: 52.4, east: 13.5, north: 52.6 }, counts: counts(5) },
                { bbox: { west: 7.05, south: 51.05, east: 7.3, north: 51.3 }, counts: counts(2) },
            ],
            COLOGNE,
        );

        expect(totals.DRIVING).toEqual({ inView: 12, fleet: 17 });
    });

    it("filters by status, and not at all without one", () => {
        expect(filterByStatus(fleet, null)).toHaveLength(4);
        expect(filterByStatus(fleet, "DRIVING").map((row) => row.id)).toEqual([1, 2]);
    });
});

describe("search hits", () => {
    const rows = [
        vehicle(1, "IDLE", null, null, { license_plate: "B-AA 1" }),
        vehicle(2, "IDLE", 50.9, 6.9, { license_plate: "B-AB 2", driver_name: "Lisa Müller" }),
        vehicle(3, "IDLE", 50.9, 6.9, { license_plate: "K-AA 3" }),
    ];

    it("finds by plate or driver, rows with a position first", () => {
        expect(plateHits(rows, "b-a").map((row) => row.id)).toEqual([2, 1]);
        expect(plateHits(rows, "müller").map((row) => row.id)).toEqual([2]);
    });

    it("finds nothing for an empty query and respects the limit", () => {
        expect(plateHits(rows, "  ")).toEqual([]);
        expect(plateHits(rows, "a", 2)).toHaveLength(2);
    });
});

describe("empty map message", () => {
    const base = {
        mode: "positions" as const,
        rowCount: 3,
        positionedCount: 3,
        inViewCount: 3,
        hasNarrowingFilter: false,
    };

    it("is silent while the map has something to draw", () => {
        expect(fleetEmptyMessage(base)).toBeNull();
        expect(fleetEmptyMessage({ ...base, inViewCount: null })).toBeNull();
    });

    it("says why there is nothing", () => {
        expect(fleetEmptyMessage({ ...base, rowCount: 0 })).toBe("Keine Fahrzeuge.");
        expect(fleetEmptyMessage({ ...base, rowCount: 0, hasNarrowingFilter: true })).toBe(
            "Keine Fahrzeuge für diesen Filter.",
        );
        expect(fleetEmptyMessage({ ...base, positionedCount: 0 })).toBe(
            "Kein Fahrzeug hat eine Position.",
        );
        expect(fleetEmptyMessage({ ...base, inViewCount: 0 })).toBe(
            "In diesem Ausschnitt ist kein Fahrzeug.",
        );
        expect(fleetEmptyMessage({ ...base, mode: "density", rowCount: 0 })).toBe(
            "Keine Fahrzeuge.",
        );
        expect(fleetEmptyMessage({ ...base, mode: "density", rowCount: 12 })).toBeNull();
    });
});

describe("clusters", () => {
    it("rebuilds at once when the vehicle set changed, and waits when only positions moved", () => {
        expect(clusterIndexDelay([1, 2, 3], [1, 2, 3])).toBe(CLUSTER_INDEX_DEBOUNCE_MS);
        expect(clusterIndexDelay([1, 2, 3], [1, 2])).toBe(0);
        expect(clusterIndexDelay([1, 2, 3], [1, 2, 4])).toBe(0);
    });

    it("opens a group as close as its members fit, but not past the last cluster zoom", () => {
        const wide = { west: 6, south: 50, east: 8, north: 52 };

        expect(clusterOpen({ expansionZoom: 8, fitZoom: 9.7, bounds: wide })).toEqual({
            zoom: 9,
            list: false,
        });
        expect(clusterOpen({ expansionZoom: 12, fitZoom: 3, bounds: wide }).zoom).toBe(12);
        const capped = clusterOpen({ expansionZoom: 20, fitZoom: 18, bounds: wide });
        expect(capped.zoom).toBe(FLEET_CLUSTER_MAX_ZOOM + 1);
        expect(capped.list).toBe(true);
    });

    it("lists the vehicles of a group that sit on one spot", () => {
        const spot = { west: 6.96, south: 50.94, east: 6.96, north: 50.94 };

        expect(clusterOpen({ expansionZoom: 5, bounds: spot }).list).toBe(true);
    });

    it("groups close vehicles, keeps far ones apart and reports the members and status counts", () => {
        const index = createFleetClusterIndex([
            { id: 1, status: "DRIVING", latitude: 50.94, longitude: 6.96 },
            { id: 2, status: "OFFLINE", latitude: 50.9401, longitude: 6.9601 },
            { id: 3, status: "IDLE", latitude: 52.52, longitude: 13.4 },
        ]);
        const world: GeoBBox = { west: -180, south: -85, east: 180, north: 85 };

        const clusters = clustersFromIndex(index, world, 4);
        const group = clusters.find((cluster) => cluster.kind === "cluster");
        const single = clusters.find((cluster) => cluster.kind === "vehicle");

        expect(clusters).toHaveLength(2);
        expect(group).toMatchObject({ count: 2, anchor: 1 });
        expect(group && "counts" in group ? group.counts : null).toMatchObject({
            DRIVING: 1,
            OFFLINE: 1,
            IDLE: 0,
        });
        expect(single).toMatchObject({ id: 3 });
        expect(clusterMemberIds(index, (group as { id: number }).id).sort()).toEqual([1, 2]);

        // From the last cluster zoom on, every vehicle is its own dot.
        expect(
            clustersFromIndex(index, world, FLEET_CLUSTER_MAX_ZOOM + 1).every(
                (cluster) => cluster.kind === "vehicle",
            ),
        ).toBe(true);
    });
});
