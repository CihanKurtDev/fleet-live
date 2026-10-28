import type { TripEvent } from "@fleet-live/shared";

import { meters, type RoadPoint } from "./vehiclePlayback";

/*
 * Replaying a closed trip on the detail map. A trip stores its line, not a
 * time per point, so the replay runs evenly along the distance: the
 * position is a share of the line (0 = start, 1 = end), never a clock time.
 */

/** At 1× a whole trip takes this long, whatever its length. */
export const REPLAY_SECONDS = 40;
export const REPLAY_SPEEDS = [1, 4, 16] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 4;

export const advanceReplay = (
    position: number,
    elapsedMs: number,
    speed: number,
): number =>
    Math.min(
        1,
        Math.max(0, position + ((elapsedMs / 1000) * speed) / REPLAY_SECONDS),
    );

export type ReplayRoute = {
    points: RoadPoint[];
    /** Metres from the start to each point. */
    along: number[];
    total: number;
};

export const measureRoute = (points: RoadPoint[]): ReplayRoute => {
    const along: number[] = [];
    let total = 0;

    points.forEach((point, index) => {
        const previous = points[index - 1];

        if (previous) {
            total += meters(previous, point);
        }

        along.push(total);
    });

    return { points, along, total };
};

/** The point at a share of the route and how many points lie before it. */
export const routeAt = (
    route: ReplayRoute,
    share: number,
): { at: RoadPoint; passed: number } | null => {
    const { points, along, total } = route;
    const first = points[0];

    if (!first) {
        return null;
    }

    const target = Math.min(1, Math.max(0, share)) * total;

    if (total === 0 || target <= 0) {
        return { at: first, passed: 0 };
    }

    // First point at or beyond the target: the position lies on the
    // segment that ends there.
    let low = 1;
    let high = points.length - 1;

    while (low < high) {
        const middle = (low + high) >> 1;

        if (along[middle]! < target) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    const from = points[low - 1]!;
    const to = points[low]!;
    const start = along[low - 1]!;
    const length = along[low]! - start;
    const t = length === 0 ? 1 : (target - start) / length;

    return {
        at: {
            lat: from.lat + (to.lat - from.lat) * t,
            lng: from.lng + (to.lng - from.lng) * t,
        },
        passed: low,
    };
};

/** The driven part: the points before the share plus the point at it. */
export const drivenPart = (route: ReplayRoute, share: number): RoadPoint[] => {
    const shown = routeAt(route, share);

    return shown ? [...route.points.slice(0, shown.passed), shown.at] : [];
};

/** Between two shares of the route: its points there plus both ends. */
export const routeBetween = (
    route: ReplayRoute,
    fromShare: number,
    toShare: number,
): RoadPoint[] => {
    const from = routeAt(route, fromShare);
    const to = routeAt(route, toShare);

    if (!from || !to) {
        return [];
    }

    return [from.at, ...route.points.slice(from.passed, to.passed), to.at];
};

/** A point of the trip (metres as in `distance_m`) as a share of it. */
export const shareOf = (at: number, distanceM: number): number =>
    distanceM > 0 ? Math.min(1, Math.max(0, at / distanceM)) : 0;

/** A point event (signal loss, estimated place) counts as reached this close. */
export const POINT_WINDOW = 0.02;

export type PlacedEvent = {
    from: number;
    /** Null for a point. */
    to: number | null;
};

/** Where an event lies on the trip, as shares; a stretch only when it has one. */
export const placeEvent = (
    event: Pick<TripEvent, "type" | "from_m" | "to_m" | "ended_at" | "estimated">,
    distanceM: number,
): PlacedEvent => {
    const from = shareOf(event.from_m, distanceM);

    if (event.estimated) {
        return { from, to: null };
    }

    // A run still going reaches to where the trip is now.
    if (event.type === "SPEEDING" && event.ended_at === null) {
        return { from, to: 1 };
    }

    return {
        from,
        to:
            event.to_m !== null && event.to_m > event.from_m
                ? shareOf(event.to_m, distanceM)
                : null,
    };
};

/** The replay is at the event: inside its stretch, or right at its point. */
export const isAtEvent = (placed: PlacedEvent, position: number): boolean =>
    placed.to === null
        ? Math.abs(position - placed.from) < POINT_WINDOW
        : position >= placed.from && position <= placed.to;
