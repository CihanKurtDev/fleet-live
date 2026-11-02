import type { GeoBBox } from "@fleet-live/shared";

/** A box around a circle, `around` times its radius on each side. */
export function circleBounds(
    latitude: number,
    longitude: number,
    radiusM: number,
    around = 3,
): GeoBBox {
    const dLat = (radiusM * around) / 111_320;
    const dLng = dLat / Math.cos((latitude * Math.PI) / 180);

    return {
        west: longitude - dLng,
        south: latitude - dLat,
        east: longitude + dLng,
        north: latitude + dLat,
    };
}

/** Great-circle distance in metres between two points. */
export function haversineMeters(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
): number {
    const earth = 6_371_000;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(latitudeB - latitudeA);
    const dLng = toRad(longitudeB - longitudeA);
    const latA = toRad(latitudeA);
    const latB = toRad(latitudeB);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;

    return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}
