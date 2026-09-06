import { useCallback, useEffect, useRef } from "react";
import type L from "leaflet";

import {
    lerp,
    pathLength,
    toLatLngs,
    type MapPoint,
} from "../components/vehicles/mapGeometry";

/** Sim-Tick ist 400 ms; kürzere Deltas sind doppelte React-Updates, keine echten Ticks. */
const MIN_TICK_S = 0.2;
const MAX_TICK_S = 1.2;
const DEFAULT_TICK_S = 0.4;
/** Tab-Resume darf nicht die ganze Warteschlange in einem Frame ablaufen. */
const MAX_FRAME_S = 0.05;
const VERTEX_EPS_M = 0.05;
/** Encode/RDP noise; used to decide if a longer trail is the same polyline grown. */
const PREFIX_EPS_M = 12;

const sameVertex = (a: L.LatLng | undefined, b: L.LatLng | undefined) =>
    Boolean(a && b && a.distanceTo(b) <= PREFIX_EPS_M);

const isPrefixContinuation = (previous: L.LatLng[], nextPath: L.LatLng[]) => {
    if (previous.length === 0 || nextPath.length <= previous.length) {
        return false;
    }

    if (!sameVertex(previous[0], nextPath[0])) {
        return false;
    }

    const lastIdx = previous.length - 1;

    if (!sameVertex(previous[lastIdx], nextPath[lastIdx])) {
        return false;
    }

    if (previous.length > 4) {
        const mid = Math.floor(lastIdx / 2);

        if (!sameVertex(previous[mid], nextPath[mid])) {
            return false;
        }
    }

    return true;
};

type SyncArgs = {
    trail: MapPoint[] | undefined;
    next: L.LatLng;
    marker: L.Marker;
    line: L.Polyline;
    panIfFollowing: (at: L.LatLng) => void;
};

const blendSpeed = (current: number, instant: number) =>
    current > 0 ? current * 0.55 + instant * 0.45 : instant;

export const useMarkerSlide = () => {
    const animationRef = useRef<number | null>(null);
    const lastFrameRef = useRef<number | null>(null);
    const pathRef = useRef<L.LatLng[]>([]);
    const trailRef = useRef<MapPoint[] | undefined>(undefined);
    const queueRef = useRef<L.LatLng[]>([]);
    const bodyRef = useRef<L.LatLng[]>([]);
    const speedMpsRef = useRef(0);
    const lastAppendAtRef = useRef<number | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const lineRef = useRef<L.Polyline | null>(null);
    const panRef = useRef<(at: L.LatLng) => void>(() => undefined);

    const cancel = useCallback(() => {
        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        lastFrameRef.current = null;
    }, []);

    const paint = (at: L.LatLng) => {
        const marker = markerRef.current;
        const line = lineRef.current;

        if (!marker || !line) {
            return;
        }

        marker.setLatLng(at);
        line.setLatLngs([...bodyRef.current, at]);
        panRef.current(at);
    };

    const tick = (now: number) => {
        const queue = queueRef.current;

        if (queue.length < 2 || speedMpsRef.current <= 0) {
            animationRef.current = null;
            lastFrameRef.current = null;
            return;
        }

        const previous = lastFrameRef.current ?? now;
        lastFrameRef.current = now;
        let budget = speedMpsRef.current * Math.min(MAX_FRAME_S, (now - previous) / 1000);

        while (budget > 0 && queue.length >= 2) {
            const from = queue[0];
            const to = queue[1];

            if (!from || !to) {
                break;
            }

            const segment = from.distanceTo(to);

            if (segment <= VERTEX_EPS_M) {
                bodyRef.current.push(from);
                queue.shift();
                continue;
            }

            if (budget >= segment) {
                budget -= segment;
                bodyRef.current.push(from);
                queue.shift();
                continue;
            }

            queue[0] = lerp(from, to, budget / segment);
            budget = 0;
        }

        const at = queue[0];

        if (at) {
            paint(at);
        }

        if (queue.length >= 2 && speedMpsRef.current > 0) {
            animationRef.current = requestAnimationFrame(tick);
        } else {
            animationRef.current = null;
            lastFrameRef.current = null;
        }
    };

    const ensureRunning = () => {
        if (animationRef.current !== null) {
            return;
        }

        if (queueRef.current.length < 2 || speedMpsRef.current <= 0) {
            return;
        }

        lastFrameRef.current = null;
        animationRef.current = requestAnimationFrame(tick);
    };

    const noteAppend = (meters: number, now: number) => {
        const elapsed =
            lastAppendAtRef.current === null
                ? DEFAULT_TICK_S
                : (now - lastAppendAtRef.current) / 1000;
        const dt = Math.min(MAX_TICK_S, Math.max(MIN_TICK_S, elapsed));
        speedMpsRef.current = blendSpeed(speedMpsRef.current, meters / dt);
        lastAppendAtRef.current = now;
    };

    const sync = useCallback(
        ({ trail, next, marker, line, panIfFollowing }: SyncArgs) => {
            markerRef.current = marker;
            lineRef.current = line;
            panRef.current = panIfFollowing;

            if (trail !== trailRef.current) {
                const previous = pathRef.current;
                const nextPath = toLatLngs(trail ?? []);
                const grew = isPrefixContinuation(previous, nextPath);
                const reset =
                    previous.length > 0 &&
                    nextPath.length > 0 &&
                    nextPath.length < previous.length;

                trailRef.current = trail;
                pathRef.current = nextPath;

                const now = performance.now();

                if (nextPath.length === 0) {
                    cancel();
                    bodyRef.current = [];
                    queueRef.current = [];
                    speedMpsRef.current = 0;
                    lastAppendAtRef.current = null;
                    line.setLatLngs([]);
                    marker.setLatLng(next);
                    panIfFollowing(next);
                    return;
                }

                if (grew) {
                    const suffix = nextPath.slice(previous.length - 1);
                    const added = suffix.slice(1);

                    if (queueRef.current.length === 0) {
                        queueRef.current = suffix.slice();
                    } else {
                        queueRef.current.push(...added);
                    }

                    noteAppend(pathLength(suffix), now);
                    ensureRunning();
                    return;
                }

                if (reset) {
                    bodyRef.current = [];
                    queueRef.current = nextPath.slice();
                    noteAppend(
                        pathLength(nextPath) || next.distanceTo(nextPath[0] ?? next),
                        now,
                    );

                    const start = nextPath[0] ?? next;
                    paint(start);
                    ensureRunning();
                    return;
                }

                cancel();
                speedMpsRef.current = 0;
                lastAppendAtRef.current = null;
                bodyRef.current =
                    nextPath.length > 1 ? nextPath.slice(0, -1) : [];
                queueRef.current = [nextPath[nextPath.length - 1]!];
                line.setLatLngs(nextPath);
                const end = nextPath[nextPath.length - 1] ?? next;
                marker.setLatLng(end);
                panIfFollowing(end);
                return;
            }

            if (queueRef.current.length >= 2) {
                return;
            }

            const at = queueRef.current[0] ?? marker.getLatLng();

            if (at.distanceTo(next) > 1) {
                marker.setLatLng(next);
                panIfFollowing(next);
            }
        },
        [cancel],
    );

    useEffect(() => cancel, [cancel]);

    return { sync, cancel };
};
