import type { GeoPoint } from "@fleet-live/shared";

/** Näherung für die Umrechnung von Grad in Meter innerhalb eines Landes. */
const METERS_PER_DEGREE = 111_320;

/**
 * Punkt im Abstand `distanceMeters` und Peilung `bearingRad` (0 = Nord).
 * Eben genug für einen Hof-Versatz von wenigen hundert Metern.
 */
export function destinationPoint(
    origin: GeoPoint,
    distanceMeters: number,
    bearingRad: number,
): GeoPoint {
    const latRad = (origin.lat * Math.PI) / 180;
    const north = distanceMeters * Math.cos(bearingRad);
    const east = distanceMeters * Math.sin(bearingRad);

    return {
        lat: origin.lat + north / METERS_PER_DEGREE,
        lng:
            origin.lng +
            east / (METERS_PER_DEGREE * Math.max(0.2, Math.cos(latRad))),
    };
}

/** Zufälliger Punkt im Ring [minMeters, maxMeters) um `origin`. */
export function offsetAroundMeters(
    origin: GeoPoint,
    minMeters: number,
    maxMeters: number,
): GeoPoint {
    const span = Math.max(0, maxMeters - minMeters);
    const distance = minMeters + Math.random() * span;
    const bearing = Math.random() * Math.PI * 2;

    return destinationPoint(origin, distance, bearing);
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
    const earth = 6_371_000;
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const chord =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * earth * Math.asin(Math.min(1, Math.sqrt(chord)));
}

export function pathLengthMeters(points: readonly GeoPoint[]): number {
    let total = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];

        if (from && to) {
            total += haversineMeters(from, to);
        }
    }

    return total;
}

/** Abstand eines Punkts zur Strecke start–end, planar genähert. */
function perpendicularMeters(
    point: GeoPoint,
    start: GeoPoint,
    end: GeoPoint,
): number {
    const scale = Math.cos((point.lat * Math.PI) / 180);
    const px = (point.lng - start.lng) * scale * METERS_PER_DEGREE;
    const py = (point.lat - start.lat) * METERS_PER_DEGREE;
    const ex = (end.lng - start.lng) * scale * METERS_PER_DEGREE;
    const ey = (end.lat - start.lat) * METERS_PER_DEGREE;
    const lengthSquared = ex * ex + ey * ey;

    if (lengthSquared === 0) {
        return Math.hypot(px, py);
    }

    const t = Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));

    return Math.hypot(px - ex * t, py - ey * t);
}

/**
 * Ramer-Douglas-Peucker: verwirft Stützpunkte, die weniger als `toleranceMeters`
 * von der Verbindungslinie ihrer Nachbarn abweichen.
 *
 * Autobahnetappen bestehen fast nur aus Geraden und schrumpfen dabei um eine
 * Größenordnung, ohne dass sich der gezeichnete Verlauf sichtbar ändert.
 * Iterativ statt rekursiv, damit ein langer Verlauf den Stack nicht sprengt.
 */
export function simplifyPath(
    points: readonly GeoPoint[],
    toleranceMeters: number,
): GeoPoint[] {
    if (points.length <= 2) {
        return [...points];
    }

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const pending: Array<[number, number]> = [[0, points.length - 1]];

    while (pending.length > 0) {
        const segment = pending.pop();
        if (!segment) {
            continue;
        }

        const [first, last] = segment;
        const start = points[first];
        const end = points[last];

        if (!start || !end) {
            continue;
        }

        let worstDistance = 0;
        let worstIndex = -1;

        for (let index = first + 1; index < last; index += 1) {
            const point = points[index];
            if (!point) {
                continue;
            }

            const distance = perpendicularMeters(point, start, end);

            if (distance > worstDistance) {
                worstDistance = distance;
                worstIndex = index;
            }
        }

        if (worstIndex !== -1 && worstDistance > toleranceMeters) {
            keep[worstIndex] = 1;
            pending.push([first, worstIndex], [worstIndex, last]);
        }
    }

    return points.filter((_, index) => keep[index] === 1);
}
