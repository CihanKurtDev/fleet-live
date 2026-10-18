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

describe("cluster status counts", () => {
    /**
     * Ein dichtes Depot ohne Fahrer unterwegs, drumherum Fahrende auf den
     * Straßen: jede Gruppe muss die Status ihrer eigenen Mitglieder zählen,
     * auf jeder Zoomstufe, auch wenn sie aus Teil-Gruppen entsteht.
     */
    const fleet = () => {
        const points: ClusterPoint[] = [];
        let id = 1;
        const statuses: VehicleStatus[] = ["IDLE", "IDLE", "STOPPED", "OFFLINE"];

        for (let index = 0; index < 600; index += 1) {
            points.push(
                at(
                    id++,
                    50.89 + ((index * 17) % 41) * 0.0001,
                    6.905 + ((index * 29) % 41) * 0.0001,
                    statuses[index % statuses.length],
                ),
            );
        }

        for (let index = 0; index < 400; index += 1) {
            points.push(
                at(
                    id++,
                    50.95 + (index % 80) * 0.004,
                    6.95 + Math.floor(index / 80) * 0.03 + (index % 7) * 0.002,
                    "DRIVING",
                ),
            );
        }

        return points;
    };

    it("counts exactly the statuses of its own members on every zoom level", () => {
        const points = fleet();
        const status = new Map(points.map((point) => [point.id, point.status]));
        const index = createFleetClusterIndex(points);
        const world: GeoBBox = { west: -180, south: -85, east: 180, north: 85 };

        for (let zoom = 0; zoom <= FLEET_CLUSTER_MAX_ZOOM + 1; zoom += 1) {
            for (const cluster of clustersFromIndex(index, world, zoom)) {
                if (cluster.kind !== "cluster") {
                    continue;
                }

                const truth = { IDLE: 0, DRIVING: 0, STOPPED: 0, OFFLINE: 0 };

                for (const memberId of clusterMemberIds(index, cluster.id)) {
                    truth[status.get(memberId)!] += 1;
                }

                expect(cluster.counts, `zoom ${zoom}, cluster ${cluster.id}`).toEqual(
                    truth,
                );
                expect(
                    Object.values(cluster.counts).reduce((sum, n) => sum + n, 0),
                ).toBe(cluster.count);
            }
        }
    });

    it("does not count the driving vehicles near a depot into the depot group", () => {
        const points = fleet();
        const index = createFleetClusterIndex(points);
        const world: GeoBBox = { west: -180, south: -85, east: 180, north: 85 };

        // Auf jeder Stufe bleibt eine Gruppe nur dann „ohne Fahrt“, wenn kein
        // Mitglied fährt; die Zählung darf dafür keine Fahrt dazuerfinden.
        for (let zoom = 0; zoom <= FLEET_CLUSTER_MAX_ZOOM; zoom += 1) {
            for (const cluster of clustersFromIndex(index, world, zoom)) {
                if (cluster.kind !== "cluster") {
                    continue;
                }

                const members = clusterMemberIds(index, cluster.id);
                const driving = members.filter((memberId) => memberId > 600).length;

                expect(cluster.counts.DRIVING).toBe(driving);
            }
        }
    });
});

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

        const high = clustersFromIndex(index, cologneBox, FLEET_CLUSTER_MAX_ZOOM);

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

    it("opens a group as far as all its vehicles still fit, not just one split", () => {
        const bounds = { west: 6.9, south: 50.9, east: 7.0, north: 51.0 };

        expect(clusterOpen({ expansionZoom: 9, fitZoom: 12.6, bounds }).zoom).toBe(12);
        // A group that only fits further out still splits.
        expect(clusterOpen({ expansionZoom: 9, fitZoom: 7, bounds }).zoom).toBe(9);
        expect(clusterOpen({ expansionZoom: 9, fitZoom: 30, bounds }).zoom).toBe(
            FLEET_CLUSTER_MAX_ZOOM + 1,
        );
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

    it("rebuilds immediately when ids change and at most about once a second on coordinate updates", () => {
        expect(clusterIndexDelay([1, 2], [1, 2])).toBe(
            CLUSTER_INDEX_DEBOUNCE_MS,
        );
        expect(CLUSTER_INDEX_DEBOUNCE_MS).toBeGreaterThanOrEqual(1_000);
        expect(clusterIndexDelay([1, 2], [1, 3])).toBe(0);
        expect(clusterIndexDelay([1], [1, 2])).toBe(0);
    });
});
