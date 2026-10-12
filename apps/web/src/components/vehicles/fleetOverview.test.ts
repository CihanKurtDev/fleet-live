import { describe, expect, it } from "vitest";
import type { GeoBBox, VehicleStatus } from "@fleet-live/shared";

import {
    countDensityStatus,
    countFleetStatus,
    filterByStatus,
    fleetBounds,
    fleetEmptyMessage,
    plateHits,
    sumStatus,
} from "./fleetOverview";

const view: GeoBBox = { west: 6, south: 50, east: 9, north: 52 };

function row(
    status: VehicleStatus,
    latitude: number | null,
    longitude: number | null,
    plate = "B-FL 1",
    driver: string | null = null,
) {
    return {
        status,
        has_position: latitude !== null && longitude !== null,
        latitude,
        longitude,
        license_plate: plate,
        driver_name: driver,
    };
}

describe("fleetOverview", () => {
    const rows = [
        row("DRIVING", 51, 7, "B-FL 1", "Hasan Yilmaz"),
        row("DRIVING", 48, 11, "M-TR 2"),
        row("IDLE", 51.1, 7.1, "K-AA 3"),
        row("STOPPED", 50, 8, "K-BB 4"),
        row("OFFLINE", null, null, "HH-X 5"),
        row("OFFLINE", 52, 13, "HH-Y 6"),
    ];

    it("sums the four statuses to the vehicles that have a position", () => {
        const totals = countFleetStatus(rows, view);

        expect(sumStatus(totals, "fleet")).toBe(5);
        expect(totals.DRIVING.fleet).toBe(2);
        expect(totals.IDLE.fleet).toBe(1);
        expect(totals.STOPPED.fleet).toBe(1);
        expect(totals.OFFLINE.fleet).toBe(1);
        expect(sumStatus(totals, "inView")).toBe(3);
        expect(totals.DRIVING.inView).toBe(1);
        expect(totals.OFFLINE.inView).toBe(0);
    });

    it("keeps the other status totals when one status is filtered", () => {
        const all = countFleetStatus(rows, null);
        const driving = filterByStatus(rows, "DRIVING");

        expect(sumStatus(all, "fleet")).toBe(5);
        expect(driving).toHaveLength(2);
        expect(sumStatus(countFleetStatus(driving, null), "fleet")).toBe(2);
        expect(sumStatus(countFleetStatus(rows, null), "fleet")).toBe(5);
    });

    it("counts a density cell outside the view only in the fleet total", () => {
        const totals = countDensityStatus(
            [
                {
                    bbox: { west: 6.5, south: 50.5, east: 7, north: 51 },
                    counts: {
                        IDLE: 1,
                        DRIVING: 4,
                        STOPPED: 0,
                        OFFLINE: 2,
                    },
                },
                {
                    bbox: { west: 11, south: 48, east: 12, north: 49 },
                    counts: {
                        IDLE: 0,
                        DRIVING: 10,
                        STOPPED: 3,
                        OFFLINE: 0,
                    },
                },
            ],
            view,
        );

        expect(sumStatus(totals, "fleet")).toBe(20);
        expect(sumStatus(totals, "inView")).toBe(7);
        expect(totals.DRIVING.fleet).toBe(14);
        expect(totals.DRIVING.inView).toBe(4);
    });

    it("finds plates without dropping the rest of the fleet from the source", () => {
        const hits = plateHits(rows, "k-", 8);

        expect(hits.map((hit) => hit.license_plate)).toEqual([
            "K-AA 3",
            "K-BB 4",
        ]);
        expect(rows).toHaveLength(6);
        expect(fleetBounds(hits)).toEqual({
            west: 7.1,
            south: 50,
            east: 8,
            north: 51.1,
        });
        expect(plateHits(rows, "hasan").map((hit) => hit.license_plate)).toEqual([
            "B-FL 1",
        ]);
        expect(rows).toHaveLength(6);
    });

    it("names why the map has nothing to draw", () => {
        expect(
            fleetEmptyMessage({
                mode: "positions",
                rowCount: 0,
                positionedCount: 0,
                inViewCount: 0,
                hasNarrowingFilter: false,
            }),
        ).toBe("Keine Fahrzeuge.");
        expect(
            fleetEmptyMessage({
                mode: "positions",
                rowCount: 0,
                positionedCount: 0,
                inViewCount: 0,
                hasNarrowingFilter: true,
            }),
        ).toBe("Keine Fahrzeuge für diesen Filter.");
        expect(
            fleetEmptyMessage({
                mode: "positions",
                rowCount: 3,
                positionedCount: 0,
                inViewCount: 0,
                hasNarrowingFilter: false,
            }),
        ).toBe("Kein Fahrzeug hat eine Position.");
        expect(
            fleetEmptyMessage({
                mode: "positions",
                rowCount: 4,
                positionedCount: 4,
                inViewCount: 0,
                hasNarrowingFilter: false,
            }),
        ).toBe("In diesem Ausschnitt ist kein Fahrzeug.");
        expect(
            fleetEmptyMessage({
                mode: "positions",
                rowCount: 4,
                positionedCount: 4,
                inViewCount: null,
                hasNarrowingFilter: false,
            }),
        ).toBeNull();
        expect(
            fleetEmptyMessage({
                mode: "density",
                rowCount: 2,
                positionedCount: 2,
                inViewCount: 0,
                hasNarrowingFilter: false,
            }),
        ).toBeNull();
    });
});
