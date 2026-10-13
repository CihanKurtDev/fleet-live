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
import { createThemedMap, prefersDark } from "./leafletMap";
import {
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
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;
const BOUNDS_DEBOUNCE_MS = 200;
/** Nur anzeigen, wenn der Ausschnitt die Liste vollständig fasst. */
const MAP_VEHICLE_LIST_LIMIT = 100;

type MarkerRecord = {
    marker: L.CircleMarker;
    status: VehicleStatus;
    selected: boolean;
    latitude: number;
    longitude: number;
};

const roundCoord = (value: number) => Math.round(value * 10_000) / 10_000;

type ClusterMarkerRecord = {
    marker: L.Marker;
    signature: string;
};

function clusterGradient(counts: StatusCounts): string {
    const total = MAP_STATUS_LEGEND.reduce(
        (sum, status) => sum + (counts[status] ?? 0),
        0,
    );

    if (total <= 0) {
        return "#1f4b73";
    }

    let cursor = 0;
    const stops: string[] = [];

    for (const status of MAP_STATUS_LEGEND) {
        const share = (counts[status] ?? 0) / total;

        if (share <= 0) {
            continue;
        }

        const next = cursor + share * 100;
        stops.push(`${VEHICLE_STATUS_COLORS[status]} ${cursor}% ${next}%`);
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

const markerStroke = () => (prefersDark() ? "#16171d" : "#ffffff");

const markerStyle = (status: VehicleStatus, selected: boolean) => ({
    radius: selected ? 8 : 6,
    color: markerStroke(),
    weight: selected ? 3 : 2,
    fillColor: VEHICLE_STATUS_COLORS[status],
    fillOpacity: 1,
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

export type MapDepot = {
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
    const lastDepotFocusRef = useRef("");
    const listedVehicles =
        inViewVehicles.length <= MAP_VEHICLE_LIST_LIMIT
            ? inViewVehicles
            : [];
    const clusterPoints = useMemo(
        () =>
            vehicles.flatMap((vehicle) =>
                hasMapPosition(vehicle)
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
        [vehicles],
    );
    const clusterIndex = useClusterIndex(clusterPoints);
    const clusters = useMemo(
        () =>
            view && mode === "positions"
                ? clustersFromIndex(clusterIndex, view.bbox, view.zoom)
                : [],
        [clusterIndex, mode, view],
    );
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
        });
        const map = themed.map;
        const canvas = L.canvas({ padding: 0.3 });
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

        map.on("dragend", onUserView);
        map.on("zoomend", onUserView);
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

        themed.onThemeChange(() => {
            const stroke = markerStroke();
            for (const entry of markersRef.current.values()) {
                entry.marker.setStyle({ color: stroke });
            }
            for (const marker of densityMarkersRef.current) {
                marker.setStyle({ color: stroke });
            }
        });

        const markers = markersRef.current;

        return () => {
            resizeObserver.disconnect();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            map.off("dragend", onUserView);
            map.off("zoomend", onUserView);
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
                    onSelectRef.current(vehicle.id);
                });
                marker.addTo(map);
                markers.set(vehicle.id, {
                    marker,
                    status: vehicle.status,
                    selected,
                    latitude: vehicle.latitude,
                    longitude: vehicle.longitude,
                });
                continue;
            }

            if (
                existing.latitude !== vehicle.latitude ||
                existing.longitude !== vehicle.longitude
            ) {
                existing.marker.setLatLng(at);
                existing.latitude = vehicle.latitude;
                existing.longitude = vehicle.longitude;
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
    }, [clusters, mode, onSelectRef, selectedId, vehicles]);

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
            const open = clusterOpen({
                expansionZoom,
                bounds: current.bounds,
            });
            const zoomDelta = Math.abs(open.zoom - map.getZoom());

            stackZoomRef.current = map.getZoom();
            if (open.list) {
                setStackIds(clusterMemberIds(clusterIndexRef.current, id));
            } else {
                stackZoomRef.current = null;
                setStackIds(null);
            }

            if (zoomDelta < 0.25) {
                return;
            }

            map.flyTo([current.latitude, current.longitude], open.zoom, {
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
                existing.marker.setLatLng([item.latitude, item.longitude]);

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
            markers.set(item.id, { marker, signature });
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                entry.marker.remove();
                markers.delete(id);
            }
        }
    }, [clusters, mode]);

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
                    color: markerStroke(),
                    weight: 2,
                    fillColor: VEHICLE_STATUS_COLORS[densityStatus(cell)],
                    fillOpacity: 0.72,
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

        const drawHandle = (
            id: number | "new",
            latitude: number,
            longitude: number,
            circle: L.Circle,
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
                circle.setLatLng(handle.getLatLng());
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
                color: "#5b7c99",
                weight: selectedDepotId === depot.id ? 3 : 1.5,
                fillColor: "#5b7c99",
                fillOpacity: 0.14,
            });
            circle.bindTooltip(depot.name, {
                permanent: true,
                direction: "center",
                className: styles.depotLabel,
            });
            circle.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
                if (lockDepotSelection) {
                    return;
                }
                onSelectDepotRef.current?.(depot.id);
            });
            circle.addTo(group);

            if (canEditDepots && draft?.id === depot.id) {
                drawHandle(depot.id, shown.latitude, shown.longitude, circle);
            }
        }

        if (draft?.id === "new") {
            const circle = L.circle([draft.latitude, draft.longitude], {
                radius: draft.radius_m,
                color: "#5b7c99",
                weight: 2,
                dashArray: "6 6",
                fillColor: "#5b7c99",
                fillOpacity: 0.12,
            });
            if (draft.name.trim()) {
                circle.bindTooltip(draft.name.trim(), {
                    permanent: true,
                    direction: "center",
                    className: styles.depotLabel,
                });
            }
            circle.addTo(group);
            if (canEditDepots) {
                drawHandle("new", draft.latitude, draft.longitude, circle);
            }
        }

        return () => {
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
