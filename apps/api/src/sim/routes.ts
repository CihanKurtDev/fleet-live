import type { GeoPoint } from "@fleet-live/shared";
import { haversineMeters, pathLengthMeters } from "../lib/geo";
import { ROUTE_GEOMETRIES } from "./routeGeometries";

/** Gebackene OSRM-Straßenverläufe — kein Routing zur Laufzeit. */

export type LatLng = GeoPoint;

export { haversineMeters };

export type SimRoute = {
    id: string;
    from: string;
    to: string;
    points: LatLng[];
};

/** Nominelle Tick-Dauer für die Kinematik — nicht `TELEMETRY_TICK_MS` (in Tests 0). */
export const SIM_SECONDS_PER_TICK = 0.4;
/** Zeitraffer, damit Köln–Düsseldorf grob 1–2 Minuten dauert. */
export const TIME_SCALE = 20;
export const CITY_LIMIT_KMH = 50;
export const HIGHWAY_LIMIT_KMH = 120;
/** Jedes 8. Fahrzeug darf über dem Klassenlimit fahren, sonst gibt es nie SPEEDING. */
export const SIM_OVERSPEED_EVERY = 8;
export const SIM_OVERSPEED_FACTOR = 1.2;

const ROUTE_META: Array<{ id: string; from: string; to: string }> = [
    { id: "koeln-duesseldorf", from: "Köln", to: "Düsseldorf" },
    { id: "koeln-frankfurt", from: "Köln", to: "Frankfurt" },
    { id: "duesseldorf-dortmund", from: "Düsseldorf", to: "Dortmund" },
    { id: "muenchen-nuernberg", from: "München", to: "Nürnberg" },
    { id: "berlin-hamburg", from: "Berlin", to: "Hamburg" },
    { id: "frankfurt-stuttgart", from: "Frankfurt", to: "Stuttgart" },
    { id: "hamburg-bremen", from: "Hamburg", to: "Bremen" },
];

export const SIM_ROUTES: SimRoute[] = ROUTE_META.map((meta) => {
    const points = ROUTE_GEOMETRIES[meta.id];

    if (!points || points.length < 2) {
        throw new Error(`Missing route geometry for ${meta.id}`);
    }

    return { ...meta, points };
});

const NEAR_ROUTE_METERS = 80_000;

type Progress = {
    routeId: string;
    frac: number;
    direction: 1 | -1;
};

const progressByVehicle = new Map<number, Progress>();
const lengthCache = new WeakMap<LatLng[], number>();

export function resetSimProgress() {
    progressByVehicle.clear();
}

export function seedSimProgress(
    vehicleId: number,
    routeId: string,
    frac: number,
    direction: 1 | -1 = 1,
) {
    progressByVehicle.set(vehicleId, { routeId, frac, direction });
}

export function routeLengthMeters(points: LatLng[]): number {
    const cached = lengthCache.get(points);

    if (cached !== undefined) {
        return cached;
    }

    const total = pathLengthMeters(points);

    lengthCache.set(points, total);
    return total;
}

export function pointAtFraction(points: LatLng[], frac: number): LatLng {
    const start = points[0];
    const end = points[points.length - 1];

    if (!start || !end) {
        return { lat: 50.9375, lng: 6.9603 };
    }

    const clamped = Math.min(1, Math.max(0, frac));
    const target = routeLengthMeters(points) * clamped;
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to) {
            continue;
        }

        const segment = haversineMeters(from, to);

        if (walked + segment >= target) {
            const t = segment === 0 ? 0 : (target - walked) / segment;
            return {
                lat: from.lat + (to.lat - from.lat) * t,
                lng: from.lng + (to.lng - from.lng) * t,
            };
        }

        walked += segment;
    }

    return end;
}

/**
 * Stützpunkte der Geometrie zwischen zwei Fraktionen, ohne den Startpunkt
 * (der liegt schon im Verlauf). Enthält die Zwischenvertices und das Ziel —
 * das ist die Kurve, nicht die Sehne des Ticks.
 */
export function verticesBetween(
    points: LatLng[],
    fromFrac: number,
    toFrac: number,
): LatLng[] {
    if (points.length < 2 || fromFrac === toFrac) {
        return [pointAtFraction(points, toFrac)];
    }

    const forward = toFrac >= fromFrac;
    const low = forward ? fromFrac : toFrac;
    const high = forward ? toFrac : fromFrac;
    const total = routeLengthMeters(points);
    const startM = total * Math.min(1, Math.max(0, low));
    const endM = total * Math.min(1, Math.max(0, high));
    const collected: LatLng[] = [];
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to) {
            continue;
        }

        const segment = haversineMeters(from, to);
        const nextWalked = walked + segment;

        if (nextWalked > startM + 0.5 && nextWalked < endM - 0.5) {
            collected.push(to);
        }

        walked = nextWalked;
    }

    const end = pointAtFraction(points, high);
    const last = collected[collected.length - 1];
    if (
        !last ||
        haversineMeters(last, end) > 0.5
    ) {
        collected.push(end);
    }

    if (collected.length === 0) {
        collected.push(end);
    }

    return forward ? collected : collected.reverse();
}

export function nearestFraction(points: LatLng[], pos: LatLng): number {
    const total = routeLengthMeters(points);

    if (total === 0) {
        return 0;
    }

    let bestDist = Number.POSITIVE_INFINITY;
    let bestAlong = 0;
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to) {
            continue;
        }

        const abx = to.lng - from.lng;
        const aby = to.lat - from.lat;
        const apx = pos.lng - from.lng;
        const apy = pos.lat - from.lat;
        const ab2 = abx * abx + aby * aby;
        const t =
            ab2 === 0
                ? 0
                : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
        const projected = {
            lat: from.lat + aby * t,
            lng: from.lng + abx * t,
        };
        const dist = haversineMeters(pos, projected);

        if (dist < bestDist) {
            bestDist = dist;
            bestAlong = walked + routeLengthMeters([from, to]) * t;
        }

        walked += haversineMeters(from, to);
    }

    return Math.min(1, Math.max(0, bestAlong / total));
}

function distanceToRoute(route: SimRoute, pos: LatLng): number {
    const frac = nearestFraction(route.points, pos);
    const onRoute = pointAtFraction(route.points, frac);
    return haversineMeters(pos, onRoute);
}

export function speedLimitKmh(frac: number): number {
    const clamped = Math.min(1, Math.max(0, frac));
    const cityEnd = 0.08;
    const rampEnd = 0.15;
    const highwayEnd = 0.85;
    const exitRampEnd = 0.92;

    if (clamped < cityEnd) {
        return CITY_LIMIT_KMH;
    }

    if (clamped < rampEnd) {
        const t = (clamped - cityEnd) / (rampEnd - cityEnd);
        return CITY_LIMIT_KMH + (HIGHWAY_LIMIT_KMH - CITY_LIMIT_KMH) * t;
    }

    if (clamped < highwayEnd) {
        return HIGHWAY_LIMIT_KMH;
    }

    if (clamped < exitRampEnd) {
        const t = (clamped - highwayEnd) / (exitRampEnd - highwayEnd);
        return HIGHWAY_LIMIT_KMH + (CITY_LIMIT_KMH - HIGHWAY_LIMIT_KMH) * t;
    }

    return CITY_LIMIT_KMH;
}

export function simExceedsClassLimit(vehicleId: number): boolean {
    return vehicleId % SIM_OVERSPEED_EVERY === 0;
}

export function simSpeedCapKmh(limit: number, vehicleId: number): number {
    return simExceedsClassLimit(vehicleId)
        ? Math.round(limit * SIM_OVERSPEED_FACTOR)
        : limit;
}

function nextDisplaySpeed(
    current: number | null,
    limit: number,
    cap: number,
): number {
    const floor = Math.max(30, Math.round(limit * 0.75));
    const base = current !== null ? current : limit;
    const toward = base + (cap - base) * 0.25;
    const delta = (Math.random() - 0.5) * 6;

    return Math.round(Math.min(cap, Math.max(floor, toward + delta)));
}

export function pickRoute(vehicleId: number, pos: LatLng): SimRoute {
    const ranked = SIM_ROUTES.map((route) => ({
        route,
        dist: distanceToRoute(route, pos),
    })).sort((left, right) => left.dist - right.dist);

    const nearby = ranked.filter((entry) => entry.dist <= NEAR_ROUTE_METERS);
    const pool = (nearby.length > 0 ? nearby : ranked.slice(0, 1)).map(
        (entry) => entry.route,
    );
    const chosen = pool[vehicleId % pool.length];

    return chosen ?? SIM_ROUTES[0]!;
}

export type SimTick = {
    lat: number;
    lng: number;
    speed: number;
    /** Nominelles Streckenlimit dieses Ticks (nicht die Überhöhungs-Kappe). */
    limit_kmh: number;
    /** Zurückgelegte Strecke dieses Ticks — Basis für den Spritverbrauch. */
    meters: number;
    /** Straßenvertices dieses Ticks, inklusive Ziel, ohne den Startpunkt. */
    path: LatLng[];
    /** Ziel erreicht und Richtung gewechselt — die bisherige Fahrt ist zu Ende. */
    turnedAround: boolean;
};

export function nextSimTick(
    vehicleId: number,
    current: LatLng,
    currentSpeed: number | null,
): SimTick {
    let state = progressByVehicle.get(vehicleId);

    if (!state) {
        const picked = pickRoute(vehicleId, current);
        const frac = nearestFraction(picked.points, current);
        state = {
            routeId: picked.id,
            frac,
            direction: frac <= 0.5 ? 1 : -1,
        };
    }

    const route =
        SIM_ROUTES.find((entry) => entry.id === state.routeId) ??
        pickRoute(vehicleId, current);
    let { frac, direction } = state;
    const fromFrac = frac;
    const limit = speedLimitKmh(frac);
    const cap = simSpeedCapKmh(limit, vehicleId);
    const speed = nextDisplaySpeed(currentSpeed, limit, cap);
    const length = routeLengthMeters(route.points);
    const meters = (speed * SIM_SECONDS_PER_TICK * TIME_SCALE) / 3.6;
    const deltaFrac = length === 0 ? 0 : meters / length;
    const previousDirection = direction;
    frac += direction * deltaFrac;

    let turnedAround = false;

    if (frac >= 1) {
        frac = 1;
        turnedAround = previousDirection === 1;
        direction = -1;
    } else if (frac <= 0) {
        frac = 0;
        turnedAround = previousDirection === -1;
        direction = 1;
    }

    progressByVehicle.set(vehicleId, {
        routeId: route.id,
        frac,
        direction,
    });

    const point = pointAtFraction(route.points, frac);
    const start = pointAtFraction(route.points, fromFrac);
    const rest = verticesBetween(route.points, fromFrac, frac);
    const path =
        rest[0] && haversineMeters(start, rest[0]) < 0.5
            ? rest
            : [start, ...rest];

    return {
        lat: point.lat,
        lng: point.lng,
        speed,
        limit_kmh: Math.round(limit),
        meters,
        path,
        turnedAround,
    };
}
