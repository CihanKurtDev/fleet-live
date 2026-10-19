import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    decodePolyline,
    type FleetDensityCell,
    type FleetPosition,
    type GeoBBox,
    type VehicleStatus,
} from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useVehicles } from "../../context/vehiclesContext";
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
    FLEET_CLUSTER_FIT_PADDING_PX,
    FLEET_CLUSTER_MAX_ZOOM,
    clusterMemberIds,
    clusterOpen,
    isInsideBBox,
    type FleetCluster,
    type StatusCounts,
} from "./clusterFleet";
import { useClusterIndex } from "./useClusterIndex";
import { PositionTweens, type RoadPoint } from "./positionTween";
import { SmoothDot, SmoothMarker } from "./smoothMarkers";
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
/** Smallest on-screen depot ring in px (radius); the circle itself is metres. */
const DEPOT_MIN_RING_PX = 14;

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

type MarkerRecord = {
    marker: L.CircleMarker;
    status: VehicleStatus;
    selected: boolean;
    /** Member of the group that was opened last (drawn with a ring). */
    grouped: boolean;
    /** Drawn at its final position; the frame loop leaves it alone until it moves again. */
    settled: boolean;
    /** A dot that just came out of a group starts at the group's symbol and eases out. */
    ease: Shift | null;
};

/** Where a symbol starts, relative to where it belongs, and when it started. */
type Shift = { lat: number; lng: number; start: number };

/**
 * A symbol that is going away (a group that split or merged, a dot that went
 * into a group). It stays for a moment, slides towards what replaces it and
 * fades, so a zoom changes the picture continuously instead of swapping it.
 */
type Leaving = {
    marker: L.Marker | L.CircleMarker;
    from: L.LatLng;
    start: number;
    members: number[];
    /** What replaces it, found once the new symbols exist. */
    target: { kind: "cluster" | "vehicle"; key: number } | null;
};

/*
 * Vehicles report every few seconds. Where a vehicle is shown at any moment
 * comes from `PositionTweens` (one report behind, always on its way): dots are
 * drawn at that position every frame, the group index is built from it (about
 * once a second), a group symbol rides at the middle of its members' shown
 * positions, and the camera that follows the selected vehicle pans over the
 * same stretch in the same time.
 */
const GLIDE_MIN_MS = 250;
/** A click on a vehicle zooms to here (the scale bar shows 3 km), never out. */
const VEHICLE_CLICK_ZOOM = 11;
const VEHICLE_FLIGHT_MS = 800;
/**
 * When the index is rebuilt a group may gain or lose a member and its middle
 * shifts; the symbol eases over that shift instead of jumping.
 */
const CLUSTER_EASE_MS = 600;
/** Groups splitting or merging, dots leaving or joining one. */
const TRANSITION_MS = 450;
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
    /** The group's id in the current index (changes when the index is rebuilt). */
    clusterId: number;
    signature: string;
    /** Vehicles in the group, as of the last index; the symbol rides at their middle. */
    members: number[];
    /** The shift left over from the last rebuild, easing out. */
    ease: Shift | null;
    /** When it appeared (it fades in); null once it is fully there. */
    born: number | null;
};

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

function clusterSignature(
    item: Extract<FleetCluster, { kind: "cluster" }>,
): string {
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

function clusterCaption(
    item: Extract<FleetCluster, { kind: "cluster" }>,
    label: string,
): string {
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
    /**
     * Members of the group that was opened last. A flight can open the
     * neighbours too (the zoom is too close for the group alone); the ring
     * shows which dots belong to the clicked group. It ends when the user
     * zooms back out past where the group was, or opens another group.
     */
    const [groupIds, setGroupIds] = useState<ReadonlySet<number> | null>(null);
    const groupZoomRef = useRef<number | null>(null);
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
    /** Where each vehicle is shown right now (see PositionTweens). */
    const tweensRef = useRef(new PositionTweens());
    const { subscribeTripPath } = useVehicles();
    const leavingRef = useRef<Leaving[]>([]);
    /**
     * The selected vehicle stays in the middle while it drives, until the user
     * drags or zooms; selecting it again resumes (like the detail map).
     */
    const followRef = useRef({ on: false, lat: NaN, lng: NaN });
    /** Set by a click on a vehicle (dot or list row): the next follow step zooms in. */
    const zoomOnSelectRef = useRef(false);
    /** Until then a flight to the clicked vehicle runs; follow pans would cut it short. */
    const flyUntilRef = useRef(0);
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
        inViewVehicles.length <= MAP_VEHICLE_LIST_LIMIT ? inViewVehicles : [];
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
    const clusterIndex = useClusterIndex(clusterPoints, (latest) => {
        const now = performance.now();

        return latest.map((point) => {
            const shown = tweensRef.current.at(point.id, now);

            return shown
                ? { ...point, latitude: shown.lat, longitude: shown.lng }
                : point;
        });
    });
    const clusters = useMemo((): FleetCluster[] => {
        if (!view || mode !== "positions") {
            return [];
        }
        // Grouping is switched off: every vehicle in view is its own dot.
        // To bring groups back, use `clustersFromIndex(clusterIndex, view.bbox, view.zoom)`
        // from ./clusterFleet here.
        const shown: FleetCluster[] = inViewVehicles.flatMap((vehicle) =>
            hasMapPosition(vehicle) && vehicle.id !== selectedVehicle?.id
                ? [
                      {
                          kind: "vehicle" as const,
                          id: vehicle.id,
                          latitude: vehicle.latitude,
                          longitude: vehicle.longitude,
                      },
                  ]
                : [],
        );
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
    }, [inViewVehicles, mode, selectedVehicle, view]);
    const clusterIndexRef = useRef(clusterIndex);
    const clustersRef = useRef(clusters);
    // Handlers read these; they follow the render before any other effect runs.
    useLayoutEffect(() => {
        clusterIndexRef.current = clusterIndex;
        clustersRef.current = clusters;
    }, [clusterIndex, clusters]);
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
        if (
            view === null ||
            stackIds === null ||
            stackZoomRef.current === null
        ) {
            return;
        }

        if (view.zoom < stackZoomRef.current - 0.5) {
            stackZoomRef.current = null;
            setStackIds(null);
        }
    }, [stackIds, view]);

    useEffect(() => {
        if (
            view === null ||
            groupIds === null ||
            groupZoomRef.current === null
        ) {
            return;
        }

        if (view.zoom < groupZoomRef.current - 0.5) {
            groupZoomRef.current = null;
            setGroupIds(null);
        }
    }, [groupIds, view]);

    // A vehicle that appears in the side list opens it (the user may close it again).
    const [wasInSideList, setWasInSideList] = useState(selectedInSideList);
    if (selectedInSideList !== wasInSideList) {
        setWasInSideList(selectedInSideList);

        if (selectedInSideList) {
            setListOpen(true);
        }
    }

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

        let glideFrame = 0;
        /*
         * While the map zooms, Leaflet keeps the drawn layers at the old scale
         * and stretches them; moving a dot then draws it at the new scale into
         * the stretched canvas, and for a moment the vehicles ran beside the
         * road (a second chain of dots). Dots wait until the zoom has ended
         * and then jump to where they are by then.
         */
        let zooming = false;
        /*
         * Over a whole zoom level or more (a flight to a clicked vehicle) the
         * stretched canvas blew the dots up to big blobs under the selected
         * symbol, which Leaflet keeps at its size. The dots step out for the
         * flight and come back, drawn at the new scale, when it ends.
         */
        const dotLayer = (canvas as unknown as { _container?: HTMLElement })
            ._container;
        if (dotLayer) {
            dotLayer.style.transition = "opacity 180ms ease-out";
        }
        let zoomFrom = map.getZoom();
        const onZoomStart = () => {
            zooming = true;
            zoomFrom = map.getZoom();
        };
        // A flight reports every step (`zoom`); a wheel or button zoom
        // announces its target before the animation (`zoomanim`).
        const onZoomStep = (event: L.LeafletEvent) => {
            const target = (event as L.ZoomAnimEvent).zoom ?? map.getZoom();

            if (dotLayer && Math.abs(target - zoomFrom) >= 1) {
                // Hard cut: a fade would show the stretched dots while it runs.
                dotLayer.style.transition = "none";
                dotLayer.style.opacity = "0";
            }
        };
        const onZoomEnd = () => {
            zooming = false;
            if (dotLayer) {
                dotLayer.style.transition = "opacity 180ms ease-out";
                dotLayer.style.opacity = "";
            }
            for (const entry of markersRef.current.values()) {
                entry.settled = false;
            }
            glideRef.current();
        };
        map.on("zoomstart", onZoomStart);
        map.on("zoom zoomanim", onZoomStep);
        map.on("zoomend", onZoomEnd);
        const glideStep = (now: number) => {
            glideFrame = 0;
            let moving = false;

            if (zooming) {
                glideFrame = requestAnimationFrame(glideStep);
                return;
            }

            const tweens = tweensRef.current;

            // A group rides at the middle of its members as they are shown now.
            for (const entry of clusterMarkersRef.current.values()) {
                const centre = tweens.centre(entry.members, now);

                if (!centre) {
                    continue;
                }

                let lat = centre.lat;
                let lng = centre.lng;

                if (entry.ease) {
                    const left =
                        1 -
                        Math.min(1, (now - entry.ease.start) / CLUSTER_EASE_MS);

                    if (left > 0) {
                        // Quadratic ease-out: the shift fades fast at first, gently at the end.
                        lat += entry.ease.lat * left * left;
                        lng += entry.ease.lng * left * left;
                        moving = true;
                    } else {
                        entry.ease = null;
                    }
                }

                entry.marker.setLatLng([lat, lng]);

                if (entry.born !== null) {
                    const age = (now - entry.born) / TRANSITION_MS;

                    entry.marker.setOpacity(Math.min(1, age));

                    if (age >= 1) {
                        entry.born = null;
                    } else {
                        moving = true;
                    }
                }

                if (!centre.done) {
                    moving = true;
                }
            }

            for (const [id, entry] of markersRef.current) {
                const shown = tweens.at(id, now);

                if (!shown) {
                    continue;
                }

                let lat = shown.lat;
                let lng = shown.lng;
                let easing = false;

                if (entry.ease) {
                    const left =
                        1 -
                        Math.min(1, (now - entry.ease.start) / TRANSITION_MS);

                    if (left > 0) {
                        lat += entry.ease.lat * left * left;
                        lng += entry.ease.lng * left * left;
                        easing = true;
                    } else {
                        entry.ease = null;
                    }
                }

                if (shown.done && entry.settled && !easing) {
                    continue;
                }

                entry.marker.setLatLng([lat, lng]);
                entry.settled = shown.done && !easing;

                if (!shown.done || easing) {
                    moving = true;
                }
            }

            // Symbols that are going away slide towards what replaces them and fade.
            const leaving = leavingRef.current;

            if (leaving.length > 0) {
                const kept: Leaving[] = [];

                for (const item of leaving) {
                    const age = (now - item.start) / TRANSITION_MS;
                    const to = item.target
                        ? (item.target.kind === "cluster"
                              ? clusterMarkersRef.current.get(item.target.key)
                              : markersRef.current.get(item.target.key)
                          )?.marker.getLatLng()
                        : undefined;

                    if (age >= 1) {
                        item.marker.remove();
                        continue;
                    }

                    const p = age * age * (3 - 2 * age);

                    item.marker.setLatLng(
                        to
                            ? [
                                  item.from.lat + (to.lat - item.from.lat) * p,
                                  item.from.lng + (to.lng - item.from.lng) * p,
                              ]
                            : item.from,
                    );

                    if (item.marker instanceof L.Marker) {
                        item.marker.setOpacity(1 - age);
                    }

                    kept.push(item);
                }

                leavingRef.current = kept;

                if (kept.length > 0) {
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
                entry.marker.setStyle(
                    markerStyle(entry.status, entry.selected, entry.grouped),
                );
            }
            for (const marker of densityMarkersRef.current) {
                marker.setStyle({ color: stroke });
            }
        });

        const markers = markersRef.current;

        return () => {
            cancelAnimationFrame(glideFrame);
            glideRef.current = () => undefined;
            routesGone = true;
            routeLines?.remove();
            resizeObserver.disconnect();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            map.off("moveend", onUserView);
            map.off("dragstart", stopFollow);
            map.off("zoomstart", onZoomStart);
            map.off("zoom zoomanim", onZoomStep);
            map.off("zoomend", onZoomEnd);
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
            for (const item of leavingRef.current) {
                item.marker.remove();
            }
            leavingRef.current = [];
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

    /** Where each vehicle's group symbol is drawn right now (for symbols that come out of it). */
    const groupSpots = () => {
        const spots = new Map<number, L.LatLng>();

        for (const record of clusterMarkersRef.current.values()) {
            const at = record.marker.getLatLng();

            for (const id of record.members) {
                spots.set(id, at);
            }
        }

        return spots;
    };

    /*
     * The road points each report brings (`path_delta`), kept until the report
     * itself reaches the map, so a dot glides along the road and not across
     * bends. The stream calls this before the report is rendered; a suffix is
     * relative to the last report (the point the vehicle is heading to now).
     */
    const roadRef = useRef(new Map<number, { points: RoadPoint[]; newTrip: boolean }>());

    useEffect(
        () =>
            subscribeTripPath((id, delta, reset) => {
                const decoded = decodePolyline(delta);
                const pending = roadRef.current.get(id);
                // Two reports before the map rendered: the second continues the first.
                const from = reset
                    ? undefined
                    : (pending?.points[pending.points.length - 1] ??
                      tweensRef.current.heading(id));

                if (!reset && !from) {
                    return;
                }

                // The chain is built on the 5-decimal grid of the stored path.
                const baseLat = from ? Math.round(from.lat * 1e5) / 1e5 : 0;
                const baseLng = from ? Math.round(from.lng * 1e5) / 1e5 : 0;
                const points = decoded.map((point) => ({
                    lat: baseLat + point.lat,
                    lng: baseLng + point.lng,
                }));

                roadRef.current.set(
                    id,
                    pending && !reset
                        ? {
                              points: [...pending.points, ...points],
                              newTrip: pending.newTrip,
                          }
                        : { points, newTrip: reset },
                );
            }),
        [subscribeTripPath],
    );

    // Every report starts the stretch its vehicle is shown on. Declared before
    // the effects that draw, so they see the new stretch.
    useEffect(() => {
        const tweens = tweensRef.current;
        const now = performance.now();
        const jump = prefersReducedMotion();
        const ids = new Set<number>();
        const roads = roadRef.current;

        for (const vehicle of vehicles) {
            if (!hasMapPosition(vehicle)) {
                continue;
            }

            ids.add(vehicle.id);
            const road = roads.get(vehicle.id);
            roads.delete(vehicle.id);

            if (
                tweens.report(
                    vehicle.id,
                    vehicle.latitude,
                    vehicle.longitude,
                    now,
                    jump,
                    road?.points,
                    road?.newTrip,
                )
            ) {
                const entry = markersRef.current.get(vehicle.id);

                if (entry) {
                    entry.settled = false;
                }
            }
        }

        tweens.retain(ids);
        glideRef.current();
    }, [vehicles]);

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
            const shown = tweensRef.current.at(vehicle.id, performance.now());
            const at = shown
                ? L.latLng(shown.lat, shown.lng)
                : L.latLng(vehicle.latitude, vehicle.longitude);
            const selected = vehicle.id === selectedId;
            const grouped = groupIds?.has(vehicle.id) ?? false;

            if (!existing) {
                const marker = new SmoothDot(at, {
                    ...markerStyle(vehicle.status, selected, grouped),
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
                    zoomOnSelectRef.current = true;
                    onSelectRef.current(vehicle.id);
                });
                marker.addTo(map);
                // A dot that comes out of a group starts at the group's symbol.
                const from = !prefersReducedMotion()
                    ? groupSpots().get(vehicle.id)
                    : undefined;
                markers.set(vehicle.id, {
                    marker,
                    status: vehicle.status,
                    selected,
                    grouped,
                    settled: shown?.done ?? true,
                    ease: from
                        ? {
                              lat: from.lat - at.lat,
                              lng: from.lng - at.lng,
                              start: performance.now(),
                          }
                        : null,
                });
                glideRef.current();
                continue;
            }

            if (
                existing.status !== vehicle.status ||
                existing.selected !== selected ||
                existing.grouped !== grouped
            ) {
                existing.marker.setStyle(
                    markerStyle(vehicle.status, selected, grouped),
                );
                existing.marker.setTooltipContent(markerTooltip(vehicle));
                existing.status = vehicle.status;
                existing.selected = selected;
                existing.grouped = grouped;
            }
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                // A dot that goes into a group slides to it (the group effect
                // finds which one) instead of vanishing.
                if (prefersReducedMotion() || id === selectedId) {
                    entry.marker.remove();
                } else {
                    leavingRef.current.push({
                        marker: entry.marker,
                        from: entry.marker.getLatLng(),
                        start: performance.now(),
                        members: [id],
                        target: null,
                    });
                    glideRef.current();
                }
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
            const marker = new SmoothMarker(dot.marker.getLatLng(), {
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
                zoomOnSelectRef.current = true;
                followRef.current.lat = NaN;
                onSelectRef.current(id);
            });
            marker.addTo(map);
            selectedMarkerRef.current = { marker, id, status: dot.status };
        }
        syncSelectedMarker();

        declutterRef.current();
    }, [clusters, groupIds, mode, onSelectRef, selectedId, vehicles]);

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

            // Mark the opened group's members; the neighbours that open with them stay plain.
            groupZoomRef.current = map.getZoom();
            setGroupIds(new Set(members));

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
        // Where each vehicle's old group symbol is, before this update changes them.
        const spots = groupSpots();

        for (const item of clusters) {
            if (item.kind !== "cluster") {
                continue;
            }

            seen.add(item.anchor);
            const label = formatCount(item.count);
            const caption = clusterCaption(item, label);
            const signature = `${clusterSignature(item)}:${label}`;
            const existing = markers.get(item.anchor);

            const members = clusterMemberIds(clusterIndexRef.current, item.id);
            const now = performance.now();
            const centre = tweensRef.current.centre(members, now);

            if (existing) {
                // The index was rebuilt: the same group has a new id and may
                // have gained or lost a vehicle. Its symbol keeps riding at
                // the middle of its members; the shift that makes eases out.
                const before = existing.marker.getLatLng();

                existing.clusterId = item.id;
                existing.members = members;
                existing.ease =
                    centre && !prefersReducedMotion()
                        ? {
                              lat: before.lat - centre.lat,
                              lng: before.lng - centre.lng,
                              start: now,
                          }
                        : null;
                glideRef.current();

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

            // A new group that comes out of an old one (a zoom split it)
            // starts at the old symbol and fades in while it moves out.
            const still = prefersReducedMotion();
            const origin = still
                ? undefined
                : members.map((id) => spots.get(id)).find(Boolean);
            const marker = new SmoothMarker(
                [centre?.lat ?? item.latitude, centre?.lng ?? item.longitude],
                {
                    icon: clusterIcon(item, label),
                    zIndexOffset: 600,
                    opacity: still ? 1 : 0,
                },
            );
            marker.bindTooltip(caption, {
                direction: "top",
                offset: [0, -clusterIconSize(item.count) / 2],
            });
            marker.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
                const record = markers.get(item.anchor);

                if (record) {
                    openCluster(record.clusterId);
                }
            });
            marker.on("add", () => {
                marker.getElement()?.setAttribute("aria-label", caption);
            });
            marker.addTo(map);
            markers.set(item.anchor, {
                marker,
                clusterId: item.id,
                signature,
                members,
                ease:
                    origin && centre
                        ? {
                              lat: origin.lat - centre.lat,
                              lng: origin.lng - centre.lng,
                              start: now,
                          }
                        : null,
                born: still ? null : now,
            });
            glideRef.current();
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                // A group that split or merged slides towards what replaces
                // it and fades; it is not swapped in one frame.
                if (prefersReducedMotion()) {
                    entry.marker.remove();
                } else {
                    leavingRef.current.push({
                        marker: entry.marker,
                        from: entry.marker.getLatLng(),
                        start: performance.now(),
                        members: entry.members,
                        target: null,
                    });
                }
                markers.delete(id);
            }
        }

        // Find what replaces each symbol that is going away: the group that
        // now holds its vehicles, else the dot one of them became.
        if (leavingRef.current.some((item) => item.target === null)) {
            const groupOf = new Map<number, number>();

            for (const [anchor, record] of markers) {
                for (const id of record.members) {
                    groupOf.set(id, anchor);
                }
            }

            leavingRef.current = leavingRef.current.map((item): Leaving => {
                if (item.target) {
                    return item;
                }

                const anchor = item.members
                    .map((id) => groupOf.get(id))
                    .find((key) => key !== undefined);
                const dotId = item.members.find((id) =>
                    markersRef.current.has(id),
                );

                if (anchor !== undefined) {
                    return {
                        ...item,
                        target: { kind: "cluster", key: anchor },
                    };
                }

                return dotId !== undefined
                    ? { ...item, target: { kind: "vehicle", key: dotId } }
                    : item;
            });

            glideRef.current();
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
            const marker = L.circleMarker([cell.latitude, cell.longitude], {
                radius: Math.min(32, 8 + Math.sqrt(cell.total) * 1.4),
                color: vehicleStatusColor(densityStatus(cell)),
                weight: 1.5,
                fillColor: vehicleStatusColor(densityStatus(cell)),
                fillOpacity: 0.28,
                renderer: canvas,
            });
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
            lat: NaN,
            lng: NaN,
        };
    }, [selectedId]);

    // Pans to where the selected vehicle is heading, over the stretch its dot
    // is gliding on (the same start and the same time), so the dot stays in
    // the middle and the map moves evenly underneath.
    useEffect(() => {
        const map = mapRef.current;
        const follow = followRef.current;

        if (!map || !follow.on || selectedId === null) {
            return;
        }

        const vehicle = vehicles.find((item) => item.id === selectedId);

        // A click on a vehicle brings it close: the 3 km scale, or nearer if
        // the map already is. The follow pans wait until the flight is over.
        if (zoomOnSelectRef.current && vehicle && hasMapPosition(vehicle)) {
            zoomOnSelectRef.current = false;
            const heading = tweensRef.current.heading(vehicle.id);
            const zoom = Math.max(map.getZoom(), VEHICLE_CLICK_ZOOM);
            const target: L.LatLngExpression = heading
                ? [heading.lat, heading.lng]
                : [vehicle.latitude, vehicle.longitude];

            follow.lat = vehicle.latitude;
            follow.lng = vehicle.longitude;

            if (prefersReducedMotion()) {
                map.setView(target, zoom, { animate: false });
            } else {
                flyUntilRef.current = performance.now() + VEHICLE_FLIGHT_MS;
                map.flyTo(target, zoom, {
                    duration: VEHICLE_FLIGHT_MS / 1000,
                });
            }
            return;
        }

        if (
            !vehicle ||
            !hasMapPosition(vehicle) ||
            vehicle.status !== "DRIVING" ||
            performance.now() < flyUntilRef.current ||
            (vehicle.latitude === follow.lat &&
                vehicle.longitude === follow.lng)
        ) {
            return;
        }

        const heading = tweensRef.current.heading(vehicle.id);
        const ms = heading?.ms ?? 0;

        follow.lat = vehicle.latitude;
        follow.lng = vehicle.longitude;
        map.panTo(
            heading
                ? [heading.lat, heading.lng]
                : [vehicle.latitude, vehicle.longitude],
            prefersReducedMotion() || ms <= 0
                ? { animate: false }
                : {
                      animate: true,
                      duration: Math.max(GLIDE_MIN_MS, ms) / 1000,
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
        const labelAt = (
            latitude: number,
            longitude: number,
            radius: number,
        ) => {
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
        const rings: Array<{ marker: L.CircleMarker; circle: L.Circle }> = [];
        const showRings = () => {
            for (const { marker, circle } of rings) {
                const at = circle.getLatLng();
                const centre = map.latLngToLayerPoint(at);
                const edge = map.latLngToLayerPoint([
                    at.lat + circle.getRadius() / METERS_PER_DEGREE_LAT,
                    at.lng,
                ]);
                const small = centre.y - edge.y < DEPOT_MIN_RING_PX;
                marker.setStyle({ opacity: small ? 1 : 0 });
                marker
                    .getElement()
                    ?.setAttribute("pointer-events", small ? "auto" : "none");
            }
        };
        const replace = () => {
            showRings();
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
            const shown = draft?.id === depot.id ? draft : depot;
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

            /*
             * Zoomed out the real circle (1–2 km) is under a pixel. A ring of
             * fixed size marks the place until the circle is bigger than it.
             */
            const marker = L.circleMarker([shown.latitude, shown.longitude], {
                radius: DEPOT_MIN_RING_PX,
                ...depotStyle(selectedDepotId === depot.id),
                fill: false,
                weight: 2,
            });
            marker.on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                ignoreMapClickRef.current = true;
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
            marker.addTo(group);
            rings.push({ marker, circle });

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
                drawHandle(
                    "new",
                    draft.latitude,
                    draft.longitude,
                    circle,
                    label,
                );
            }
        }

        showRings();
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
                                    onClick={() => {
                                        zoomOnSelectRef.current = true;
                                        followRef.current.on = true;
                                        onSelect(vehicle.id);
                                    }}
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
                    onToggle={(event) => setListOpen(event.currentTarget.open)}
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
                                    onClick={() => {
                                        zoomOnSelectRef.current = true;
                                        followRef.current.on = true;
                                        onSelect(vehicle.id);
                                    }}
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
