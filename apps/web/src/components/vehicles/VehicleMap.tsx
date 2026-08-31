import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { VehicleStatus } from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { createThemedMap } from "./leafletMap";
import { MapStatusLegend } from "./MapStatusLegend";
import {
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

const INITIAL_ZOOM = 14;
/** Etwa ein Simulator-Tick, damit der Marker die Linie entlanggleitet. */
const MARKER_SLIDE_MS = 400;

export type MapPoint = {
    latitude: number;
    longitude: number;
};

type VehicleMapProps = {
    latitude: number;
    longitude: number;
    label: string;
    status: VehicleStatus;
    trail?: MapPoint[];
};

const markerTooltip = (label: string, status: VehicleStatus) =>
    `${label} · ${vehicleStatusLabel(status)}`;

const createMarkerIcon = () =>
    L.divIcon({
        className: styles.markerIcon,
        html: `<span class="${styles.marker}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
    });

const toLatLngs = (points: MapPoint[]): L.LatLng[] =>
    points.map((point) => L.latLng(point.latitude, point.longitude));

const lerp = (from: L.LatLng, to: L.LatLng, t: number): L.LatLng =>
    L.latLng(
        from.lat + (to.lat - from.lat) * t,
        from.lng + (to.lng - from.lng) * t,
    );

/** Bereits zurückgelegte Vertices plus Zwischenpunkt — die Spur hinter dem Auto. */
const pathAlong = (points: L.LatLng[], meters: number): L.LatLng[] => {
    const start = points[0];
    if (!start) {
        return [];
    }

    if (points.length === 1 || meters <= 0) {
        return [start];
    }

    const result: L.LatLng[] = [start];
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to) {
            continue;
        }

        const segment = from.distanceTo(to);

        if (walked + segment >= meters) {
            const t = segment === 0 ? 1 : (meters - walked) / segment;
            result.push(lerp(from, to, t));
            return result;
        }

        walked += segment;
        result.push(to);
    }

    return points.slice();
};

const pathLength = (points: L.LatLng[]): number => {
    let total = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (from && to) {
            total += from.distanceTo(to);
        }
    }

    return total;
};

export const VehicleMap = ({
    latitude,
    longitude,
    label,
    status,
    trail,
}: VehicleMapProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const lineRef = useRef<L.Polyline | null>(null);
    const pathRef = useRef<L.LatLng[]>([]);
    const trailRef = useRef(trail);
    const animationRef = useRef<number | null>(null);
    const followRef = useRef(true);
    const skipViewRef = useRef(false);
    const statusRef = useRef(status);
    statusRef.current = status;
    const [following, setFollowing] = useState(true);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const themed = createThemedMap(container);
        const map = themed.map;
        mapRef.current = map;

        const line = L.polyline([], {
            color: VEHICLE_STATUS_COLORS[statusRef.current],
            weight: 4,
            opacity: 0.85,
            lineJoin: "round",
            lineCap: "round",
            smoothFactor: 0,
            interactive: false,
        });
        line.addTo(map);
        lineRef.current = line;

        themed.onThemeChange(() => {
            lineRef.current?.setStyle({
                color: VEHICLE_STATUS_COLORS[statusRef.current],
            });
        });

        const onUserView = () => {
            if (skipViewRef.current) {
                return;
            }

            followRef.current = false;
            setFollowing(false);
        };

        map.on("dragstart", onUserView);
        map.on("zoomstart", onUserView);

        return () => {
            if (animationRef.current !== null) {
                cancelAnimationFrame(animationRef.current);
            }
            map.off("dragstart", onUserView);
            map.off("zoomstart", onUserView);
            themed.destroy();
            mapRef.current = null;
            markerRef.current = null;
            lineRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        const line = lineRef.current;

        if (!map || !line) {
            return;
        }

        const panIfFollowing = (at: L.LatLng) => {
            if (!followRef.current) {
                return;
            }

            skipViewRef.current = true;
            map.setView(at, map.getZoom(), { animate: false });
            skipViewRef.current = false;
        };

        const next = L.latLng(latitude, longitude);
        let slideAlong: L.LatLng[] | null = null;
        let committed: L.LatLng[] | null = null;

        if (trail !== trailRef.current) {
            const previous = pathRef.current;
            const nextPath = toLatLngs(trail ?? []);
            const grew =
                previous.length > 0 && nextPath.length > previous.length;
            const reset =
                previous.length > 0 && nextPath.length < previous.length;

            trailRef.current = trail;
            pathRef.current = nextPath;

            if (grew) {
                slideAlong = nextPath.slice(previous.length - 1);
                committed = previous.slice(0, -1);
                line.setLatLngs(previous);
            } else if (reset) {
                slideAlong = nextPath.length >= 2 ? nextPath : null;
                committed = [];
                line.setLatLngs(
                    nextPath[0] ? [nextPath[0]] : [],
                );
            } else {
                line.setLatLngs(nextPath);
            }
        }

        line.setStyle({ color: VEHICLE_STATUS_COLORS[status] });

        let marker = markerRef.current;

        if (!marker) {
            marker = L.marker(next, {
                icon: createMarkerIcon(),
                keyboard: false,
            });
            marker.bindTooltip(markerTooltip(label, status), {
                direction: "top",
                offset: [0, -10],
            });
            marker.addTo(map);
            markerRef.current = marker;
            skipViewRef.current = true;
            map.setView(next, INITIAL_ZOOM);
            skipViewRef.current = false;
            return;
        }

        marker.setTooltipContent(markerTooltip(label, status));

        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        const moving = marker;
        const from = moving.getLatLng();
        const along =
            slideAlong && slideAlong.length >= 2
                ? slideAlong
                : [from, next];
        const growLine = committed !== null && slideAlong !== null;
        const total = pathLength(along);

        if (total < 1) {
            moving.setLatLng(next);
            if (growLine) {
                line.setLatLngs(pathRef.current);
            }
            panIfFollowing(next);
            return;
        }

        const started = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - started) / MARKER_SLIDE_MS);
            const meters = total * t;
            const walked = pathAlong(along, meters);
            const at = walked[walked.length - 1] ?? next;
            moving.setLatLng(at);

            if (growLine && slideAlong && committed) {
                line.setLatLngs([
                    ...committed,
                    ...pathAlong(slideAlong, meters),
                ]);
            }

            panIfFollowing(at);

            if (t < 1) {
                animationRef.current = requestAnimationFrame(tick);
            } else {
                animationRef.current = null;
                moving.setLatLng(next);
                if (growLine) {
                    line.setLatLngs(pathRef.current);
                }
                panIfFollowing(next);
            }
        };
        animationRef.current = requestAnimationFrame(tick);
    }, [latitude, longitude, label, status, trail]);

    const recenter = () => {
        const map = mapRef.current;
        const marker = markerRef.current;

        if (!map || !marker) {
            return;
        }

        followRef.current = true;
        setFollowing(true);
        skipViewRef.current = true;
        map.setView(marker.getLatLng(), map.getZoom(), { animate: false });
        skipViewRef.current = false;
    };

    const statusLabel = vehicleStatusLabel(status);

    return (
        <div
            className={styles.wrap}
            data-status={status}
            style={
                {
                    "--marker-fill": VEHICLE_STATUS_COLORS[status],
                } as CSSProperties
            }
        >
            <div
                ref={containerRef}
                className={styles.map}
                role="img"
                aria-label={`Karte mit Position von ${label}, Status ${statusLabel}`}
            />
            <MapStatusLegend />
            {!following && (
                <button
                    type="button"
                    className={styles.recenter}
                    onClick={recenter}
                    aria-label="Karte wieder auf das Fahrzeug zentrieren und Folgen fortsetzen"
                >
                    Fahrzeug zentrieren
                </button>
            )}
        </div>
    );
};
