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

/**
 * Nominelle Zeit zwischen zwei Pings für die Kinematik, wenn der Aufrufer
 * keine echte Zeit nennt (Tests brauchen eine feste Zahl, `PING_INTERVAL_MS`
 * ist einstellbar).
 */
export const SIM_PING_SECONDS = 5;
/**
 * Zeitraffer: Köln–Düsseldorf dauert grob 5–8 Minuten. Schneller lässt
 * sich ein fahrendes Fahrzeug auf der Karte nicht mehr anklicken.
 */
export const TIME_SCALE = 5;
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

/** Darüber gilt eine gebackene Strecke als erreichbar; sonst die überhaupt nächste. */
export const NEAR_ROUTE_METERS = 80_000;

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

/**
 * Meter je Breitengrad auf der Kugel des Haversine-Radius, ein wenig knapp
 * gerechnet (Faktor 0,999), damit die untere Schranke nie zu hoch liegt.
 */
const METERS_PER_LAT_DEGREE = ((6_371_000 * Math.PI) / 180) * 0.999;
const EARTH_RADIUS_M = 6_371_000;
/** Rundungsreserve: ein Block wird nur übersprungen, wenn er sicher zu weit weg ist. */
const BOUND_SAFETY = 0.9999;
/** Segmente je Block der Nächster-Punkt-Suche. */
const BLOCK_SEGMENTS = 32;

/**
 * Länge jedes Segments und Summe bis zu jedem Stützpunkt, einmal pro Strecke.
 * `cumulative[i]` ist exakt `cumulative[i - 1] + segment[i]` wie beim Ablaufen,
 * damit Suche und Ablauf dieselben Gleitkommawerte sehen. Die Blöcke fassen je
 * `BLOCK_SEGMENTS` Segmente in einem Rahmen zusammen; so lässt sich bei der
 * Suche nach dem nächsten Punkt ein ganzer Block überspringen.
 */
type RouteIndex = {
    segment: Float64Array;
    cumulative: Float64Array;
    blockCount: number;
    minLat: Float64Array;
    maxLat: Float64Array;
    minLng: Float64Array;
    maxLng: Float64Array;
};

const indexCache = new WeakMap<LatLng[], RouteIndex>();

function routeIndex(points: LatLng[]): RouteIndex {
    const cached = indexCache.get(points);

    if (cached) {
        return cached;
    }

    const segment = new Float64Array(points.length);
    const cumulative = new Float64Array(points.length);
    const blockCount = Math.max(1, Math.ceil((points.length - 1) / BLOCK_SEGMENTS));
    const minLat = new Float64Array(blockCount).fill(Number.POSITIVE_INFINITY);
    const maxLat = new Float64Array(blockCount).fill(Number.NEGATIVE_INFINITY);
    const minLng = new Float64Array(blockCount).fill(Number.POSITIVE_INFINITY);
    const maxLng = new Float64Array(blockCount).fill(Number.NEGATIVE_INFINITY);

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        segment[index] = from && to ? haversineMeters(from, to) : 0;
        cumulative[index] = (cumulative[index - 1] as number) + (segment[index] as number);

        if (from && to) {
            const block = Math.floor((index - 1) / BLOCK_SEGMENTS);
            minLat[block] = Math.min(minLat[block] as number, from.lat, to.lat);
            maxLat[block] = Math.max(maxLat[block] as number, from.lat, to.lat);
            minLng[block] = Math.min(minLng[block] as number, from.lng, to.lng);
            maxLng[block] = Math.max(maxLng[block] as number, from.lng, to.lng);
        }
    }

    const built = { segment, cumulative, blockCount, minLat, maxLat, minLng, maxLng };
    indexCache.set(points, built);
    return built;
}

/**
 * Untere Schranke der Entfernung von `pos` zu jedem Punkt im Rahmen des Blocks.
 * Aus Haversine: sin²(d/2R) = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2); jeder der
 * beiden Summanden allein ist eine Schranke. Nur im Bereich, in dem das gilt
 * (Längenabstand unter 90°, keine Nähe zum Datumswechsel).
 */
function blockLowerBound(index: RouteIndex, block: number, pos: LatLng): number {
    const lowLat = index.minLat[block] as number;
    const highLat = index.maxLat[block] as number;
    const dLat = pos.lat < lowLat ? lowLat - pos.lat : pos.lat > highLat ? pos.lat - highLat : 0;
    let bound = dLat * METERS_PER_LAT_DEGREE;

    const lowLng = index.minLng[block] as number;
    const highLng = index.maxLng[block] as number;
    const dLng = pos.lng < lowLng ? lowLng - pos.lng : pos.lng > highLng ? pos.lng - highLng : 0;

    if (dLng > 0 && dLng < 90 && Math.abs(pos.lng) < 170 && Math.abs(lowLng) < 170 && Math.abs(highLng) < 170) {
        const latMax = Math.max(Math.abs(pos.lat), Math.abs(lowLat), Math.abs(highLat));
        const cos = Math.cos((latMax * Math.PI) / 180);
        const lngBound =
            2 * EARTH_RADIUS_M * Math.asin(Math.min(1, cos * Math.sin((dLng * Math.PI) / 360)));
        bound = Math.max(bound, lngBound);
    }

    return bound;
}

/** Erster Index ab 1, dessen Summe `predicate` erfüllt (monoton in `cumulative`). */
function firstIndexFrom(
    cumulative: Float64Array,
    predicate: (walked: number) => boolean,
): number {
    let low = 1;
    let high = cumulative.length;

    while (low < high) {
        const mid = (low + high) >>> 1;

        if (predicate(cumulative[mid] as number)) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    return low;
}

export function pointAtFraction(points: LatLng[], frac: number): LatLng {
    const start = points[0];
    const end = points[points.length - 1];

    if (!start || !end) {
        return { lat: 50.9375, lng: 6.9603 };
    }

    const clamped = Math.min(1, Math.max(0, frac));
    const target = routeLengthMeters(points) * clamped;
    const { segment, cumulative } = routeIndex(points);
    const index = firstIndexFrom(cumulative, (walked) => walked >= target);

    if (index >= points.length) {
        return end;
    }

    const from = points[index - 1];
    const to = points[index];

    if (!from || !to) {
        return end;
    }

    const length = segment[index] as number;
    const t = length === 0 ? 0 : (target - (cumulative[index - 1] as number)) / length;
    return {
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
    };
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
    const { cumulative } = routeIndex(points);

    // Die Summen steigen monoton: die passenden Vertices liegen am Stück.
    for (
        let index = firstIndexFrom(cumulative, (walked) => walked > startM + 0.5);
        index < points.length && (cumulative[index] as number) < endM - 0.5;
        index += 1
    ) {
        const to = points[index];

        if (to) {
            collected.push(to);
        }
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

    const route = routeIndex(points);
    const { segment, cumulative } = route;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    let bestT = 0;

    // Blöcke nach ihrer unteren Schranke: sobald sie über dem besten Wert liegt,
    // kann kein weiterer Block ihn schlagen (die Schranke ist sicher zu niedrig).
    const bounds = new Float64Array(route.blockCount);
    const order: number[] = [];

    for (let block = 0; block < route.blockCount; block += 1) {
        bounds[block] = blockLowerBound(route, block, pos);
        order.push(block);
    }

    order.sort((left, right) => (bounds[left] as number) - (bounds[right] as number));

    for (const block of order) {
        if ((bounds[block] as number) * BOUND_SAFETY > bestDist) {
            break;
        }

        const first = block * BLOCK_SEGMENTS + 1;
        const last = Math.min(points.length - 1, first + BLOCK_SEGMENTS - 1);

        for (let index = first; index <= last; index += 1) {
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
            const projectedLat = from.lat + aby * t;

            // Die Entfernung ist nie kleiner als der Breitengrad-Abstand; ein
            // Segment, das schon darüber liegt, kann den besten Wert nicht schlagen.
            if (
                Math.abs(pos.lat - projectedLat) * METERS_PER_LAT_DEGREE >
                bestDist
            ) {
                continue;
            }

            const dist = haversineMeters(pos, {
                lat: projectedLat,
                lng: from.lng + abx * t,
            });

            // Gleichstand gewinnt der frühere Index, wie beim Ablauf von vorn.
            if (dist < bestDist || (dist === bestDist && index < bestIndex)) {
                bestDist = dist;
                bestIndex = index;
                bestT = t;
            }
        }
    }

    const bestAlong =
        bestIndex === 0
            ? 0
            : (cumulative[bestIndex - 1] as number) + (segment[bestIndex] as number) * bestT;

    return Math.min(1, Math.max(0, bestAlong / total));
}

/** Kleinster Mindestabstand von `pos` zu den Blöcken der Strecke. */
function routeLowerBound(points: LatLng[], pos: LatLng): number {
    const route = routeIndex(points);
    let bound = Number.POSITIVE_INFINITY;

    for (let block = 0; block < route.blockCount; block += 1) {
        bound = Math.min(bound, blockLowerBound(route, block, pos));
    }

    return bound;
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

/**
 * Nächste gebackene Strecke innerhalb von 80 km, sonst die überhaupt nächste.
 * Ein Start am Münchner Depot bleibt auf München–Nürnberg.
 */
export function pickRoute(vehicleId: number, pos: LatLng): SimRoute {
    const rank = (routes: SimRoute[]) =>
        routes
            .map((route) => ({ route, dist: distanceToRoute(route, pos) }))
            .sort((left, right) => left.dist - right.dist);

    // Eine Strecke, deren Mindestabstand schon über 80 km liegt, kann nicht
    // nah sein; ihr genauer Abstand wird nur gebraucht, wenn keine nah ist.
    let ranked = rank(
        SIM_ROUTES.filter(
            (route) =>
                routeLowerBound(route.points, pos) * BOUND_SAFETY <=
                NEAR_ROUTE_METERS,
        ),
    );

    if (ranked.length === 0 || (ranked[0]?.dist ?? 0) > NEAR_ROUTE_METERS) {
        ranked = rank(SIM_ROUTES);
    }

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
    /**
     * Beim Start auf eine freie Stelle der Strecke versetzt (siehe
     * `spreadOnRoute`): die bisherige Fahrt endet, eine neue beginnt dort.
     */
    relocated: boolean;
};

/** Näher als das an einem anderen Fahrzeug derselben Strecke gilt als Kolonne. */
const CONVOY_METERS = 500;

/**
 * Viele Fahrzeuge stehen beim Start auf demselben Fleck (sie wurden im Depot
 * oder am Streckenanfang auf „Auf Fahrt“ gesetzt) und führen dann als Kolonne
 * Stoßstange an Stoßstange. Ein Fahrzeug, das beim Start so nah an einem
 * anderen derselben Strecke steht, kommt in die Mitte der größten Lücke und
 * fährt in eine zufällige, aber feste Richtung. Wer frei steht, bleibt, wo er
 * ist; nach einem Neustart stehen die Fahrzeuge schon verteilt, es springt
 * also keins zweimal.
 */
function spreadOnRoute(
    vehicleId: number,
    routeId: string,
    frac: number,
    length: number,
): { routeId: string; frac: number; direction: 1 | -1 } | null {
    const route = SIM_ROUTES.find((entry) => entry.id === routeId);

    if (!route || length === 0) {
        return null;
    }

    const here = pointAtFraction(route.points, frac);
    const onRoute = new Map<string, number[]>();
    let crowded = false;

    // Several roads start in the same city: a convoy is about the place,
    // not only about the road.
    for (const [id, other] of progressByVehicle) {
        if (id === vehicleId) {
            continue;
        }

        const list = onRoute.get(other.routeId);

        if (list) {
            list.push(other.frac);
        } else {
            onRoute.set(other.routeId, [other.frac]);
        }

        const otherRoute =
            other.routeId === routeId
                ? route
                : SIM_ROUTES.find((entry) => entry.id === other.routeId);

        if (
            !crowded &&
            otherRoute &&
            haversineMeters(here, pointAtFraction(otherRoute.points, other.frac)) <
                CONVOY_METERS
        ) {
            crowded = true;
        }
    }

    if (!crowded) {
        return null;
    }

    // The widest free stretch on any road, in metres: a fleet sends its
    // vehicles over all its roads, not all of them onto the nearest one.
    let best = { routeId, from: 0, to: 1, meters: -1 };

    for (const candidate of SIM_ROUTES) {
        const candidateLength = routeLengthMeters(candidate.points);
        const stops = [
            0,
            ...(onRoute.get(candidate.id) ?? []).sort((a, b) => a - b),
            1,
        ];

        for (let index = 1; index < stops.length; index += 1) {
            const from = stops[index - 1]!;
            const to = stops[index]!;
            const meters = (to - from) * candidateLength;

            if (meters > best.meters) {
                best = { routeId: candidate.id, from, to, meters };
            }
        }
    }

    return {
        routeId: best.routeId,
        frac: (best.from + best.to) / 2,
        direction: vehicleId % 2 === 0 ? 1 : -1,
    };
}

export function nextSimTick(
    vehicleId: number,
    current: LatLng,
    currentSpeed: number | null,
    /** Echte Sekunden seit dem letzten Ping dieses Fahrzeugs. */
    elapsedS = SIM_PING_SECONDS,
): SimTick {
    let state = progressByVehicle.get(vehicleId);
    let relocated = false;

    if (!state) {
        const picked = pickRoute(vehicleId, current);
        const frac = nearestFraction(picked.points, current);
        const spread = spreadOnRoute(
            vehicleId,
            picked.id,
            frac,
            routeLengthMeters(picked.points),
        );
        relocated = spread !== null;
        state = spread
            ? spread
            : {
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
    const meters = (speed * elapsedS * TIME_SCALE) / 3.6;
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
        relocated,
    };
}
