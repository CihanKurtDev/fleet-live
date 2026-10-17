import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
    FleetDensityCell,
    FleetPosition,
    Site,
    VehicleStatus,
} from "@fleet-live/shared";

import { listSimRoutes } from "../../api/sim";
import {
    addRouteLines,
    depotStyle,
    markerStyle,
} from "../vehicles/fleetMapStyle";
import { createThemedMap } from "../vehicles/leafletMap";
import { vehicleStatusColor } from "../vehicles/vehicleStatus";
import mapStyles from "../vehicles/leafletMap.module.scss";

type Props = {
    vehicles: FleetPosition[];
    densityCells: FleetDensityCell[];
    sites: Site[];
    className?: string;
};

/** Where most of the fleet is: the median position (usually the main depot). */
const fleetFocus = (points: { lat: number; lon: number }[]) => {
    if (points.length === 0) {
        return null;
    }

    const middle = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

    return L.latLng(
        middle(points.map((p) => p.lat)),
        middle(points.map((p) => p.lon)),
    );
};

/** Close enough that motorways, the depot ring and moving dots show. */
const BAND_ZOOM = 8.75;

/**
 * The band is a close-up of where the fleet works, right of the title text.
 * The whole fleet is one click away on /fleet.
 */
const fitFleet = (map: L.Map, focus: L.LatLng | null) => {
    const size = map.getSize();

    if (!focus || size.x === 0 || size.y === 0) {
        return;
    }

    const at = map
        .project(focus, BAND_ZOOM)
        .subtract(L.point(size.x * 0.64 - size.x / 2, size.y * 0.42 - size.y / 2));
    map.setView(map.unproject(at, BAND_ZOOM), BAND_ZOOM, { animate: false });
};

/**
 * The real fleet map, without controls, behind the Schicht title: the same
 * tiles, dots and depot rings as /fleet, so the band and the map page show
 * one picture. The band's link opens the interactive map.
 */
export const LiveBandMap = ({
    vehicles,
    densityCells,
    sites,
    className,
}: Props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layerRef = useRef<L.LayerGroup | null>(null);
    const markersRef = useRef(
        new Map<number, { marker: L.CircleMarker; status: VehicleStatus }>(),
    );
    const rendererRef = useRef<L.Canvas | null>(null);
    const boundsKeyRef = useRef("");
    const focusRef = useRef<L.LatLng | null>(null);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const themed = createThemedMap(container, {
            invalidateDelays: [0, 200],
            scale: false,
            labels: false,
            mapOptions: {
                zoomControl: false,
                attributionControl: true,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                touchZoom: false,
                zoomSnap: 0.25,
            },
        });
        const map = themed.map;
        map.setView([51.16, 10.45], 6);
        // Re-fit whenever the band changes size (first layout, window resize).
        const resize = new ResizeObserver(() => {
            map.invalidateSize();
            fitFleet(map, focusRef.current);
        });
        resize.observe(container);
        rendererRef.current = L.canvas({ padding: 0.2 });
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        const markers = markersRef.current;

        // Roads the fleet drives on, under the dots.
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
            boundsKeyRef.current = "";
            for (const entry of markers.values()) {
                entry.marker.setStyle(markerStyle(entry.status, false));
            }
        });

        return () => {
            routesGone = true;
            routeLines?.remove();
            resize.disconnect();
            markers.clear();
            themed.destroy();
            mapRef.current = null;
            layerRef.current = null;
        };
    }, []);

    // Depots as thin rings.
    useEffect(() => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        const group = L.layerGroup(
            sites.map((site) =>
                L.circle([site.latitude, site.longitude], {
                    radius: site.radius_m,
                    interactive: false,
                    ...depotStyle(false),
                }),
            ),
        ).addTo(map);

        return () => {
            group.remove();
        };
    }, [sites]);

    // Vehicles: add, move and drop dots; place the view once per fleet size.
    useEffect(() => {
        const map = mapRef.current;
        const layer = layerRef.current;
        const renderer = rendererRef.current;

        if (!map || !layer || !renderer) {
            return;
        }

        const placed = vehicles.flatMap((vehicle) =>
            vehicle.has_position &&
            vehicle.latitude !== null &&
            vehicle.longitude !== null
                ? [{ vehicle, lat: vehicle.latitude, lon: vehicle.longitude }]
                : [],
        );
        const markers = markersRef.current;
        const seen = new Set<number>();

        for (const { vehicle, lat, lon } of placed) {
            seen.add(vehicle.id);
            const existing = markers.get(vehicle.id);

            if (!existing) {
                const marker = L.circleMarker([lat, lon], {
                    ...markerStyle(vehicle.status, false),
                    renderer,
                    interactive: false,
                });
                marker.addTo(layer);
                markers.set(vehicle.id, { marker, status: vehicle.status });
                continue;
            }

            const at = existing.marker.getLatLng();
            if (at.lat !== lat || at.lng !== lon) {
                existing.marker.setLatLng([lat, lon]);
            }

            if (existing.status !== vehicle.status) {
                existing.status = vehicle.status;
                existing.marker.setStyle(markerStyle(vehicle.status, false));
            }
        }

        for (const [id, entry] of markers) {
            if (!seen.has(id)) {
                entry.marker.remove();
                markers.delete(id);
            }
        }

        const anchor =
            placed.length > 0
                ? placed
                : densityCells.map((cell) => ({
                      lat: cell.latitude,
                      lon: cell.longitude,
                  }));
        const key = String(anchor.length);

        if (key !== boundsKeyRef.current) {
            const focus = fleetFocus(anchor);
            if (focus) {
                boundsKeyRef.current = key;
                focusRef.current = focus;
                fitFleet(map, focus);
            }
        }
    }, [vehicles, densityCells]);

    // Large fleets come as density cells: dots sized by count.
    useEffect(() => {
        const map = mapRef.current;
        const renderer = rendererRef.current;

        if (!map || !renderer || densityCells.length === 0) {
            return;
        }

        const group = L.layerGroup(
            densityCells.map((cell) => {
                const status = (
                    Object.entries(cell.counts) as [VehicleStatus, number][]
                ).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
                return L.circleMarker([cell.latitude, cell.longitude], {
                    renderer,
                    interactive: false,
                    radius: Math.min(18, 3 + Math.sqrt(cell.total) * 0.8),
                    stroke: false,
                    fillColor: vehicleStatusColor(status),
                    fillOpacity: 0.55,
                });
            }),
        ).addTo(map);

        return () => {
            group.remove();
        };
    }, [densityCells]);

    return (
        <div
            ref={containerRef}
            className={`${mapStyles.map} ${mapStyles.mapFill} ${className ?? ""}`}
            aria-hidden="true"
        />
    );
};
