import type { GeoPoint, Trip } from "@fleet-live/shared";
import {
    decodePolyline,
    encodePoints,
    encodePolyline,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { haversineMeters, simplifyPath } from "../lib/geo";
import { nowSqlite } from "../lib/sqlTime";

/**
 * Unterhalb dieser Distanz ist ein neuer Punkt Messrauschen und kein Stück
 * Strecke. Hält den Verlauf eines stehenden Fahrzeugs bei einem Punkt.
 */
const MIN_APPEND_METERS = 20;

/**
 * Toleranz der Vereinfachung am Fahrtende. 12 m liegen unter der Breite einer
 * Autobahn, die gezeichnete Linie verändert sich also nicht sichtbar.
 */
const SIMPLIFY_TOLERANCE_METERS = 12;

const SELECT_OPEN = `
    SELECT id, last_latitude, last_longitude
    FROM trips
    WHERE vehicle_id = ? AND ended_at IS NULL
`;

const SELECT_OPEN_FULL = `
    SELECT id, path, point_count
    FROM trips
    WHERE vehicle_id = ? AND ended_at IS NULL
`;

const SELECT_LATEST = `
    SELECT
        id,
        vehicle_id,
        started_at,
        ended_at,
        path,
        point_count,
        distance_m,
        max_speed
    FROM trips
    WHERE vehicle_id = ?
    ORDER BY ended_at IS NULL DESC, started_at DESC, id DESC
    LIMIT 1
`;

/**
 * Ein Statement statt SELECT-dann-INSERT: der Unique-Index auf offenen Fahrten
 * würde sonst als Constraint-Fehler durchschlagen, und der Error-Handler
 * übersetzt jeden Unique-Verstoß in "Kennzeichen ist bereits vergeben".
 */
const INSERT_TRIP_IF_NONE = `
    INSERT INTO trips (vehicle_id, started_at)
    SELECT ?, ?
    WHERE NOT EXISTS (
        SELECT 1 FROM trips WHERE vehicle_id = ? AND ended_at IS NULL
    )
`;

/**
 * Der Verlauf wächst in SQL, nicht in Node: so muss der bestehende String
 * pro Punkt nicht gelesen und zurückgeschrieben werden.
 */
const APPEND_POINT = `
    UPDATE trips
    SET path = path || ?,
        point_count = point_count + 1,
        distance_m = distance_m + ?,
        max_speed = MAX(max_speed, ?),
        last_latitude = ?,
        last_longitude = ?
    WHERE id = ?
`;

const RAISE_MAX_SPEED = `
    UPDATE trips SET max_speed = MAX(max_speed, ?) WHERE id = ?
`;

const CLOSE_TRIP = `
    UPDATE trips
    SET ended_at = ?, path = ?, point_count = ?
    WHERE id = ?
`;

type OpenTripRow = {
    id: number;
    last_latitude: number | null;
    last_longitude: number | null;
};

export class TripModel {
    /** Idempotent: eine offene Fahrt bleibt die offene Fahrt. */
    static open(vehicleId: number, at: string = nowSqlite()): OpenTripRow {
        const existing = stmt(SELECT_OPEN).get(vehicleId) as
            | OpenTripRow
            | undefined;

        if (existing) {
            return existing;
        }

        stmt(INSERT_TRIP_IF_NONE).run(vehicleId, at, vehicleId);

        const opened = stmt(SELECT_OPEN).get(vehicleId) as
            | OpenTripRow
            | undefined;

        if (!opened) {
            throw new Error(`Could not open a trip for vehicle ${vehicleId}.`);
        }

        return opened;
    }

    /**
     * Hängt gemeldete Positionen an die laufende Fahrt an.
     *
     * Der Simulator übergibt die Straßenvertices zwischen zwei Ticks, nicht
     * nur die Sehne. Unter `MIN_APPEND_METERS` gilt ein einzelner Punkt als
     * Rauschen; eine Kurve aus mehreren Vertices bleibt erhalten.
     *
     * Fehlt die Fahrt, wird sie hier eröffnet.
     *
     * @returns Encoded-Polyline-Suffix relativ zum bisherigen Ende, oder
     *          `undefined` wenn nichts geschrieben wurde. `reset` ist wahr,
     *          wenn dieser Suffix eine neue Fahrt beginnt — nicht anhängen.
     */
    static appendPoints(
        vehicleId: number,
        points: GeoPoint[],
        speed: number,
    ): { suffix: string; reset: boolean } | undefined {
        if (points.length === 0) {
            return undefined;
        }

        const open = this.open(vehicleId);
        const previous =
            open.last_latitude !== null && open.last_longitude !== null
                ? { lat: open.last_latitude, lng: open.last_longitude }
                : undefined;

        const kept: GeoPoint[] = [];
        let last = previous;
        let meters = 0;

        for (const point of points) {
            const gap = last ? haversineMeters(last, point) : 0;

            if (last && gap < 0.5) {
                continue;
            }

            if (last && points.length === 1 && gap < MIN_APPEND_METERS) {
                continue;
            }

            meters += gap;
            kept.push(point);
            last = point;
        }

        if (kept.length === 0 || !last) {
            stmt(RAISE_MAX_SPEED).run(speed, open.id);
            return undefined;
        }

        const reset = previous === undefined;
        const suffix = encodePoints(kept, previous);

        stmt(APPEND_POINT).run(
            suffix,
            meters,
            speed,
            last.lat,
            last.lng,
            open.id,
        );

        return { suffix, reset };
    }

    static appendPoint(
        vehicleId: number,
        point: GeoPoint,
        speed: number,
    ): { suffix: string; reset: boolean } | undefined {
        return this.appendPoints(vehicleId, [point], speed);
    }

    /**
     * Beendet die Fahrt und dickt den Verlauf ein. `distance_m` bleibt die
     * Summe der gemeldeten Teilstrecken, nicht die Länge der eingedickten
     * Linie: gefahren wurde die volle Strecke.
     */
    static close(vehicleId: number, at: string = nowSqlite()): void {
        const open = stmt(SELECT_OPEN_FULL).get(vehicleId) as
            | { id: number; path: string; point_count: number }
            | undefined;

        if (!open) {
            return;
        }

        if (open.point_count < 3) {
            stmt(CLOSE_TRIP).run(at, open.path, open.point_count, open.id);
            return;
        }

        const simplified = simplifyPath(
            decodePolyline(open.path),
            SIMPLIFY_TOLERANCE_METERS,
        );

        stmt(CLOSE_TRIP).run(
            at,
            encodePolyline(simplified),
            simplified.length,
            open.id,
        );
    }

    /** Die laufende Fahrt, sonst die letzte beendete. */
    static latestForVehicle(vehicleId: number): Trip | null {
        const row = stmt(SELECT_LATEST).get(vehicleId) as Trip | undefined;

        return row ?? null;
    }
}
