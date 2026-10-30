import type {
    GeoPoint,
    Trip,
    TripListItem,
    TripListQuery,
    TripListResponse,
} from "@fleet-live/shared";
import {
    decodePolyline,
    encodePoints,
    encodePolyline,
} from "@fleet-live/shared";
import { PrivacyModel } from "./privacy.model";
import { stmt } from "../db/statements";
import { EVENT_COUNT_SQL } from "../db/tripEvents";
import { haversineMeters, simplifyPath } from "../lib/geo";
import { nowSqlite, sqliteDaysAgo } from "../lib/sqlTime";
import { pagedQuery } from "../lib/pagination";
import { TripEventModel } from "./tripEvent.model";

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
    SELECT
        t.id,
        t.path,
        t.point_count,
        t.distance_m,
        t.started_at,
        v.company_id
    FROM trips t
    INNER JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.vehicle_id = ?
      AND t.ended_at IS NULL
`;

const ADD_MONTH_KM = `
    INSERT INTO trip_month_km (company_id, month, distance_m)
    VALUES (?, ?, ?)
    ON CONFLICT(company_id, month) DO UPDATE SET
        distance_m = distance_m + excluded.distance_m
`;

/**
 * The row fields every trip query returns: who drove (snapshot at the start)
 * and how often the trip went over the limit or lost signal. An estimated
 * event of an older trip counts the overshoots its warning summed up.
 */
const TRIP_COLUMNS = `
        t.id,
        t.vehicle_id,
        t.started_at,
        t.ended_at,
        t.point_count,
        t.distance_m,
        t.max_speed,
        t.driver_id,
        d.name AS driver_name,
        (
            SELECT COALESCE(SUM(${EVENT_COUNT_SQL}), 0)
            FROM trip_events e
            LEFT JOIN alerts a ON a.id = e.alert_id
            WHERE e.trip_id = t.id AND e.type = 'SPEEDING'
        ) AS speeding_count,
        (
            SELECT COUNT(*) FROM trip_events e
            WHERE e.trip_id = t.id AND e.type = 'OFFLINE'
        ) AS offline_count`;

const SELECT_LATEST = `
    SELECT
        ${TRIP_COLUMNS},
        t.path
    FROM trips t
    INNER JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN drivers d ON d.id = t.driver_id
    WHERE t.vehicle_id = ?
      AND v.company_id = ?
    ORDER BY t.ended_at IS NULL DESC, t.started_at DESC, t.id DESC
    LIMIT 1
`;

const LIST_FOR_VEHICLE = `
    SELECT
        ${TRIP_COLUMNS},
        COUNT(*) OVER () AS total
    FROM trips t
    INNER JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN drivers d ON d.id = t.driver_id
    WHERE t.vehicle_id = ?
      AND v.company_id = ?
    ORDER BY t.ended_at IS NULL DESC, t.started_at DESC, t.id DESC
    LIMIT ? OFFSET ?
`;

const SELECT_ONE = `
    SELECT
        ${TRIP_COLUMNS},
        t.path
    FROM trips t
    INNER JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN drivers d ON d.id = t.driver_id
    WHERE t.id = ?
      AND t.vehicle_id = ?
      AND v.company_id = ?
`;

const COUNT_FOR_VEHICLE = `
    SELECT COUNT(*) AS total
    FROM trips t
    INNER JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.vehicle_id = ?
      AND v.company_id = ?
`;

/**
 * Ein Statement statt SELECT-dann-INSERT: der Unique-Index auf offenen Fahrten
 * würde sonst als Constraint-Fehler durchschlagen, und der Error-Handler
 * übersetzt jeden Unique-Verstoß in "Kennzeichen ist bereits vergeben".
 */
const INSERT_TRIP_IF_NONE = `
    INSERT INTO trips (vehicle_id, started_at, driver_id)
    SELECT ?, ?, (SELECT current_driver_id FROM vehicles WHERE id = ?)
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

// What is still running when the trip ends ends with it, where the trip ended.
const END_TRIP_EVENTS = `
    UPDATE trip_events
    SET ended_at = ?,
        to_m = CASE WHEN type = 'OFFLINE' THEN from_m ELSE ? END
    WHERE trip_id = ?
      AND ended_at IS NULL
`;

const PRUNE_CLOSED_FOR_COMPANY = `
    DELETE FROM trips
    WHERE ended_at IS NOT NULL
      AND ended_at < ?
      AND vehicle_id IN (
          SELECT id FROM vehicles WHERE company_id = ?
      )
`;

type TripRow = Omit<TripListItem, "speeding_count" | "offline_count"> & {
    speeding_count: number | bigint;
    offline_count: number | bigint;
};

const toListItem = (row: TripRow): TripListItem => ({
    id: row.id,
    vehicle_id: row.vehicle_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    point_count: row.point_count,
    distance_m: row.distance_m,
    max_speed: row.max_speed,
    driver_id: row.driver_id,
    driver_name: row.driver_name,
    speeding_count: Number(row.speeding_count),
    offline_count: Number(row.offline_count),
});

const toTrip = (row: TripRow & { path: string }): Trip => ({
    ...toListItem(row),
    path: row.path,
    events: TripEventModel.listForTrip(row.id),
});

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

        stmt(INSERT_TRIP_IF_NONE).run(vehicleId, at, vehicleId, vehicleId);

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
     *          `meters` ist, was `distance_m` dazubekam; der Tick zählt es auf
     *          den Kilometerstand.
     */
    static appendPoints(
        vehicleId: number,
        points: GeoPoint[],
        speed: number,
    ): { suffix: string; reset: boolean; meters: number } | undefined {
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

        return { suffix, reset, meters };
    }

    /**
     * Beendet die Fahrt und dickt den Verlauf ein. `distance_m` bleibt die
     * Summe der gemeldeten Teilstrecken, nicht die Länge der eingedickten
     * Linie: gefahren wurde die volle Strecke.
     */
    static close(vehicleId: number, at: string = nowSqlite()): void {
        const open = stmt(SELECT_OPEN_FULL).get(vehicleId) as
            | {
                  id: number;
                  path: string;
                  point_count: number;
                  distance_m: number;
                  started_at: string;
                  company_id: number;
              }
            | undefined;

        if (!open) {
            return;
        }

        if (open.point_count < 3) {
            stmt(CLOSE_TRIP).run(at, open.path, open.point_count, open.id);
        } else {
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

        stmt(END_TRIP_EVENTS).run(at, Number(open.distance_m), open.id);

        this.addClosedDistance(
            open.company_id,
            open.started_at,
            Number(open.distance_m),
        );
    }

    /**
     * Monatssumme für die Schicht-Charts. Unabhängig vom Trip-Pfad;
     * Prune ändert diese Zeilen nicht.
     */
    static addClosedDistance(
        companyId: number,
        startedAt: string,
        distanceM: number,
    ): void {
        if (!(distanceM > 0)) {
            return;
        }

        stmt(ADD_MONTH_KM).run(companyId, startedAt.slice(0, 7), distanceM);
    }

    /**
     * Löscht geschlossene Fahrten dieser Firma, die älter sind als ihre
     * Aufbewahrung (Firmenwert, sonst `TRIP_RETENTION_DAYS`; 0 = behalten).
     * Offene Fahrten und andere Firmen bleiben. Kein `company_id` auf `trips`.
     */
    static pruneClosedForCompany(companyId: number): number {
        const days = PrivacyModel.tripDays(companyId);

        if (days <= 0) {
            return 0;
        }

        const result = stmt(PRUNE_CLOSED_FOR_COMPANY).run(
            sqliteDaysAgo(days),
            companyId,
        );

        return Number(result.changes);
    }

    /** Die laufende Fahrt, sonst die letzte beendete. */
    static latestForVehicle(
        vehicleId: number,
        companyId: number,
    ): Trip | null {
        const row = stmt(SELECT_LATEST).get(vehicleId, companyId) as
            | (TripRow & { path: string })
            | undefined;

        return row ? toTrip(row) : null;
    }

    static listForVehicle(
        vehicleId: number,
        companyId: number,
        query: TripListQuery,
    ): TripListResponse {
        const offset = (query.page - 1) * query.limit;

        return pagedQuery({
            listSql: LIST_FOR_VEHICLE,
            listParams: [vehicleId, companyId, query.limit, offset],
            countSql: COUNT_FOR_VEHICLE,
            countParams: [vehicleId, companyId],
            page: query.page,
            limit: query.limit,
            map: (row) => toListItem(row as TripRow),
        });
    }

    static getById(
        tripId: number,
        vehicleId: number,
        companyId: number,
    ): Trip | null {
        const row = stmt(SELECT_ONE).get(tripId, vehicleId, companyId) as
            | (TripRow & { path: string })
            | undefined;

        return row ? toTrip(row) : null;
    }
}
