import { describe, expect, it } from "vitest";
import type { GeoBBox, VehicleStatus } from "@fleet-live/shared";
import {
    CLUSTER_INDEX_DEBOUNCE_MS,
    FLEET_CLUSTER_MAX_ZOOM,
    boundsSpanMeters,
    clusterIndexDelay,
    clusterMemberIds,
    clusterOpen,
    clustersFromIndex,
    createFleetClusterIndex,
    type ClusterPoint,
    type FleetCluster,
} from "./clusterFleet";

const germany: GeoBBox = { west: 5, south: 47, east: 15, north: 55 };

function at(
    id: number,
    latitude: number,
    longitude: number,
    status: VehicleStatus = "DRIVING",
): ClusterPoint {
    return { id, latitude, longitude, status };
}

function countOf(clusters: FleetCluster[]): number {
    return clusters.reduce(
        (sum, cluster) =>
            sum + (cluster.kind === "cluster" ? cluster.count : 1),
        0,
    );
}

describe("clusterFleet", () => {
    const piled = [
        at(1, 50.94, 6.96, "DRIVING"),
        at(2, 50.94, 6.96, "DRIVING"),
        at(3, 50.94, 6.96, "IDLE"),
        at(4, 50.94, 6.96, "OFFLINE"),
    ];
    const cologneBox: GeoBBox = {
        west: 6.5,
        south: 50.5,
        east: 7.5,
        north: 51.5,
    };

    it("counts a pile, keeps status totals, and lists it instead of zooming", () => {
        const index = createFleetClusterIndex(piled);
        const low = clustersFromIndex(index, cologneBox, 4);
        const cluster = low[0];

        expect(low).toHaveLength(1);
        expect(cluster).toMatchObject({
            kind: "cluster",
            count: 4,
            counts: { DRIVING: 2, IDLE: 1, STOPPED: 0, OFFLINE: 1 },
        });
        expect(cluster?.kind === "cluster" && boundsSpanMeters(cluster.bounds)).toBe(
            0,
        );
        if (cluster?.kind === "cluster") {
            const expansion = index.getClusterExpansionZoom(cluster.id);

            expect(expansion).toBeGreaterThan(FLEET_CLUSTER_MAX_ZOOM);
            expect(
                clusterOpen({
                    expansionZoom: expansion,
                    bounds: cluster.bounds,
                }),
            ).toEqual({ zoom: FLEET_CLUSTER_MAX_ZOOM + 1, list: true });
        }

        const high = clustersFromIndex(index, cologneBox, 16);

        expect(countOf(high)).toBe(4);
        expect(high).toHaveLength(1);

        const apart = clustersFromIndex(
            index,
            cologneBox,
            FLEET_CLUSTER_MAX_ZOOM + 1,
        );

        expect(apart.every((item) => item.kind === "vehicle")).toBe(true);
        expect(apart).toHaveLength(4);
        expect(
            [...clusterMemberIds(index, (high[0] as { id: number }).id)].sort(
                (left, right) => left - right,
            ),
        ).toEqual([1, 2, 3, 4]);
    });

    it("fits distant vehicles in one step and keeps them separate when zoomed in", () => {
        const points = [
            at(1, 50.94, 6.96),
            at(2, 48.14, 11.58),
        ];
        const index = createFleetClusterIndex(points);
        const close = clustersFromIndex(index, germany, 8);

        expect(close.every((item) => item.kind === "vehicle")).toBe(true);
        expect(countOf(close)).toBe(2);

        const far = clustersFromIndex(index, germany, 2);
        const cluster = far.find((item) => item.kind === "cluster");

        expect(countOf(far)).toBe(2);
        expect(cluster).toMatchObject({ kind: "cluster", count: 2 });

        if (cluster?.kind !== "cluster") {
            return;
        }

        const expansion = index.getClusterExpansionZoom(cluster.id);
        const open = clusterOpen({
            expansionZoom: expansion,
            bounds: cluster.bounds,
        });

        expect(open.list).toBe(false);
        expect(open.zoom).toBeGreaterThan(2);
        expect(open.zoom).toBeLessThanOrEqual(FLEET_CLUSTER_MAX_ZOOM + 1);
    });

    it("ignores points outside the bbox and an empty set", () => {
        const points = [
            at(1, 50.94, 6.96),
            at(2, 48.14, 11.58),
        ];
        const index = createFleetClusterIndex(points);

        expect(countOf(clustersFromIndex(index, cologneBox, 8))).toBe(1);
        expect(clustersFromIndex(createFleetClusterIndex([]), germany, 6)).toEqual(
            [],
        );
    });

    it("rebuilds immediately when ids change and waits several seconds on coordinate updates", () => {
        expect(clusterIndexDelay([1, 2], [1, 2])).toBe(
            CLUSTER_INDEX_DEBOUNCE_MS,
        );
        expect(CLUSTER_INDEX_DEBOUNCE_MS).toBeGreaterThanOrEqual(3_000);
        expect(clusterIndexDelay([1, 2], [1, 3])).toBe(0);
        expect(clusterIndexDelay([1], [1, 2])).toBe(0);
    });
});
