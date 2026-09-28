import { useEffect, useRef } from "react";
import type {
    FleetDensityCell,
    FleetPosition,
    GeoBBox,
    VehicleStatus,
} from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useLatestRef } from "../../hooks/useLatestRef";
import { createThemedMap, prefersDark } from "./leafletMap";
import { MapStatusLegend } from "./MapStatusLegend";
import {
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;
const BOUNDS_DEBOUNCE_MS = 200;

type MarkerRecord = {
    marker: L.CircleMarker;
    status: VehicleStatus;
    latitude: number;
    longitude: number;
};

const roundCoord = (value: number) => Math.round(value * 10_000) / 10_000;

const boundsToBBox = (bounds: L.LatLngBounds): GeoBBox => ({
    west: roundCoord(Math.max(-180, bounds.getWest())),
    south: roundCoord(Math.max(-90, bounds.getSouth())),
    east: roundCoord(Math.min(180, bounds.getEast())),
    north: roundCoord(Math.min(90, bounds.getNorth())),
});

const markerStroke = () => (prefersDark() ? "#16171d" : "#ffffff");

const markerStyle = (status: VehicleStatus) => ({
    radius: 6,
    color: markerStroke(),
    weight: 2,
    fillColor: VEHICLE_STATUS_COLORS[status],
    fillOpacity: 1,
});

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

type FleetMapProps = {
    vehicles: FleetPosition[];
    densityCells: FleetDensityCell[];
    mode: "positions" | "density";
    initialBbox?: GeoBBox | null;
    focusKey?: string | null;
    focusPosition?: FleetPosition | null;
    onBoundsChange: (bbox: GeoBBox) => void;
    onSelect: (id: number) => void;
};

export const FleetMap = ({
    vehicles,
    densityCells,
    mode,
    initialBbox = null,
    focusKey = null,
    focusPosition = null,
    onBoundsChange,
    onSelect,
}: FleetMapProps) => {
    const vehiclesByStatus = (
        mode === "density" ? densityCells : vehicles
    ).reduce<Partial<Record<VehicleStatus, number>>>(
        (counts, item) => {
            if ("counts" in item) {
                for (const [status, count] of Object.entries(item.counts)) {
                    const typedStatus = status as VehicleStatus;
                    counts[typedStatus] =
                        (counts[typedStatus] ?? 0) + count;
                }
            } else {
                counts[item.status] = (counts[item.status] ?? 0) + 1;
            }
            return counts;
        },
        {},
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const canvasRef = useRef<L.Canvas | null>(null);
    const markersRef = useRef(new Map<number, MarkerRecord>());
    const densityMarkersRef = useRef<L.CircleMarker[]>([]);
    const lastFocusKeyRef = useRef<string | null>(null);
    const initialBboxRef = useRef(initialBbox);
    const onBoundsChangeRef = useLatestRef(onBoundsChange);
    const onSelectRef = useLatestRef(onSelect);
    const listedVehicles = vehicles.slice(0, 100);

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
        emitBounds();
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
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            map.off("dragend", onUserView);
            map.off("zoomend", onUserView);
            for (const entry of markers.values()) {
                entry.marker.remove();
            }
            markers.clear();
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

        if (!map || !canvas) {
            return;
        }

        const markers = markersRef.current;
        const seen = new Set<number>();

        for (const vehicle of vehicles) {
            seen.add(vehicle.id);
            const existing = markers.get(vehicle.id);
            const at = L.latLng(vehicle.latitude, vehicle.longitude);

            if (!existing) {
                const marker = L.circleMarker(at, {
                    ...markerStyle(vehicle.status),
                    renderer: canvas,
                });
                marker.bindTooltip(markerTooltip(vehicle), {
                    direction: "top",
                    offset: [0, -10],
                });
                marker.on("click", () => onSelectRef.current(vehicle.id));
                marker.addTo(map);
                markers.set(vehicle.id, {
                    marker,
                    status: vehicle.status,
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

            if (existing.status !== vehicle.status) {
                existing.marker.setStyle(markerStyle(vehicle.status));
                existing.marker.setTooltipContent(markerTooltip(vehicle));
                existing.status = vehicle.status;
            }
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                entry.marker.remove();
                markers.delete(id);
            }
        }
    }, [vehicles, onSelectRef]);

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

    return (
        <div className={`${styles.wrap} ${styles.wrapFill}`}>
            <div
                ref={containerRef}
                className={`${styles.map} ${styles.mapFill}`}
                role="img"
                aria-label={
                    mode === "density"
                        ? "Flottenkarte mit aggregierten Dichtezellen. Ein Kreis vergrößert den Ausschnitt."
                        : "Flottenkarte mit letzten Positionen. Ein Marker öffnet das Fahrzeug."
                }
            />
            {mode === "positions" && vehicles.length > 0 && (
                <details className={styles.vehicleList}>
                    <summary>Fahrzeugliste ({vehicles.length})</summary>
                    <ul>
                        {listedVehicles.map((vehicle) => (
                            <li key={vehicle.id}>
                                <button
                                    type="button"
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
                    {vehicles.length > listedVehicles.length && (
                        <p>
                            Erste {listedVehicles.length} Fahrzeuge. Filtere
                            die Ansicht für weitere Treffer.
                        </p>
                    )}
                </details>
            )}
            <MapStatusLegend
                vehiclesByStatus={vehiclesByStatus}
                density={mode === "density"}
            />
        </div>
    );
};
