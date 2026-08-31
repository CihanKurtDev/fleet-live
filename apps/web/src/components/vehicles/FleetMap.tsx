import { useEffect, useRef } from "react";
import type { FleetPosition, GeoBBox, VehicleStatus } from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
    `${vehicle.license_plate} · ${vehicle.driver_name} · ${vehicleStatusLabel(vehicle.status)}`;

type FleetMapProps = {
    vehicles: FleetPosition[];
    initialBbox?: GeoBBox | null;
    onBoundsChange: (bbox: GeoBBox) => void;
    onSelect: (id: number) => void;
};

export const FleetMap = ({
    vehicles,
    initialBbox = null,
    onBoundsChange,
    onSelect,
}: FleetMapProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const canvasRef = useRef<L.Canvas | null>(null);
    const markersRef = useRef(new Map<number, MarkerRecord>());
    const initialBboxRef = useRef(initialBbox);
    const onBoundsChangeRef = useRef(onBoundsChange);
    onBoundsChangeRef.current = onBoundsChange;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

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
        });

        return () => {
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
            map.off("dragend", onUserView);
            map.off("zoomend", onUserView);
            for (const entry of markersRef.current.values()) {
                entry.marker.remove();
            }
            markersRef.current.clear();
            canvas.remove();
            themed.destroy();
            mapRef.current = null;
            canvasRef.current = null;
        };
    }, []);

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
    }, [vehicles]);

    return (
        <div className={`${styles.wrap} ${styles.wrapFill}`}>
            <div
                ref={containerRef}
                className={`${styles.map} ${styles.mapFill}`}
                role="img"
                aria-label="Flottenkarte mit letzten Positionen. Ein Marker öffnet das Fahrzeug."
            />
            <MapStatusLegend />
        </div>
    );
};
