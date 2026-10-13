/**
 * Lokales Clustering für die Flottenkarte.
 *
 * Der Client lädt den Firmenbestand einmal (bis zum Positions-Limit) und
 * clustert ihn bis Zoom 16. Eine Stufe weiter sind es einzelne Marker. Schwenken ruft nur
 * `clustersFromIndex` auf. Den Index neu bauen, wenn sich die Fahrzeug-IDs
 * ändern (`clusterIndexDelay` ist dann 0). Ändern sich nur Koordinaten,
 * entsteht höchstens ein Index pro `CLUSTER_INDEX_DEBOUNCE_MS`.
 */
import Supercluster from "supercluster";
import {
    VEHICLE_STATUSES,
    type GeoBBox,
    type VehicleStatus,
} from "@fleet-live/shared";

export const FLEET_CLUSTER_RADIUS_PX = 60;
/**
 * Letzte Stufe, auf der Supercluster noch Gruppen bildet.
 * Die Karte zoomt eine Stufe weiter, damit daraus einzelne Marker werden.
 */
export const FLEET_CLUSTER_MAX_ZOOM = 16;
/** Hülle unter dieser Diagonale öffnet die Liste, die Marker liegen aufeinander. */
export const FLEET_CLUSTER_LIST_SPAN_M = 25;
/** Gleicher Rand wie `fitBounds`, damit die Entscheidung zur Karte passt. */
export const FLEET_CLUSTER_FIT_PADDING_PX = 48;
/** Laufende Fahrt: höchstens ein neuer Index in diesem Abstand. */
export const CLUSTER_INDEX_DEBOUNCE_MS = 4_000;

export type ClusterPoint = {
    id: number;
    latitude: number;
    longitude: number;
    status: VehicleStatus;
};

export type StatusCounts = Record<VehicleStatus, number>;

export type FleetCluster =
    | {
          kind: "cluster";
          id: number;
          latitude: number;
          longitude: number;
          count: number;
          counts: StatusCounts;
          bounds: GeoBBox;
      }
    | {
          kind: "vehicle";
          id: number;
          latitude: number;
          longitude: number;
      };

export type ClusterOpen = {
    zoom: number;
    list: boolean;
};

type PointProps = {
    id: number;
    status: VehicleStatus;
    lat: number;
    lng: number;
};

type ClusterAgg = {
    counts: StatusCounts;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
};

export type FleetClusterIndex = Supercluster<PointProps, ClusterAgg>;

export function emptyStatusCounts(): StatusCounts {
    return { IDLE: 0, DRIVING: 0, STOPPED: 0, OFFLINE: 0 };
}

export function isInsideBBox(
    latitude: number,
    longitude: number,
    bbox: GeoBBox,
): boolean {
    return (
        longitude >= bbox.west &&
        longitude <= bbox.east &&
        latitude >= bbox.south &&
        latitude <= bbox.north
    );
}

/** 0, wenn der Fahrzeugbestand sich geändert hat, sonst die Wartezeit. */
export function clusterIndexDelay(
    previousIds: readonly number[],
    nextIds: readonly number[],
): number {
    if (previousIds.length !== nextIds.length) {
        return 0;
    }

    for (let index = 0; index < previousIds.length; index += 1) {
        if (previousIds[index] !== nextIds[index]) {
            return 0;
        }
    }

    return CLUSTER_INDEX_DEBOUNCE_MS;
}

function haversineMeters(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
): number {
    const earth = 6_371_000;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(latitudeB - latitudeA);
    const dLng = toRad(longitudeB - longitudeA);
    const latA = toRad(latitudeA);
    const latB = toRad(latitudeB);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;

    return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Diagonale der Hülle in Metern. Ein Punkt ist 0. */
export function boundsSpanMeters(bounds: GeoBBox): number {
    return haversineMeters(
        bounds.south,
        bounds.west,
        bounds.north,
        bounds.east,
    );
}

/**
 * Klick fliegt auf den Zoom, an dem die Gruppe auseinanderfällt.
 * Liegen die Fahrzeuge auf einem Fleck, kommt zusätzlich die Liste.
 */
export function clusterOpen(input: {
    expansionZoom: number;
    bounds: GeoBBox;
}): ClusterOpen {
    const zoom = Math.min(
        Math.max(input.expansionZoom, 0),
        FLEET_CLUSTER_MAX_ZOOM + 1,
    );
    const piled =
        boundsSpanMeters(input.bounds) < FLEET_CLUSTER_LIST_SPAN_M ||
        input.expansionZoom > FLEET_CLUSTER_MAX_ZOOM;

    return { zoom, list: piled };
}

function pointAggregate(props: PointProps): ClusterAgg {
    const counts = emptyStatusCounts();
    counts[props.status] = 1;

    return {
        counts,
        minLat: props.lat,
        maxLat: props.lat,
        minLng: props.lng,
        maxLng: props.lng,
    };
}

function mergeAggregate(accumulated: ClusterAgg, props: ClusterAgg) {
    for (const status of VEHICLE_STATUSES) {
        accumulated.counts[status] += props.counts[status];
    }

    accumulated.minLat = Math.min(accumulated.minLat, props.minLat);
    accumulated.maxLat = Math.max(accumulated.maxLat, props.maxLat);
    accumulated.minLng = Math.min(accumulated.minLng, props.minLng);
    accumulated.maxLng = Math.max(accumulated.maxLng, props.maxLng);
}

export function createFleetClusterIndex(
    points: readonly ClusterPoint[],
): FleetClusterIndex {
    const index = new Supercluster<PointProps, ClusterAgg>({
        radius: FLEET_CLUSTER_RADIUS_PX,
        maxZoom: FLEET_CLUSTER_MAX_ZOOM,
        minPoints: 2,
        map: pointAggregate,
        reduce: mergeAggregate,
    });

    index.load(
        points.map((point) => ({
            type: "Feature",
            properties: {
                id: point.id,
                status: point.status,
                lat: point.latitude,
                lng: point.longitude,
            },
            geometry: {
                type: "Point",
                coordinates: [point.longitude, point.latitude],
            },
        })),
    );

    return index;
}

/** Stand der Mitglieder zum Klickzeitpunkt. Spätere Ticks ändern diese IDs nicht. */
export function clusterMemberIds(
    index: FleetClusterIndex,
    clusterId: number,
): number[] {
    return index.getLeaves(clusterId, 10_000).flatMap((leaf) => {
        const id = leaf.properties?.id;

        return id === undefined ? [] : [id];
    });
}

export function clustersFromIndex(
    index: FleetClusterIndex,
    bbox: GeoBBox,
    zoom: number,
): FleetCluster[] {
    const zoomLevel = Math.max(
        0,
        Math.min(FLEET_CLUSTER_MAX_ZOOM + 1, Math.round(zoom)),
    );
    const features = index.getClusters(
        [bbox.west, bbox.south, bbox.east, bbox.north],
        zoomLevel,
    );
    const clusters: FleetCluster[] = [];

    for (const feature of features) {
        const latitude = feature.geometry.coordinates[1];
        const longitude = feature.geometry.coordinates[0];
        const props = feature.properties;

        if (latitude === undefined || longitude === undefined || !props) {
            continue;
        }

        if ("cluster" in props && props.cluster) {
            clusters.push({
                kind: "cluster",
                id: props.cluster_id,
                latitude,
                longitude,
                count: props.point_count,
                counts: { ...props.counts },
                bounds: {
                    west: props.minLng,
                    south: props.minLat,
                    east: props.maxLng,
                    north: props.maxLat,
                },
            });
            continue;
        }

        if (!("id" in props) || props.id === undefined) {
            continue;
        }

        clusters.push({
            kind: "vehicle",
            id: props.id,
            latitude,
            longitude,
        });
    }

    return clusters;
}
