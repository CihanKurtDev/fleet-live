/**
 * Lokales Clustering für die Flottenkarte.
 *
 * Der Client lädt den Firmenbestand einmal (bis zum Positions-Limit) und
 * clustert ihn bis Zoom 14. Eine Stufe weiter sind es einzelne Marker. Schwenken ruft nur
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

const FLEET_CLUSTER_RADIUS_PX = 60;
/**
 * Letzte Stufe, auf der Supercluster noch Gruppen bildet.
 * Die Karte zoomt eine Stufe weiter, damit daraus einzelne Marker werden.
 * Ab Zoom 15 (Maßstabsbalken etwa 200 m) sind es einzelne Punkte; bei 16 wären
 * es 100 m, bei 17 nur noch 50 m, das ist für die kleinsten Gruppen zu nah.
 */
export const FLEET_CLUSTER_MAX_ZOOM = 14;
/** Hülle unter dieser Diagonale öffnet die Liste, die Marker liegen aufeinander. */
const FLEET_CLUSTER_LIST_SPAN_M = 25;
/** Gleicher Rand wie `fitBounds`, damit die Entscheidung zur Karte passt. */
export const FLEET_CLUSTER_FIT_PADDING_PX = 48;
/**
 * Laufende Fahrt: höchstens ein neuer Index in diesem Abstand. Er wird aus den
 * gezeigten (nicht den gemeldeten) Positionen gebaut; bei einer Sekunde ist der
 * Schritt einer Gruppe klein und sie gleitet gleichmäßig statt alle paar
 * Sekunden zu springen.
 */
export const CLUSTER_INDEX_DEBOUNCE_MS = 1_000;

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
          /** Supercluster id: valid only for the index that made it. */
          id: number;
          /**
           * Stays the same for the same group when the index is rebuilt from
           * moved positions (the lowest vehicle id in it), so its symbol is
           * kept and glides instead of being replaced.
           */
          anchor: number;
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

type ClusterOpen = {
    zoom: number;
    list: boolean;
};

type PointProps = {
    id: number;
    status: VehicleStatus;
    lat: number;
    lng: number;
};

/**
 * Flach, ohne verschachteltes Objekt: Supercluster kopiert die Werte einer
 * Teil-Gruppe beim Zusammenfassen nur flach. Ein `counts`-Objekt darin wäre
 * von mehreren Gruppen geteilt und würde bei `reduce` bei allen mitwachsen
 * (die Ringe zeigten dann die Verteilung der ganzen Flotte).
 */
type ClusterAgg = StatusCounts & {
    /** Lowest vehicle id in the group: it names the group across index rebuilds. */
    minId: number;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
};

export type FleetClusterIndex = Supercluster<PointProps, ClusterAgg>;

function emptyStatusCounts(): StatusCounts {
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
 * Klick fliegt so nah heran, wie alle Mitglieder noch ins Bild passen
 * (`fitZoom`), mindestens aber auf den Zoom, an dem die Gruppe
 * auseinanderfällt. Die Gruppe zerfällt so in einem Schritt so weit wie
 * möglich, ohne dass ein Fahrzeug aus dem Bild fällt.
 * Liegen die Fahrzeuge auf einem Fleck, kommt zusätzlich die Liste.
 */
export function clusterOpen(input: {
    expansionZoom: number;
    fitZoom?: number;
    bounds: GeoBBox;
}): ClusterOpen {
    const zoom = Math.min(
        Math.max(input.expansionZoom, Math.floor(input.fitZoom ?? 0), 0),
        FLEET_CLUSTER_MAX_ZOOM + 1,
    );
    const piled =
        boundsSpanMeters(input.bounds) < FLEET_CLUSTER_LIST_SPAN_M ||
        input.expansionZoom > FLEET_CLUSTER_MAX_ZOOM;

    return { zoom, list: piled };
}

function pointAggregate(props: PointProps): ClusterAgg {
    return {
        ...emptyStatusCounts(),
        [props.status]: 1,
        minId: props.id,
        minLat: props.lat,
        maxLat: props.lat,
        minLng: props.lng,
        maxLng: props.lng,
    };
}

function mergeAggregate(accumulated: ClusterAgg, props: ClusterAgg) {
    for (const status of VEHICLE_STATUSES) {
        accumulated[status] += props[status];
    }

    accumulated.minId = Math.min(accumulated.minId, props.minId);
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
        // Leaflet tiles are 256 px; with the default 512 the radius would be
        // half of FLEET_CLUSTER_RADIUS_PX on screen and symbols would overlap.
        extent: 256,
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
    // Rounded down: at a quarter step such as 15.75 the groups of level 15
    // keep their full spacing; level 16 would pack them closer than a symbol.
    const zoomLevel = Math.max(
        0,
        Math.min(FLEET_CLUSTER_MAX_ZOOM + 1, Math.floor(zoom + 1e-9)),
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
                anchor: props.minId,
                latitude,
                longitude,
                count: props.point_count,
                counts: {
                    IDLE: props.IDLE,
                    DRIVING: props.DRIVING,
                    STOPPED: props.STOPPED,
                    OFFLINE: props.OFFLINE,
                },
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
