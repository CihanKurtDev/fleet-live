import L from "leaflet";

export type MapPoint = {
    latitude: number;
    longitude: number;
};

export const toLatLngs = (points: MapPoint[]): L.LatLng[] =>
    points.map((point) => L.latLng(point.latitude, point.longitude));

export const lerp = (from: L.LatLng, to: L.LatLng, t: number): L.LatLng =>
    L.latLng(
        from.lat + (to.lat - from.lat) * t,
        from.lng + (to.lng - from.lng) * t,
    );

/** Bereits zurückgelegte Vertices plus Zwischenpunkt — die Spur hinter dem Auto. */
export const pathAlong = (points: L.LatLng[], meters: number): L.LatLng[] => {
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

export const pathLength = (points: L.LatLng[]): number => {
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
