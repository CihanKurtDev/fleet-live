import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { VehicleStatus } from "@fleet-live/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
    INITIAL_MAP_ZOOM,
    useLeafletFollowMap,
} from "../../hooks/useLeafletFollowMap";
import { useLatestRef } from "../../hooks/useLatestRef";
import { themeColor } from "./leafletMap";
import { detailTooltipHtml } from "./mapLabels";
import type { MapPoint } from "./mapGeometry";
import { PlaybackAge } from "./PlaybackAge";
import { TripFocus, type TripFocusInfo } from "./TripFocus";
import { VehiclePlayback, type PlaybackFix, type RoadPoint } from "./vehiclePlayback";
import {
    vehicleStatusColor,
    vehicleStatusLabel,
} from "./vehicleStatus";
import styles from "./leafletMap.module.scss";

export type { MapPoint } from "./mapGeometry";

type VehicleMapProps = {
    latitude: number;
    longitude: number;
    /** Device time of the position (`recorded_at`). */
    recordedAt: string | null;
    label: string;
    status: VehicleStatus;
    trail?: MapPoint[];
    /**
     * The trail is the open trip and grows with the reports: the marker is
     * played back along it and the line ends at the marker. Otherwise the
     * trail is an archived trip, drawn whole.
     */
    live?: boolean;
    /** Stored fixes to start the playback with (null while they load). */
    history?: readonly PlaybackFix[] | null;
    /** The trail may still turn live (its trip is loading): hold the marker back. */
    loading?: boolean;
    /** Fill the parent's height instead of the fixed map height. */
    fill?: boolean;
    /** The trip picked in the list: shown whole, with its replay. */
    focus?: TripFocusInfo | null;
    /** "Zurück zum Fahrzeug": the map follows the vehicle again. */
    onLeaveFocus?: () => void;
};

/** The one vehicle of this map, in its playback. */
const VEHICLE = 0;
/** Encode/RDP noise; used to decide if a longer trail is the same polyline grown. */
const PREFIX_EPS_M = 12;
/** Room around a framed trip (start and end markers); a short trip is not shown closer. */
const FRAME_PADDING = 28;
const FRAME_MAX_ZOOM = 16;

const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const markerTooltip = (label: string, status: VehicleStatus) =>
    detailTooltipHtml(label, status);

const createMarkerIcon = () =>
    L.divIcon({
        className: styles.markerIcon,
        html: `<span class="${styles.marker}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
    });

const toPoints = (trail: readonly MapPoint[]): RoadPoint[] =>
    trail.map((point) => ({ lat: point.latitude, lng: point.longitude }));

const sameVertex = (a: RoadPoint | undefined, b: RoadPoint | undefined) =>
    Boolean(a && b && L.latLng(a).distanceTo(b) <= PREFIX_EPS_M);

/** The longer line is the shorter one with points added at the end. */
const grewFrom = (previous: RoadPoint[], next: RoadPoint[]) => {
    if (previous.length === 0 || next.length <= previous.length) {
        return false;
    }

    const last = previous.length - 1;
    const middle = Math.floor(last / 2);

    return (
        sameVertex(previous[0], next[0]) &&
        sameVertex(previous[last], next[last]) &&
        (previous.length <= 4 || sameVertex(previous[middle], next[middle]))
    );
};

export const VehicleMap = ({
    latitude,
    longitude,
    recordedAt,
    label,
    status,
    trail,
    live = false,
    history = null,
    loading = false,
    fill = false,
    focus = null,
    onLeaveFocus,
}: VehicleMapProps) => {
    const {
        containerRef,
        mapRef,
        themedRef,
        following,
        panIfFollowing,
        recenter,
        frame,
        setViewSilent,
    } = useLeafletFollowMap();
    const markerRef = useRef<L.Marker | null>(null);
    const lineRef = useRef<L.Polyline | null>(null);
    const statusRef = useLatestRef(status);
    const labelRef = useLatestRef(label);
    const panRef = useLatestRef(panIfFollowing);
    /** Where the vehicle is shown, the same playback as on the fleet map. */
    const playbackRef = useRef(new VehiclePlayback());
    /** The trail as last handed to the playback, and whether it was the live one. */
    const trailRef = useRef<MapPoint[] | undefined>(undefined);
    const pointsRef = useRef<RoadPoint[]>([]);
    const liveRef = useRef(false);
    /** The playback started from the history for the current live trail. */
    const seededRef = useRef(false);
    /** How many trail points the drawn line holds before the marker. */
    const drawnRef = useRef(-1);
    const frameRef = useRef(0);
    const playRef = useRef<() => void>(() => undefined);
    /** The zoom while following, before a trip was framed. */
    const zoomBeforeRef = useRef<number | null>(null);
    const focusRef = useLatestRef(focus);
    const focusPoints = useMemo(() => toPoints(trail ?? []), [trail]);

    const frameTrip = useCallback(
        (bounds: L.LatLngBounds, topInset: number, maxZoom = FRAME_MAX_ZOOM) => {
            const map = mapRef.current;

            if (!map) {
                return;
            }

            zoomBeforeRef.current ??= map.getZoom();
            // The facts line covers the top of the map: the trip starts below it.
            frame(
                bounds,
                {
                    paddingTopLeft: [FRAME_PADDING, topInset + FRAME_PADDING],
                    paddingBottomRight: [FRAME_PADDING, FRAME_PADDING],
                    maxZoom,
                },
                !prefersReducedMotion(),
            );
        },
        [frame, mapRef],
    );

    const leaveFocus = () => {
        const marker = markerRef.current;

        if (marker) {
            recenter(marker.getLatLng(), zoomBeforeRef.current ?? undefined);
        }

        zoomBeforeRef.current = null;
        onLeaveFocus?.();
    };

    useEffect(() => {
        const map = mapRef.current;
        const themed = themedRef.current;

        if (!map || !themed) {
            return;
        }

        // The selected trip is drawn in the yellow marking colour, the dot
        // keeps the status colour.
        const line = L.polyline([], {
            color: themeColor("--accent-fill", "#ffc24b"),
            weight: 3,
            opacity: 0.95,
            lineJoin: "round",
            lineCap: "round",
            smoothFactor: 0,
            interactive: false,
        });
        line.addTo(map);
        lineRef.current = line;

        themed.onThemeChange(() => {
            lineRef.current?.setStyle({
                color: themeColor("--accent-fill", "#ffc24b"),
            });
        });

        // One frame: the marker at the played-back position, the live line up
        // to it, the camera on it. Runs while there is something to play.
        const step = (now: number) => {
            frameRef.current = 0;
            const shown = playbackRef.current.at(VEHICLE, now);
            const marker = markerRef.current;

            if (!shown || !marker) {
                return;
            }

            const at = L.latLng(shown.lat, shown.lng);

            marker.setLatLng(at);

            if (liveRef.current) {
                const drawn = line.getLatLngs() as L.LatLng[];

                if (drawnRef.current !== shown.passed) {
                    drawnRef.current = shown.passed;
                    line.setLatLngs([
                        ...pointsRef.current
                            .slice(0, shown.passed)
                            .map((point) => L.latLng(point)),
                        at,
                    ]);
                } else if (drawn.length > 0) {
                    drawn[drawn.length - 1] = at;
                    line.setLatLngs(drawn);
                }
            }

            panRef.current(at);

            if (!shown.done) {
                frameRef.current = requestAnimationFrame(step);
            }
        };

        playRef.current = () => {
            if (frameRef.current === 0) {
                frameRef.current = requestAnimationFrame(step);
            }
        };

        return () => {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = 0;
            playRef.current = () => undefined;
            line.remove();
            lineRef.current = null;
            markerRef.current?.remove();
            markerRef.current = null;
        };
    }, [mapRef, panRef, themedRef]);

    useEffect(() => {
        markerRef.current?.setTooltipContent(markerTooltip(label, status));
    }, [label, status]);

    useEffect(() => {
        const map = mapRef.current;
        const line = lineRef.current;

        if (!map || !line) {
            return;
        }

        const next = L.latLng(latitude, longitude);
        // The marker appears at the first position it is shown at: for the
        // live trip that is the played-back one, a few seconds behind the
        // newest report, so it does not stand there first and jump back.
        const placeMarker = (at: L.LatLng) => {
            if (markerRef.current) {
                return;
            }

            const marker = L.marker(at, {
                icon: createMarkerIcon(),
                keyboard: false,
            });
            marker.bindTooltip(markerTooltip(labelRef.current, statusRef.current), {
                direction: "top",
                offset: [0, -10],
            });
            marker.addTo(map);
            markerRef.current = marker;
            setViewSilent(at, INITIAL_MAP_ZOOM, { animate: false });
        };

        const playback = playbackRef.current;
        const now = performance.now();
        const fix = { lat: latitude, lng: longitude, recordedAt };
        const report = (road?: RoadPoint[], newTrip?: boolean) =>
            playback.report(VEHICLE, { ...fix, road, newTrip }, now);
        const trailChanged = trail !== trailRef.current;
        const points = trailChanged
            ? toPoints(live ? (trail ?? []) : [])
            : pointsRef.current;
        const previous = pointsRef.current;

        trailRef.current = trail;

        if (
            !markerRef.current &&
            (loading || (live && history === null && !seededRef.current))
        ) {
            // The open trip or the stored fixes are on their way (small
            // requests): the map already shows the place, the marker waits
            // for the playback.
            pointsRef.current = points;

            if (!markerRef.current) {
                setViewSilent(next, INITIAL_MAP_ZOOM, { animate: false });
            }
            return;
        }

        if (!live || points.length < 2) {
            // An archived trip (or none): drawn whole, the marker plays the
            // reports on their own.
            placeMarker(next);
            liveRef.current = false;
            seededRef.current = false;
            pointsRef.current = [];
            drawnRef.current = -1;

            if (trailChanged) {
                line.setLatLngs(
                    toPoints(trail ?? []).map((point) => L.latLng(point)),
                );
            }
            report();
            playRef.current();
            return;
        }

        const grew = trailChanged && grewFrom(previous, points);
        // `path_reset`: a new trip, the line starts again.
        const restarted =
            trailChanged && previous.length > 0 && points.length < previous.length;

        pointsRef.current = points;

        if (
            !seededRef.current ||
            !liveRef.current ||
            (trailChanged && !grew && !restarted)
        ) {
            const fixes = history ?? [];

            liveRef.current = true;
            seededRef.current = true;
            drawnRef.current = -1;
            playback.seed(
                VEHICLE,
                recordedAt === null ? fixes : [...fixes, { ...fix, recordedAt }],
                points,
                now,
            );

            const shown = playback.at(VEHICLE, now);

            placeMarker(shown ? L.latLng(shown.lat, shown.lng) : next);
        } else if (grew) {
            report(points.slice(previous.length));
        } else if (restarted) {
            drawnRef.current = -1;
            report(points, true);
        } else {
            report();
        }

        playRef.current();
    }, [
        latitude,
        longitude,
        recordedAt,
        trail,
        live,
        history,
        loading,
        mapRef,
        setViewSilent,
        labelRef,
        statusRef,
        panRef,
    ]);

    const statusLabel = vehicleStatusLabel(status);

    return (
        <div
            className={[
                styles.wrap,
                fill && styles.wrapFill,
                focus && styles.wrapFocus,
            ]
                .filter(Boolean)
                .join(" ")}
            data-status={status}
            // A closed trip is shown alone: the vehicle's live dot (often
            // driving on the same roads) is hidden until "Zurück zum Fahrzeug".
            data-isolated={(focus && focus.trip.ended_at !== null) || undefined}
            style={
                {
                    "--marker-fill": vehicleStatusColor(status),
                } as CSSProperties
            }
        >
            <div
                ref={containerRef}
                className={
                    fill ? `${styles.map} ${styles.mapStretch}` : styles.map
                }
                role="img"
                aria-label={`Karte mit Position von ${label}, Status ${statusLabel}`}
            />
            {/* While a trip is framed the map is about that trip, not the live age. */}
            <PlaybackAge
                read={(now) =>
                    statusRef.current === "DRIVING" && !focusRef.current
                        ? playbackRef.current.at(VEHICLE, now)
                        : undefined
                }
            />
            {focus && (
                <TripFocus
                    key={focus.trip.id}
                    mapRef={mapRef}
                    points={focusPoints}
                    focus={focus}
                    onFrame={frameTrip}
                    onBack={leaveFocus}
                />
            )}
            {!following && !focus && (
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
