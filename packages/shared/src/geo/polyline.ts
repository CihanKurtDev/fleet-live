/**
 * Encoded Polyline (Google-Algorithmus, Präzision 5, ~1 m Auflösung).
 *
 * Ein Streckenverlauf als Delta-kodierter String statt als Punktliste: rund
 * 6 statt 40 Byte pro Punkt, und er lässt sich zeichenweise verlängern, ohne
 * den bestehenden Verlauf zu dekodieren.
 */

export type GeoPoint = {
    lat: number;
    lng: number;
};

const PRECISION = 1e5;

function encodeSigned(value: number): string {
    let remaining = value < 0 ? ~(value << 1) : value << 1;
    let encoded = "";

    while (remaining >= 0x20) {
        encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
        remaining >>= 5;
    }

    return encoded + String.fromCharCode(remaining + 63);
}

function grid(value: number): number {
    return Math.round(value * PRECISION);
}

/**
 * Kodiert einen Punkt relativ zu seinem Vorgänger.
 *
 * `previous` muss derselbe Punkt sein, mit dem der bisherige String endet —
 * die Deltas werden auf dem gerundeten Gitter gebildet, sonst summiert sich
 * der Rundungsfehler über die Fahrt auf.
 */
export function encodePoint(point: GeoPoint, previous?: GeoPoint): string {
    const lastLat = previous ? grid(previous.lat) : 0;
    const lastLng = previous ? grid(previous.lng) : 0;

    return (
        encodeSigned(grid(point.lat) - lastLat) +
        encodeSigned(grid(point.lng) - lastLng)
    );
}

/**
 * Kodiert Punkte relativ zu `previous` (letzter Punkt des schon gespeicherten
 * Verlaufs). Ohne Vorgänger beginnt die Kette bei (0, 0) — das ist ein
 * vollständiger String, kein Suffix.
 */
export function encodePoints(
    points: readonly GeoPoint[],
    previous?: GeoPoint,
): string {
    let encoded = "";
    let last = previous;

    for (const point of points) {
        encoded += encodePoint(point, last);
        last = point;
    }

    return encoded;
}

export function encodePolyline(points: readonly GeoPoint[]): string {
    return encodePoints(points);
}

export function decodePolyline(encoded: string): GeoPoint[] {
    const points: GeoPoint[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let shift = 0;
        let result = 0;
        let byte = 0;

        do {
            byte = encoded.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index < encoded.length);

        lat += result & 1 ? ~(result >> 1) : result >> 1;

        shift = 0;
        result = 0;

        do {
            byte = encoded.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index < encoded.length);

        lng += result & 1 ? ~(result >> 1) : result >> 1;

        points.push({ lat: lat / PRECISION, lng: lng / PRECISION });
    }

    return points;
}
