import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { VehicleStatus } from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
    INITIAL_MAP_ZOOM,
    useLeafletFollowMap,
} from "../../hooks/useLeafletFollowMap";
import { useMarkerSlide } from "../../hooks/useMarkerSlide";
import { MapStatusLegend } from "./MapStatusLegend";
import type { MapPoint } from "./mapGeometry";
import {
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

export type { MapPoint } from "./mapGeometry";

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

export const VehicleMap = ({
    latitude,
    longitude,
    label,
    status,
    trail,
}: VehicleMapProps) => {
    const {
        containerRef,
        mapRef,
        themedRef,
        following,
        panIfFollowing,
        recenter,
        setViewSilent,
    } = useLeafletFollowMap();
    const { sync, cancel } = useMarkerSlide();
    const markerRef = useRef<L.Marker | null>(null);
    const lineRef = useRef<L.Polyline | null>(null);
    const statusRef = useRef(status);
    const labelRef = useRef(label);
    statusRef.current = status;
    labelRef.current = label;

    useEffect(() => {
        const map = mapRef.current;
        const themed = themedRef.current;

        if (!map || !themed) {
            return;
        }

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

        return () => {
            cancel();
            line.remove();
            lineRef.current = null;
            markerRef.current?.remove();
            markerRef.current = null;
        };
    }, [cancel, mapRef, themedRef]);

    useEffect(() => {
        markerRef.current?.setTooltipContent(markerTooltip(label, status));
        lineRef.current?.setStyle({ color: VEHICLE_STATUS_COLORS[status] });
    }, [label, status]);

    useEffect(() => {
        const map = mapRef.current;
        const line = lineRef.current;

        if (!map || !line) {
            return;
        }

        const next = L.latLng(latitude, longitude);
        let marker = markerRef.current;

        if (!marker) {
            marker = L.marker(next, {
                icon: createMarkerIcon(),
                keyboard: false,
            });
            marker.bindTooltip(markerTooltip(labelRef.current, statusRef.current), {
                direction: "top",
                offset: [0, -10],
            });
            marker.addTo(map);
            markerRef.current = marker;
            setViewSilent(next, INITIAL_MAP_ZOOM, { animate: false });
        }

        sync({
            trail,
            next,
            marker,
            line,
            panIfFollowing,
        });
    }, [latitude, longitude, trail, mapRef, panIfFollowing, setViewSilent, sync]);

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
                    onClick={() => {
                        const marker = markerRef.current;

                        if (!marker) {
                            return;
                        }

                        recenter(marker.getLatLng());
                    }}
                    aria-label="Karte wieder auf das Fahrzeug zentrieren und Folgen fortsetzen"
                >
                    Fahrzeug zentrieren
                </button>
            )}
        </div>
    );
};
