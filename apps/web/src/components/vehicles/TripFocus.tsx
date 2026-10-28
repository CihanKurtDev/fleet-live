import type { Trip, TripEvent } from "@fleet-live/shared";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { useLatestRef } from "../../hooks/useLatestRef";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import {
    DEFAULT_REPLAY_SPEED,
    REPLAY_SPEEDS,
    advanceReplay,
    drivenPart,
    isAtEvent,
    measureRoute,
    placeEvent,
    routeAt,
    routeBetween,
    type ReplaySpeed,
} from "./tripReplay";
import {
    eventDetail,
    eventHeadline,
    eventWhere,
    formatKm,
} from "./tripEventText";
import { TripPanel } from "./TripPanel";
import type { RoadPoint } from "./vehiclePlayback";
import styles from "./TripFocus.module.scss";

export type TripFocusInfo = {
    trip: Trip;
    /** The trip's events as last loaded (a running trip reloads them). */
    events: TripEvent[];
    /** Dispatcher: may resolve the trip's speeding warning. */
    canResolve: boolean;
    onResolve: (alertIds: number[]) => Promise<void>;
};

type TripFocusProps = {
    mapRef: RefObject<L.Map | null>;
    /** The trip's line as the map draws it. */
    points: RoadPoint[];
    focus: TripFocusInfo;
    /**
     * Shows these bounds (stops following the vehicle); `topInset` is how
     * far the controls on top reach into the map.
     */
    onFrame: (bounds: L.LatLngBounds, topInset: number, maxZoom?: number) => void;
    onBack: () => void;
};

/** Longest step one frame may take, so a tab coming back does not jump. */
const MAX_FRAME_MS = 250;
const SLIDER_STEPS = 1000;
/** A picked point event is shown this close (street level). */
const EVENT_ZOOM = 15;

const endIcon = (label: "A" | "B") =>
    L.divIcon({
        className: styles.iconBox,
        html: `<span class="${styles.end}" data-end="${label}">${label}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });

const eventIcon = (event: TripEvent, number: number, selected: boolean) =>
    L.divIcon({
        className: styles.iconBox,
        html: `<span class="${styles.eventMarker}" data-type="${event.type}"${
            event.estimated ? " data-estimated" : ""
        }${selected ? " data-selected" : ""}>${number}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });

const tooltipText = (event: TripEvent) =>
    [
        event.type === "SPEEDING" ? "Tempo" : "Kein Signal",
        eventHeadline(event),
        eventDetail(event),
        eventWhere(event),
    ]
        .filter(Boolean)
        .join(" · ");

/**
 * A trip picked in the list, alone on the map: no other trips, and for a
 * closed trip no live dot of the vehicle (VehicleMap hides it). It is shown
 * whole with start (A), end (B), every speeding stretch in red and a
 * numbered marker per event; the
 * panel beside it says who drove, how fast and what happened, in order.
 * A row or a marker shows that event and moves the replay there. The
 * replay runs evenly along the line (a trip has no time per point): the
 * driven part turns yellow, and an event lights up while the dot is in it.
 */
export const TripFocus = ({
    mapRef,
    points,
    focus,
    onFrame,
    onBack,
}: TripFocusProps) => {
    const { trip, events } = focus;
    const closed = trip.ended_at !== null;
    const route = useMemo(() => measureRoute(points), [points]);
    const placed = useMemo(
        () => events.map((event) => placeEvent(event, trip.distance_m)),
        [events, trip.distance_m],
    );
    const [position, setPosition] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<ReplaySpeed>(DEFAULT_REPLAY_SPEED);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const positionRef = useRef(0);
    const overlayRef = useRef<HTMLDivElement>(null);
    const replayRef = useRef<{
        rest: L.Polyline;
        driven: L.Polyline;
        dot: L.Marker;
    } | null>(null);
    const started = playing || position > 0;
    const first = points[0];
    const last = points[points.length - 1];

    const topInset = () => {
        const overlay = overlayRef.current;
        return overlay ? overlay.offsetTop + overlay.offsetHeight : 0;
    };

    // Framed once, when the trip is picked (the component is keyed by it);
    // a running trip that grows keeps the view the user has.
    const frameRef = useRef({ onFrame, points, topInset });
    useEffect(() => {
        const { onFrame: frame, points: line, topInset: inset } = frameRef.current;

        if (line.length > 0) {
            frame(L.latLngBounds(line.map((point) => L.latLng(point))), inset());
        }
    }, []);

    const litIds = useMemo(
        () =>
            new Set(
                started
                    ? events
                          .filter((_, index) => isAtEvent(placed[index]!, position))
                          .map((event) => event.id)
                    : [],
            ),
        [events, placed, position, started],
    );
    const inSpeeding = events.some(
        (event) => event.type === "SPEEDING" && litIds.has(event.id),
    );

    const seek = (next: number) => {
        positionRef.current = next;
        setPosition(next);
    };

    const selectEvent = (event: TripEvent) => {
        const index = events.indexOf(event);
        const at = placed[index];

        if (!at) {
            return;
        }

        setSelectedId(event.id);
        setPlaying(false);
        seek(at.from);

        const stretch =
            at.to === null ? [routeAt(route, at.from)?.at] : routeBetween(route, at.from, at.to);
        const corners = stretch.filter((point): point is RoadPoint => point !== undefined);

        if (corners.length > 0) {
            onFrame(
                L.latLngBounds(corners.map((point) => L.latLng(point))),
                topInset(),
                EVENT_ZOOM,
            );
        }

        // On a phone the list is below the map: bring the map into view.
        mapRef.current?.getContainer().scrollIntoView({ block: "nearest" });
    };
    const selectRef = useLatestRef(selectEvent);

    // Replay layers: the rest of the line muted, the driven part yellow on
    // top, the dot at the position. Before the first play the trip keeps
    // its plain yellow line.
    useEffect(() => {
        const map = mapRef.current;

        if (!map || !started) {
            return;
        }

        const options = {
            weight: 4,
            interactive: false,
            lineJoin: "round",
            lineCap: "round",
            smoothFactor: 0,
        } as const;
        const layers = {
            rest: L.polyline(route.points, {
                ...options,
                className: styles.rest,
            }).addTo(map),
            driven: L.polyline([], {
                ...options,
                className: styles.driven,
            }).addTo(map),
            dot: L.marker(route.points[0] ?? [0, 0], {
                icon: L.divIcon({
                    className: styles.iconBox,
                    html: `<span class="${styles.dot}"></span>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: 1000,
            }).addTo(map),
        };

        replayRef.current = layers;

        return () => {
            replayRef.current = null;
            layers.rest.remove();
            layers.driven.remove();
            layers.dot.remove();
        };
    }, [mapRef, route, started]);

    // Speeding stretches in red, above the line and the replay.
    useEffect(() => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        const stretches = events.flatMap((event, index) => {
            const at = placed[index]!;

            if (event.type !== "SPEEDING" || at.to === null) {
                return [];
            }

            return [
                L.polyline(routeBetween(route, at.from, at.to), {
                    className: styles.speeding,
                    weight: selectedId === event.id ? 8 : 6,
                    lineCap: "round",
                    lineJoin: "round",
                    smoothFactor: 0,
                    interactive: false,
                }).addTo(map),
            ];
        });

        return () => stretches.forEach((line) => line.remove());
    }, [mapRef, events, placed, route, selectedId, started]);

    // Start (A), end (B) once the trip is over, and a numbered marker per event.
    useEffect(() => {
        const map = mapRef.current;

        if (!map || !first) {
            return;
        }

        const markers: L.Marker[] = [
            L.marker(first, { icon: endIcon("A"), interactive: false, keyboard: false }),
        ];

        if (closed && last) {
            markers.push(
                L.marker(last, { icon: endIcon("B"), interactive: false, keyboard: false }),
            );
        }

        events.forEach((event, index) => {
            const at = routeAt(route, placed[index]!.from);

            if (!at) {
                return;
            }

            const marker = L.marker(at.at, {
                icon: eventIcon(event, index + 1, selectedId === event.id),
                keyboard: false,
                zIndexOffset: 500,
            });

            marker.bindTooltip(tooltipText(event), {
                direction: "top",
                offset: [0, -12],
            });
            marker.on("click", () => selectRef.current(event));
            markers.push(marker);
        });

        markers.forEach((marker) => marker.addTo(map));

        return () => markers.forEach((marker) => marker.remove());
    }, [mapRef, first, last, closed, events, placed, route, selectedId, selectRef]);

    useEffect(() => {
        const layers = replayRef.current;
        const shown = routeAt(route, position);

        if (!layers || !shown) {
            return;
        }

        layers.driven.setLatLngs(drivenPart(route, position));
        layers.dot.setLatLng(shown.at);
        layers.dot
            .getElement()
            ?.querySelector(`.${styles.dot}`)
            ?.toggleAttribute("data-speeding", inSpeeding);
    }, [route, position, started, inSpeeding]);

    useEffect(() => {
        if (!playing) {
            return;
        }

        let previous = performance.now();
        let frame = requestAnimationFrame(function step(now) {
            const next = advanceReplay(
                positionRef.current,
                Math.min(now - previous, MAX_FRAME_MS),
                speed,
            );

            previous = now;
            positionRef.current = next;
            setPosition(next);

            if (next >= 1) {
                setPlaying(false);
                return;
            }

            frame = requestAnimationFrame(step);
        });

        return () => cancelAnimationFrame(frame);
    }, [playing, speed]);

    const togglePlay = () => {
        if (playing) {
            setPlaying(false);
            return;
        }

        if (positionRef.current >= 1) {
            seek(0);
        }

        setPlaying(true);
    };

    const playLabel = playing
        ? "pause"
        : position >= 1
          ? "again"
          : position > 0
            ? "resume"
            : "play";

    return (
        <>
            <div ref={overlayRef} className={styles.overlay}>
                <Button variant="secondary" size="row" onClick={onBack}>
                    Zurück zum Fahrzeug
                </Button>
            </div>

            <div className={styles.replay} data-replay>
                {closed ? (
                    <div className={styles.player}>
                        <Button
                            size="sm"
                            onClick={togglePlay}
                            disabled={route.total === 0}
                        >
                            <span className={styles.playLabels}>
                                {(
                                    [
                                        ["play", "▶︎", "Abspielen"],
                                        ["pause", "❚❚", "Pause"],
                                        ["resume", "▶︎", "Weiter"],
                                        ["again", "↺", "Nochmal"],
                                    ] as const
                                ).map(([key, glyph, text]) => (
                                    <span
                                        key={key}
                                        className={
                                            key === playLabel ? undefined : styles.hidden
                                        }
                                        aria-hidden={key !== playLabel || undefined}
                                    >
                                        <span aria-hidden="true">{glyph}</span> {text}
                                    </span>
                                ))}
                            </span>
                        </Button>
                        <Input
                            type="range"
                            className={styles.slider}
                            min={0}
                            max={SLIDER_STEPS}
                            step={1}
                            value={Math.round(position * SLIDER_STEPS)}
                            onChange={(event) =>
                                seek(Number(event.target.value) / SLIDER_STEPS)
                            }
                            aria-label="Stelle in der Fahrt"
                            aria-valuetext={`${formatKm(trip.distance_m * position)} von ${formatKm(trip.distance_m)} km`}
                        />
                        <div
                            className={styles.speeds}
                            role="group"
                            aria-label="Tempo beim Abspielen"
                        >
                            {REPLAY_SPEEDS.map((option) => (
                                <Button
                                    key={option}
                                    variant="secondary"
                                    size="sm"
                                    className={styles.speed}
                                    aria-pressed={speed === option}
                                    onClick={() => setSpeed(option)}
                                >
                                    {option}×
                                </Button>
                            ))}
                        </div>
                        <span className={styles.km} data-speeding={inSpeeding || undefined}>
                            {inSpeeding ? "zu schnell · " : ""}
                            km {formatKm(trip.distance_m * position)} von{" "}
                            {formatKm(trip.distance_m)}
                        </span>
                    </div>
                ) : (
                    <p className={styles.note}>
                        Die Fahrt läuft noch. Abspielen geht, sobald sie beendet ist.
                    </p>
                )}
            </div>

            <div className={styles.side}>
                <TripPanel
                trip={trip}
                events={events}
                selectedId={selectedId}
                litIds={litIds}
                onSelect={selectEvent}
                canResolve={focus.canResolve}
                onResolve={focus.onResolve}
                />
            </div>
        </>
    );
};
