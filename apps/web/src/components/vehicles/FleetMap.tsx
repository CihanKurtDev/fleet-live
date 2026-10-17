import { useEffect, useMemo, useRef, useState } from "react";
import type {
    FleetDensityCell,
    FleetPosition,
    GeoBBox,
    VehicleStatus,
} from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useLatestRef } from "../../hooks/useLatestRef";
import { formatCount } from "../../utils/formatCount";
import type { DepotDraft } from "./depotDraft";
import { listSimRoutes } from "../../api/sim";
import {
    addRouteLines,
    depotColor,
    depotStyle,
    markerStroke,
    markerStyle,
} from "./fleetMapStyle";
import { createThemedMap, themeColor } from "./leafletMap";
import {
    CLUSTER_INDEX_DEBOUNCE_MS,
    FLEET_CLUSTER_FIT_PADDING_PX,
    FLEET_CLUSTER_MAX_ZOOM,
    clusterMemberIds,
    clusterOpen,
    clustersFromIndex,
    isInsideBBox,
    type FleetCluster,
    type StatusCounts,
} from "./clusterFleet";
import { useClusterIndex } from "./useClusterIndex";
import {
    MAP_STATUS_LEGEND,
    vehicleStatusColor,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";


const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
/** Pane for depot names: above the rings, below the vehicle markers. */
const DEPOT_LABEL_PANE = "fl-depot-labels";
const METERS_PER_DEGREE_LAT = 111_320;
/** Largest group symbol in px (`clusterIconSize`); depot names keep clear of it. */
const CLUSTER_ICON_MAX = 48;
const GERMANY_ZOOM = 6;
/*
 * Not `usePresence.skipMotion`: that also skips when matchMedia is missing.
 */
const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const BOUNDS_DEBOUNCE_MS = 200;
/** Nur anzeigen, wenn der Ausschnitt die Liste vollständig fasst. */
const MAP_VEHICLE_LIST_LIMIT = 100;

type Box = { left: number; right: number; top: number; bottom: number };

/** A dot or group symbol travelling from where it is to its new place. */
type Glide = {
    from: L.LatLng;
    to: L.LatLng;
    start: number;
    duration: number;
};

type Glides = Map<L.Marker | L.CircleMarker, Glide>;

type MarkerRecord = {
    marker: L.CircleMarker;
    status: VehicleStatus;
    selected: boolean;
    latitude: number;
    longitude: number;
    /** When the last report arrived; the next glide takes that long. */
    reportedAt: number;
};

/*
 * A dot glides to each new report over the time the previous report took,
 * so it arrives about when the next one comes in and keeps moving instead of
 * jumping. A longer gap than the limit is not motion any more: it jumps.
 * Group symbols move when the index is rebuilt (every few seconds while
 * vehicles drive), so they get a longer limit.
 */
const GLIDE_MIN_MS = 250;
const DOT_GLIDE = { ms: 3_000, px: 400 };
/*
 * A rebuilt index can hand a group id to a group somewhere else; a symbol
 * that would travel further than its own size is that other group and
 * jumps, so it never flies across the map under the pointer.
 */
const CLUSTER_GLIDE = { ms: CLUSTER_INDEX_DEBOUNCE_MS + 2_000, px: 48 };
/**
 * A group with vehicles on the road is framed with this much room around each
 * of them: the simulator runs in time-lapse and covers well over 100 m per
 * second, so a tight frame would be empty soon after the flight ends.
 */
const DRIVING_FRAME_MARGIN_M = 500;
/** Same reach as the canvas renderer's `tolerance`. */
const VEHICLE_HIT_TOLERANCE_PX = 6;

const roundCoord = (value: number) => Math.round(value * 10_000) / 10_000;

type ClusterMarkerRecord = {
    marker: L.Marker;
    signature: string;
    latitude: number;
    longitude: number;
    reportedAt: number;
};

/**
 * Moves a layer to `to`: a glide over `gap` ms while the hop is on screen,
 * otherwise (reduced motion, a long gap, off screen) at once.
 */
function moveLayer(
    map: L.Map,
    glides: Glides,
    layer: L.Marker | L.CircleMarker,
    to: L.LatLng,
    gap: number,
    limit: { ms: number; px: number },
    run: () => void,
) {
    const from = layer.getLatLng();
    const seen = map.getBounds().pad(0.5);
    const hop = map
        .latLngToContainerPoint(from)
        .distanceTo(map.latLngToContainerPoint(to));

    if (
        prefersReducedMotion() ||
        gap > limit.ms ||
        hop > limit.px ||
        (!seen.contains(from) && !seen.contains(to))
    ) {
        glides.delete(layer);
        layer.setLatLng(to);
        return;
    }

    glides.set(layer, {
        from,
        to,
        start: performance.now(),
        duration: Math.max(GLIDE_MIN_MS, gap),
    });
    run();
}

function clusterGradient(counts: StatusCounts): string {
    const total = MAP_STATUS_LEGEND.reduce(
        (sum, status) => sum + (counts[status] ?? 0),
        0,
    );

    if (total <= 0) {
        return themeColor("--border-strong", "#3c475c");
    }

    let cursor = 0;
    const stops: string[] = [];

    for (const status of MAP_STATUS_LEGEND) {
        const share = (counts[status] ?? 0) / total;

        if (share <= 0) {
            continue;
        }

        const next = cursor + share * 100;
        stops.push(`${vehicleStatusColor(status)} ${cursor}% ${next}%`);
        cursor = next;
    }

    return `conic-gradient(${stops.join(",")})`;
}

function clusterSignature(item: Extract<FleetCluster, { kind: "cluster" }>): string {
    return MAP_STATUS_LEGEND.map((status) => item.counts[status]).join(":");
}

function clusterIconSize(count: number): number {
    return count < 10 ? 28 : count < 100 ? 34 : count < 1000 ? 40 : 48;
}

function clusterIcon(
    item: Extract<FleetCluster, { kind: "cluster" }>,
    label: string,
): L.DivIcon {
    const size = clusterIconSize(item.count);
    const problem = item.counts.OFFLINE > 0;

    return L.divIcon({
        className: styles.clusterIcon,
        html: `<span class="${styles.clusterRing}" data-problem="${problem ? "true" : "false"}" style="background:${clusterGradient(item.counts)}"><span class="${styles.clusterCore}">${label}</span></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

function clusterCaption(item: Extract<FleetCluster, { kind: "cluster" }>, label: string): string {
    const noun = item.count === 1 ? "Fahrzeug" : "Fahrzeuge";
    const offline = item.counts.OFFLINE;

    if (offline <= 0) {
        return `${label} ${noun}`;
    }

    return `${label} ${noun}, ${formatCount(offline)} ohne Signal`;
}

const boundsToBBox = (bounds: L.LatLngBounds): GeoBBox => ({
    west: roundCoord(Math.max(-180, bounds.getWest())),
    south: roundCoord(Math.max(-90, bounds.getSouth())),
    east: roundCoord(Math.min(180, bounds.getEast())),
    north: roundCoord(Math.min(90, bounds.getNorth())),
});


const hasMapPosition = (
    vehicle: FleetPosition,
): vehicle is FleetPosition & { latitude: number; longitude: number } =>
    vehicle.has_position &&
    vehicle.latitude !== null &&
    vehicle.longitude !== null;

const markerTooltip = (vehicle: FleetPosition) =>
    `${vehicle.license_plate} · ${vehicle.driver_name ?? "Kein Fahrer"} · ${vehicleStatusLabel(vehicle.status)}`;

const densityStatus = (cell: FleetDensityCell): VehicleStatus =>
    (Object.entries(cell.counts) as [VehicleStatus, number][]).reduce(
        (largest, current) => (current[1] > largest[1] ? current : largest),
        ["IDLE", 0],
    )[0];

const densityTooltip = (cell: FleetDensityCell) =>
    `${cell.total} Fahrzeuge · ${Object.entries(cell.counts)
        .filter(([, count]) => count > 0)
        .map(
            ([status, count]) =>
                `${vehicleStatusLabel(status as VehicleStatus)} ${count}`,
        )
        .join(" · ")}`;

type MapDepot = {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
};

type FleetMapProps = {
    vehicles: FleetPosition[];
    densityCells: FleetDensityCell[];
    mode: "positions" | "density";
    initialBbox?: GeoBBox | null;
    focusKey?: string | null;
    focusPosition?: FleetPosition | null;
    depots?: MapDepot[];
    draft?: DepotDraft | null;
    selectedDepotId?: number | null;
    focusDepot?: { id: number; nonce: number } | null;
    placing?: boolean;
    canEditDepots?: boolean;
    lockDepotSelection?: boolean;
    selectedId?: number | null;
    frame?: { nonce: number; bounds: GeoBBox } | null;
    onBoundsChange: (bbox: GeoBBox) => void;
    onSelect: (id: number) => void;
    onPlaceDepot?: (latitude: number, longitude: number) => void;
    onMoveDepot?: (
        id: number | "new",
        latitude: number,
        longitude: number,
    ) => void;
    onSelectDepot?: (id: number) => void;
};

export const FleetMap = ({
    vehicles,
    densityCells,
    mode,
    initialBbox = null,
    focusKey = null,
    focusPosition = null,
    depots = [],
    draft = null,
    selectedDepotId = null,
    focusDepot = null,
    placing = false,
    canEditDepots = false,
    lockDepotSelection = false,
    selectedId = null,
    frame = null,
    onBoundsChange,
    onSelect,
    onPlaceDepot,
    onMoveDepot,
    onSelectDepot,
}: FleetMapProps) => {
    const [view, setView] = useState<{ bbox: GeoBBox; zoom: number } | null>(
        null,
    );
    const [stackIds, setStackIds] = useState<number[] | null>(null);
    const [listOpen, setListOpen] = useState(false);
    const inViewVehicles = useMemo(
        () =>
            vehicles.filter(
                (vehicle) =>
                    hasMapPosition(vehicle) &&
                    (view === null ||
                        isInsideBBox(
                            vehicle.latitude,
                            vehicle.longitude,
                            view.bbox,
                        )),
            ),
        [vehicles, view],
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const canvasRef = useRef<L.Canvas | null>(null);
    const markersRef = useRef(new Map<number, MarkerRecord>());
    const clusterMarkersRef = useRef(new Map<number, ClusterMarkerRecord>());
    const densityMarkersRef = useRef<L.CircleMarker[]>([]);
    const lastFocusKeyRef = useRef<string | null>(null);
    const stackZoomRef = useRef<number | null>(null);
    const lastFrameRef = useRef(0);
    const initialBboxRef = useRef(initialBbox);
    const onBoundsChangeRef = useLatestRef(onBoundsChange);
    const onSelectRef = useLatestRef(onSelect);
    const onPlaceDepotRef = useLatestRef(onPlaceDepot);
    const onMoveDepotRef = useLatestRef(onMoveDepot);
    const onSelectDepotRef = useLatestRef(onSelectDepot);
    const ignoreMapClickRef = useRef(false);
    const depotLayerRef = useRef<L.LayerGroup | null>(null);
    /** Hides depot names that a group or vehicle symbol would cover. */
    const declutterRef = useRef<() => void>(() => undefined);
    /** Starts the frame loop that moves gliding dots. */
    const glideRef = useRef<() => void>(() => undefined);
    const glidesRef = useRef<Glides>(new Map());
    /**
     * The selected vehicle stays in the middle while it drives, until the user
     * drags or zooms; selecting it again resumes (like the detail map).
     */
    const followRef = useRef({ on: false, at: 0, lat: NaN, lng: NaN });
    /**
     * The selected vehicle once more as a DOM symbol above the groups, so a
     * group driving over it never takes the click (dots are on the canvas,
     * groups are DOM markers on top of it).
     */
    const selectedMarkerRef = useRef<{
        marker: L.Marker;
        id: number;
        status: VehicleStatus;
    } | null>(null);
    const syncSelectedMarker = () => {
        const chosen = selectedMarkerRef.current;
        const dot = chosen ? markersRef.current.get(chosen.id) : undefined;
        if (chosen && dot) {
            chosen.marker.setLatLng(dot.marker.getLatLng());
        }
    };
    const vehiclesRef = useLatestRef(vehicles);
    const lastDepotFocusRef = useRef("");
    const listedVehicles =
        inViewVehicles.length <= MAP_VEHICLE_LIST_LIMIT
            ? inViewVehicles
            : [];
    // The selected vehicle never hides in a group: it is drawn on its own,
    // with its ring, at every zoom.
    const clusterPoints = useMemo(
        () =>
            vehicles.flatMap((vehicle) =>
                hasMapPosition(vehicle) && vehicle.id !== selectedId
                    ? [
                          {
                              id: vehicle.id,
                              latitude: vehicle.latitude,
                              longitude: vehicle.longitude,
                              status: vehicle.status,
                          },
                      ]
                    : [],
            ),
        [selectedId, vehicles],
    );
    const selectedVehicle = useMemo(
        () => vehicles.find((vehicle) => vehicle.id === selectedId) ?? null,
        [selectedId, vehicles],
    );
    const clusterIndex = useClusterIndex(clusterPoints);
    const clusters = useMemo((): FleetCluster[] => {
        if (!view || mode !== "positions") {
            return [];
        }
        const shown = clustersFromIndex(clusterIndex, view.bbox, view.zoom);
        return selectedVehicle && hasMapPosition(selectedVehicle)
            ? [
                  ...shown,
                  {
                      kind: "vehicle",
                      id: selectedVehicle.id,
                      latitude: selectedVehicle.latitude,
                      longitude: selectedVehicle.longitude,
                  },
              ]
            : shown;
    }, [clusterIndex, mode, selectedVehicle, view]);
    const clusterIndexRef = useRef(clusterIndex);
    const clustersRef = useRef(clusters);
    clusterIndexRef.current = clusterIndex;
    clustersRef.current = clusters;
    const stackVehicles = useMemo(() => {
        if (!stackIds || stackIds.length === 0) {
            return [];
        }

        const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

        return stackIds.flatMap((id) => {
            const vehicle = byId.get(id);
            return vehicle ? [vehicle] : [];
        });
    }, [stackIds, vehicles]);
    const selectedInSideList =
        selectedId !== null &&
        listedVehicles.some((vehicle) => vehicle.id === selectedId);

    useEffect(() => {
        if (view === null || stackIds === null || stackZoomRef.current === null) {
            return;
        }

        if (view.zoom < stackZoomRef.current - 0.5) {
            stackZoomRef.current = null;
            setStackIds(null);
        }
    }, [stackIds, view]);

    useEffect(() => {
        if (selectedInSideList) {
            setListOpen(true);
        }
    }, [selectedInSideList]);

    useEffect(() => {
        if (selectedId === null) {
            return;
        }

        document
            .getElementById(`fleet-row-${selectedId}`)
            ?.scrollIntoView({ block: "nearest" });
    }, [selectedId, listOpen]);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const themed = createThemedMap(container, {
            invalidateDelays: [],
            // Quarter steps let "all vehicles" fill a wide screen instead of
            // falling back a whole level; the buttons still zoom by one.
            mapOptions: { zoomSnap: 0.25 },
        });
        const map = themed.map;
        // Tolerance keeps the small dots easy to click.
        const canvas = L.canvas({
            padding: 0.3,
            tolerance: VEHICLE_HIT_TOLERANCE_PX,
        });
        canvas.addTo(map);

        let ignoreView = true;
        let timer: number | undefined;
        const emitBounds = () => {
            onBoundsChangeRef.current(boundsToBBox(map.getBounds()));
        };
        const publishView = () => {
            setView({
                bbox: boundsToBBox(map.getBounds()),
                zoom: map.getZoom(),
            });
        };
        const onUserView = () => {
            if (ignoreView) {
                return;
            }

            if (timer !== undefined) {
                window.clearTimeout(timer);
            }

            timer = window.setTimeout(emitBounds, BOUNDS_DEBOUNCE_MS);
        };

        // Every settled view counts: dragging, zooming, a cluster flight and
        // a search hit alike, so URL and live focus follow what is shown.
        map.on("moveend", onUserView);

        // The user's own pan or zoom ends following the selected vehicle.
        const stopFollow = () => {
            followRef.current.on = false;
        };
        map.on("dragstart", stopFollow);
        L.DomEvent.on(container, "wheel dblclick", stopFollow);
        const zoomButtons = container.querySelector(".leaflet-control-zoom");
        zoomButtons?.addEventListener("click", stopFollow);
        map.on("moveend", publishView);
        const start = initialBboxRef.current;

        if (start) {
            map.fitBounds(
                L.latLngBounds(
                    [start.south, start.west],
                    [start.north, start.east],
                ),
                { animate: false },
            );
        } else {
            map.setView(GERMANY_CENTER, GERMANY_ZOOM);
        }

        map.invalidateSize();
        mapRef.current = map;
        canvasRef.current = canvas;
        const resizeObserver = new ResizeObserver(() => {
            map.invalidateSize();
        });
        resizeObserver.observe(container);
        emitBounds();
        publishView();
        requestAnimationFrame(() => {
            ignoreView = false;
        });

        const glides = glidesRef.current;
        let glideFrame = 0;
        const glideStep = (now: number) => {
            glideFrame = 0;
            let moving = false;

            for (const [layer, glide] of glides) {
                if (!map.hasLayer(layer)) {
                    glides.delete(layer);
                    continue;
                }

                const t = Math.min(1, (now - glide.start) / glide.duration);
                layer.setLatLng([
                    glide.from.lat + (glide.to.lat - glide.from.lat) * t,
                    glide.from.lng + (glide.to.lng - glide.from.lng) * t,
                ]);

                if (t >= 1) {
                    glides.delete(layer);
                } else {
                    moving = true;
                }
            }

            syncSelectedMarker();

            if (moving) {
                glideFrame = requestAnimationFrame(glideStep);
            }
        };
        glideRef.current = () => {
            if (glideFrame === 0) {
                glideFrame = requestAnimationFrame(glideStep);
            }
        };

        // Roads the fleet drives on, under the dots (tiles have none at low zoom).
        let routeLines: ReturnType<typeof addRouteLines> | null = null;
        let routesGone = false;
        listSimRoutes()
            .then((response) => {
                if (!routesGone) {
                    routeLines = addRouteLines(map, response.data);
                }
            })
            .catch(() => undefined);

        themed.onThemeChange(() => {
            routeLines?.restyle();
            const stroke = markerStroke();
            for (const entry of markersRef.current.values()) {
                entry.marker.setStyle(markerStyle(entry.status, entry.selected));
            }
            for (const marker of densityMarkersRef.current) {
                marker.setStyle({ color: stroke });
            }
        });

        const markers = markersRef.current;

        return () => {
            cancelAnimationFrame(glideFrame);
            glideRef.current = () => undefined;
            glides.clear();
            routesGone = true;
            routeLines?.remove();
            resizeObserver.disconnect();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            map.off("moveend", onUserView);
            map.off("dragstart", stopFollow);
            L.DomEvent.off(container, "wheel dblclick", stopFollow);
            zoomButtons?.removeEventListener("click", stopFollow);
            map.off("moveend", publishView);
            for (const entry of markers.values()) {
                entry.marker.remove();
            }
            markers.clear();
            for (const entry of clusterMarkersRef.current.values()) {
                entry.marker.remove();
            }
            clusterMarkersRef.current.clear();
            for (const marker of densityMarkersRef.current) {
                marker.remove();
            }
            densityMarkersRef.current = [];
            canvas.remove();
            themed.destroy();
            mapRef.current = null;
            canvasRef.current = null;
        };
    }, [onBoundsChangeRef]);

    useEffect(() => {
        const map = mapRef.current;
        const canvas = canvasRef.current;
        const markers = markersRef.current;

        if (!map || !canvas || mode !== "positions") {
            for (const entry of markers.values()) {
                entry.marker.remove();
            }
            markers.clear();
            return;
        }

        const live = new Map(
            vehicles.flatMap((vehicle) =>
                hasMapPosition(vehicle) ? [[vehicle.id, vehicle] as const] : [],
            ),
        );
        const seen = new Set<number>();

        for (const item of clusters) {
            if (item.kind !== "vehicle") {
                continue;
            }

            const vehicle = live.get(item.id);

            if (!vehicle || !hasMapPosition(vehicle)) {
                continue;
            }

            seen.add(vehicle.id);
            const existing = markers.get(vehicle.id);
            const at = L.latLng(vehicle.latitude, vehicle.longitude);
            const selected = vehicle.id === selectedId;

            if (!existing) {
                const marker = L.circleMarker(at, {
                    ...markerStyle(vehicle.status, selected),
                    renderer: canvas,
                });
                marker.bindTooltip(markerTooltip(vehicle), {
                    direction: "top",
                    offset: [0, -10],
                });
                marker.on("click", (event) => {
                    L.DomEvent.stopPropagation(event);
                    ignoreMapClickRef.current = true;
                    followRef.current.on = true;
                    onSelectRef.current(vehicle.id);
                });
                marker.addTo(map);
                markers.set(vehicle.id, {
                    marker,
                    status: vehicle.status,
                    selected,
                    latitude: vehicle.latitude,
                    longitude: vehicle.longitude,
                    reportedAt: performance.now(),
                });
                continue;
            }

            if (
                existing.latitude !== vehicle.latitude ||
                existing.longitude !== vehicle.longitude
            ) {
                const now = performance.now();
                moveLayer(
                    map,
                    glidesRef.current,
                    existing.marker,
                    at,
                    now - existing.reportedAt,
                    DOT_GLIDE,
                    glideRef.current,
                );
                existing.latitude = vehicle.latitude;
                existing.longitude = vehicle.longitude;
                existing.reportedAt = now;
            }

            if (
                existing.status !== vehicle.status ||
                existing.selected !== selected
            ) {
                existing.marker.setStyle(markerStyle(vehicle.status, selected));
                existing.marker.setTooltipContent(markerTooltip(vehicle));
                existing.status = vehicle.status;
                existing.selected = selected;
            }
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                entry.marker.remove();
                markers.delete(id);
            }
        }

        const dot = selectedId !== null ? markers.get(selectedId) : undefined;
        const shown = selectedMarkerRef.current;
        if (
            shown &&
            (!dot || shown.id !== selectedId || shown.status !== dot.status)
        ) {
            shown.marker.remove();
            selectedMarkerRef.current = null;
        }
        if (dot && selectedId !== null && !selectedMarkerRef.current) {
            const id = selectedId;
            const marker = L.marker(dot.marker.getLatLng(), {
                icon: L.divIcon({
                    className: styles.selectedDot,
                    iconSize: [17, 17],
                    html: `<span style="background:${vehicleStatusColor(dot.status)}"></span>`,
                }),
                zIndexOffset: 10_000,
                keyboard: false,
            });
            marker.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
                followRef.current.on = true;
                onSelectRef.current(id);
            });
            marker.addTo(map);
            selectedMarkerRef.current = { marker, id, status: dot.status };
        }
        syncSelectedMarker();

        declutterRef.current();
    }, [clusters, mode, onSelectRef, selectedId, vehicles]);

    useEffect(
        () => () => {
            selectedMarkerRef.current?.marker.remove();
            selectedMarkerRef.current = null;
        },
        [],
    );

    useEffect(() => {
        const map = mapRef.current;
        const markers = clusterMarkersRef.current;

        if (!map || mode !== "positions") {
            for (const entry of markers.values()) {
                entry.marker.remove();
            }
            markers.clear();
            return;
        }

        const openCluster = (id: number) => {
            const current = clustersRef.current.find(
                (entry) => entry.kind === "cluster" && entry.id === id,
            );

            if (!current || current.kind !== "cluster") {
                return;
            }

            const expansionZoom =
                clusterIndexRef.current.getClusterExpansionZoom(id);
            const members = clusterMemberIds(clusterIndexRef.current, id);
            /*
             * Frame where the members are now, not where the index saw them:
             * it is rebuilt only every few seconds while vehicles drive.
             */
            const byId = new Map(
                vehiclesRef.current.map((vehicle) => [vehicle.id, vehicle]),
            );
            let area: L.LatLngBounds | null = null;
            for (const memberId of members) {
                const vehicle = byId.get(memberId);
                if (!vehicle || !hasMapPosition(vehicle)) {
                    continue;
                }
                const at = L.latLng(vehicle.latitude, vehicle.longitude);
                const box =
                    vehicle.status === "DRIVING"
                        ? at.toBounds(DRIVING_FRAME_MARGIN_M * 2)
                        : L.latLngBounds(at, at);
                area = area ? area.extend(box) : box;
            }
            area ??= L.latLngBounds(
                [current.bounds.south, current.bounds.west],
                [current.bounds.north, current.bounds.east],
            );
            const open = clusterOpen({
                expansionZoom,
                fitZoom: map.getBoundsZoom(
                    area,
                    false,
                    L.point(
                        FLEET_CLUSTER_FIT_PADDING_PX * 2,
                        FLEET_CLUSTER_FIT_PADDING_PX * 2,
                    ),
                ),
                bounds: current.bounds,
            });
            const zoomDelta = Math.abs(open.zoom - map.getZoom());
            followRef.current.on = false;

            stackZoomRef.current = map.getZoom();
            if (open.list) {
                setStackIds(members);
            } else {
                stackZoomRef.current = null;
                setStackIds(null);
            }

            if (zoomDelta < 0.25) {
                return;
            }

            map.flyTo(area.getCenter(), open.zoom, {
                animate: true,
                duration: Math.min(1.1, Math.max(0.45, zoomDelta * 0.25)),
            });
        };

        const seen = new Set<number>();

        for (const item of clusters) {
            if (item.kind !== "cluster") {
                continue;
            }

            seen.add(item.id);
            const label = formatCount(item.count);
            const caption = clusterCaption(item, label);
            const signature = `${clusterSignature(item)}:${label}`;
            const existing = markers.get(item.id);

            if (existing) {
                if (
                    existing.latitude !== item.latitude ||
                    existing.longitude !== item.longitude
                ) {
                    const now = performance.now();
                    moveLayer(
                        map,
                        glidesRef.current,
                        existing.marker,
                        L.latLng(item.latitude, item.longitude),
                        now - existing.reportedAt,
                        CLUSTER_GLIDE,
                        glideRef.current,
                    );
                    existing.latitude = item.latitude;
                    existing.longitude = item.longitude;
                    existing.reportedAt = now;
                }

                if (existing.signature !== signature) {
                    existing.marker.setIcon(clusterIcon(item, label));
                    existing.marker.setTooltipContent(caption);
                    existing.marker
                        .getElement()
                        ?.setAttribute("aria-label", caption);
                    existing.signature = signature;
                }

                continue;
            }

            const marker = L.marker([item.latitude, item.longitude], {
                icon: clusterIcon(item, label),
                zIndexOffset: 600,
            });
            marker.bindTooltip(caption, {
                direction: "top",
                offset: [0, -clusterIconSize(item.count) / 2],
            });
            marker.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
                openCluster(item.id);
            });
            marker.on("add", () => {
                marker.getElement()?.setAttribute("aria-label", caption);
            });
            marker.addTo(map);
            markers.set(item.id, {
                marker,
                signature,
                latitude: item.latitude,
                longitude: item.longitude,
                reportedAt: performance.now(),
            });
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                entry.marker.remove();
                markers.delete(id);
            }
        }

        declutterRef.current();
    }, [clusters, mode, vehiclesRef]);

    useEffect(() => {
        const map = mapRef.current;
        const canvas = canvasRef.current;

        for (const marker of densityMarkersRef.current) {
            marker.remove();
        }
        densityMarkersRef.current = [];

        if (!map || !canvas || mode !== "density") {
            return;
        }

        densityMarkersRef.current = densityCells.map((cell) => {
            const marker = L.circleMarker(
                [cell.latitude, cell.longitude],
                {
                    radius: Math.min(32, 8 + Math.sqrt(cell.total) * 1.4),
                    color: vehicleStatusColor(densityStatus(cell)),
                    weight: 1.5,
                    fillColor: vehicleStatusColor(densityStatus(cell)),
                    fillOpacity: 0.28,
                    renderer: canvas,
                },
            );
            marker.bindTooltip(densityTooltip(cell), {
                direction: "top",
                offset: [0, -12],
            });
            marker.on("click", () => {
                map.fitBounds(
                    L.latLngBounds(
                        [cell.bbox.south, cell.bbox.west],
                        [cell.bbox.north, cell.bbox.east],
                    ),
                    { maxZoom: 16 },
                );
            });
            marker.addTo(map);
            return marker;
        });
    }, [densityCells, mode]);

    useEffect(() => {
        followRef.current = {
            on: selectedId !== null,
            at: performance.now(),
            lat: NaN,
            lng: NaN,
        };
    }, [selectedId]);

    // Pans with the selected vehicle over the same time its dot glides, so
    // the dot stays in the middle and the map moves evenly underneath.
    useEffect(() => {
        const map = mapRef.current;
        const follow = followRef.current;

        if (!map || !follow.on || selectedId === null) {
            return;
        }

        const vehicle = vehicles.find((item) => item.id === selectedId);

        if (
            !vehicle ||
            !hasMapPosition(vehicle) ||
            vehicle.status !== "DRIVING" ||
            (vehicle.latitude === follow.lat && vehicle.longitude === follow.lng)
        ) {
            return;
        }

        const now = performance.now();
        const gap = now - follow.at;
        follow.at = now;
        follow.lat = vehicle.latitude;
        follow.lng = vehicle.longitude;
        map.panTo(
            [vehicle.latitude, vehicle.longitude],
            prefersReducedMotion() || gap > DOT_GLIDE.ms
                ? { animate: false }
                : {
                      animate: true,
                      duration: Math.max(GLIDE_MIN_MS, gap) / 1000,
                      easeLinearity: 1,
                      noMoveStart: true,
                  },
        );
    }, [selectedId, vehicles]);

    useEffect(() => {
        const map = mapRef.current;

        if (
            !map ||
            !focusKey ||
            !focusPosition ||
            !hasMapPosition(focusPosition) ||
            lastFocusKeyRef.current === focusKey
        ) {
            return;
        }

        lastFocusKeyRef.current = focusKey;
        map.setView(
            [focusPosition.latitude, focusPosition.longitude],
            Math.max(map.getZoom(), 14),
        );
    }, [focusKey, focusPosition]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        const onClick = (event: L.LeafletMouseEvent) => {
            if (ignoreMapClickRef.current) {
                ignoreMapClickRef.current = false;
                return;
            }

            onPlaceDepotRef.current?.(event.latlng.lat, event.latlng.lng);
        };

        if (!placing) {
            return;
        }

        map.on("click", onClick);
        return () => {
            map.off("click", onClick);
        };
    }, [placing, onPlaceDepotRef]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        depotLayerRef.current?.remove();
        const group = L.layerGroup().addTo(map);
        depotLayerRef.current = group;

        const vehicleAt = (point: L.Point): number | null => {
            let best: number | null = null;
            let bestDistance = Infinity;
            for (const [id, { marker }] of markersRef.current) {
                const distance = map
                    .latLngToContainerPoint(marker.getLatLng())
                    .distanceTo(point);
                if (
                    distance <= marker.getRadius() + VEHICLE_HIT_TOLERANCE_PX &&
                    distance < bestDistance
                ) {
                    best = id;
                    bestDistance = distance;
                }
            }
            return best;
        };

        /*
         * Depot names sit just above the ring, in a pane below the vehicle
         * markers (600): a group count inside the depot always stays readable,
         * the name gives way.
         */
        if (!map.getPane(DEPOT_LABEL_PANE)) {
            map.createPane(DEPOT_LABEL_PANE).style.zIndex = "590";
        }

        /*
         * Just above the ring, but never closer to the centre than half the
         * largest group symbol, so a group in the depot never covers the name.
         */
        const labelAt = (latitude: number, longitude: number, radius: number) => {
            const centre = map.latLngToLayerPoint([latitude, longitude]);
            const edge = map.latLngToLayerPoint([
                latitude + radius / METERS_PER_DEGREE_LAT,
                longitude,
            ]);
            const lift = Math.max(centre.y - edge.y, CLUSTER_ICON_MAX / 2 + 2);
            return map.layerPointToLatLng(centre.subtract([0, lift]));
        };
        const placed: Array<{
            label: L.Tooltip;
            circle: L.Circle;
        }> = [];
        const replace = () => {
            for (const { label, circle } of placed) {
                const at = circle.getLatLng();
                label.setLatLng(labelAt(at.lat, at.lng, circle.getRadius()));
            }
        };
        /*
         * Vehicles first: a depot name that would touch a group symbol or a
         * vehicle dot is hidden until the view leaves room for it again.
         * Dots live on the canvas, so their boxes come from the map.
         */
        const declutter = () => {
            const origin = map.getContainer().getBoundingClientRect();
            const dots = [...markersRef.current.values()].map(({ marker }) => {
                const at = map.latLngToContainerPoint(marker.getLatLng());
                const size = marker.getRadius() + 2;
                return {
                    left: origin.left + at.x - size,
                    right: origin.left + at.x + size,
                    top: origin.top + at.y - size,
                    bottom: origin.top + at.y + size,
                };
            });
            const icons = [
                ...map
                    .getPane("markerPane")!
                    .querySelectorAll<HTMLElement>(".leaflet-marker-icon"),
            ]
                .filter((icon) => !icon.classList.contains(styles.depotHandle))
                .map((icon): Box => icon.getBoundingClientRect())
                .concat(dots);
            for (const { label } of placed) {
                const element = label.getElement();
                if (!element) {
                    continue;
                }
                element.removeAttribute("data-covered");
                const box = element.getBoundingClientRect();
                const covered = icons.some(
                    (icon) =>
                        box.left < icon.right &&
                        box.right > icon.left &&
                        box.top < icon.bottom &&
                        box.bottom > icon.top,
                );
                element.toggleAttribute("data-covered", covered);
            }
        };
        const onZoomEnd = () => {
            replace();
            declutter();
        };
        map.on("zoomend", onZoomEnd);
        declutterRef.current = declutter;

        const addLabel = (
            name: string,
            latitude: number,
            longitude: number,
            radius: number,
        ) =>
            L.tooltip({
                permanent: true,
                direction: "top",
                offset: [0, -2],
                pane: DEPOT_LABEL_PANE,
                className: styles.depotLabel,
                interactive: false,
            })
                .setLatLng(labelAt(latitude, longitude, radius))
                .setContent(name)
                .addTo(group);

        const drawHandle = (
            id: number | "new",
            latitude: number,
            longitude: number,
            circle: L.Circle,
            label: L.Tooltip | null,
        ) => {
            const handle = L.marker([latitude, longitude], {
                draggable: true,
                icon: L.divIcon({
                    className: styles.depotHandle,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                }),
                zIndexOffset: 800,
            });
            handle.on("drag", () => {
                const at = handle.getLatLng();
                circle.setLatLng(at);
                label?.setLatLng(labelAt(at.lat, at.lng, circle.getRadius()));
            });
            handle.on("dragend", () => {
                const at = handle.getLatLng();
                onMoveDepotRef.current?.(id, at.lat, at.lng);
            });
            handle.addTo(group);
        };

        for (const depot of depots) {
            const shown =
                draft?.id === depot.id
                    ? draft
                    : depot;
            const circle = L.circle([shown.latitude, shown.longitude], {
                radius: shown.radius_m,
                ...depotStyle(selectedDepotId === depot.id),
            });
            const label = addLabel(
                depot.name,
                shown.latitude,
                shown.longitude,
                shown.radius_m,
            );
            placed.push({ label, circle });
            circle.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
                // The ring lies above the vehicle canvas: a dot under the
                // pointer is what the click meant, not the depot around it.
                const hit = vehicleAt(event.containerPoint);
                if (hit !== null) {
                    onSelectRef.current(hit);
                    return;
                }
                if (lockDepotSelection) {
                    return;
                }
                onSelectDepotRef.current?.(depot.id);
            });
            circle.addTo(group);

            if (canEditDepots && draft?.id === depot.id) {
                drawHandle(
                    depot.id,
                    shown.latitude,
                    shown.longitude,
                    circle,
                    label,
                );
            }
        }

        if (draft?.id === "new") {
            const circle = L.circle([draft.latitude, draft.longitude], {
                radius: draft.radius_m,
                color: depotColor(),
                weight: 2,
                dashArray: "6 6",
                fillColor: depotColor(),
                fillOpacity: 0.12,
            });
            const label = draft.name.trim()
                ? addLabel(
                      draft.name.trim(),
                      draft.latitude,
                      draft.longitude,
                      draft.radius_m,
                  )
                : null;
            circle.addTo(group);
            if (label) {
                placed.push({ label, circle });
            }
            if (canEditDepots) {
                drawHandle("new", draft.latitude, draft.longitude, circle, label);
            }
        }

        declutter();

        return () => {
            map.off("zoomend", onZoomEnd);
            declutterRef.current = () => undefined;
            group.remove();
            if (depotLayerRef.current === group) {
                depotLayerRef.current = null;
            }
        };
    }, [
        depots,
        draft,
        selectedDepotId,
        canEditDepots,
        lockDepotSelection,
        onMoveDepotRef,
        onSelectDepotRef,
        onSelectRef,
    ]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !focusDepot) {
            return;
        }

        const depot = depots.find((item) => item.id === focusDepot.id);

        if (!depot) {
            return;
        }

        const key = `${focusDepot.id}:${focusDepot.nonce}`;

        if (lastDepotFocusRef.current === key) {
            return;
        }

        lastDepotFocusRef.current = key;
        map.fitBounds(
            L.latLng(depot.latitude, depot.longitude).toBounds(
                depot.radius_m * 2.4,
            ),
            { padding: [48, 48], maxZoom: 16 },
        );
    }, [depots, focusDepot]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !frame || lastFrameRef.current === frame.nonce) {
            return;
        }

        lastFrameRef.current = frame.nonce;
        map.fitBounds(
            [
                [frame.bounds.south, frame.bounds.west],
                [frame.bounds.north, frame.bounds.east],
            ],
            {
                padding: [
                    FLEET_CLUSTER_FIT_PADDING_PX,
                    FLEET_CLUSTER_FIT_PADDING_PX,
                ],
                maxZoom: FLEET_CLUSTER_MAX_ZOOM,
                animate: false,
            },
        );
    }, [frame]);

    return (
        <div
            className={`${styles.wrap} ${styles.wrapFill}${
                placing ? ` ${styles.placing}` : ""
            }`}
        >
            <div
                ref={containerRef}
                className={`${styles.map} ${styles.mapFill}`}
                role="img"
                aria-label={
                    mode === "density"
                        ? "Flottenkarte mit Depots und aggregierten Dichtezellen. Ein Dichtekreis vergrößert den Ausschnitt."
                        : "Flottenkarte mit Depots und Fahrzeuggruppen. Eine Gruppe vergrößert den Ausschnitt, ein Marker wählt das Fahrzeug."
                }
            />
            {stackVehicles.length > 0 && (
                <section
                    className={styles.vehicleList}
                    aria-label={
                        stackVehicles.length === 1
                            ? "1 Fahrzeug an dieser Stelle"
                            : `${formatCount(stackVehicles.length)} Fahrzeuge an dieser Stelle`
                    }
                >
                    <div className={styles.listHead}>
                        <strong>
                            {stackVehicles.length === 1
                                ? "1 Fahrzeug an dieser Stelle"
                                : `${formatCount(stackVehicles.length)} Fahrzeuge an dieser Stelle`}
                        </strong>
                        <button
                            type="button"
                            className={styles.listClose}
                            onClick={() => setStackIds(null)}
                        >
                            Schließen
                        </button>
                    </div>
                    <ul>
                        {stackVehicles.map((vehicle) => (
                            <li key={vehicle.id} id={`fleet-row-${vehicle.id}`}>
                                <button
                                    type="button"
                                    aria-current={
                                        vehicle.id === selectedId
                                            ? "true"
                                            : undefined
                                    }
                                    onClick={() => onSelect(vehicle.id)}
                                >
                                    <span>{vehicle.license_plate}</span>
                                    <span className={styles.who}>
                                        {vehicle.driver_name ?? "Kein Fahrer"}
                                    </span>
                                    <span>
                                        {vehicleStatusLabel(vehicle.status)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {stackVehicles.length === 0 && listedVehicles.length > 0 && (
                <details
                    className={styles.vehicleList}
                    open={listOpen}
                    onToggle={(event) =>
                        setListOpen(event.currentTarget.open)
                    }
                >
                    <summary>
                        Fahrzeugliste ({formatCount(listedVehicles.length)})
                    </summary>
                    <ul>
                        {listedVehicles.map((vehicle) => (
                            <li key={vehicle.id} id={`fleet-row-${vehicle.id}`}>
                                <button
                                    type="button"
                                    aria-current={
                                        vehicle.id === selectedId
                                            ? "true"
                                            : undefined
                                    }
                                    onClick={() => onSelect(vehicle.id)}
                                >
                                    <span>{vehicle.license_plate}</span>
                                    <span>
                                        {vehicleStatusLabel(vehicle.status)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
};
