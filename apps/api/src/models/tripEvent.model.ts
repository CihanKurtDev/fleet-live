import type { TripEvent, TripEventType } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { EVENT_COUNT_SQL } from "../db/tripEvents";

const SELECT_OPEN_TRIP = `
    SELECT id, distance_m FROM trips WHERE vehicle_id = ? AND ended_at IS NULL
`;

const SELECT_OPEN_EVENT = `
    SELECT id FROM trip_events
    WHERE trip_id = ? AND type = ? AND ended_at IS NULL
    LIMIT 1
`;

const INSERT_EVENT = `
    INSERT INTO trip_events (
        trip_id, type, alert_id, started_at, from_m, max_speed_kmh, limit_kmh
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
`;

// Speed and limit are one pair, the worst place of the run so far.
const UPDATE_SPEEDING = `
    UPDATE trip_events
    SET max_speed_kmh = ?,
        limit_kmh = ?,
        alert_id = COALESCE(alert_id, ?)
    WHERE id = ?
`;

// A signal loss is a point (the vehicle stood); a speeding run ends where
// the trip has got to.
const END_FOR_VEHICLES = `
    UPDATE trip_events
    SET ended_at = ?,
        to_m = CASE WHEN type = 'OFFLINE' THEN from_m
                    ELSE (SELECT t.distance_m FROM trips t WHERE t.id = trip_events.trip_id)
               END
    WHERE type = ?
      AND ended_at IS NULL
      AND trip_id IN (
          SELECT id FROM trips
          WHERE ended_at IS NULL
            AND vehicle_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
      )
`;

const LIST_FOR_TRIP = `
    SELECT
        e.id,
        e.type,
        e.started_at,
        e.ended_at,
        e.from_m,
        e.to_m,
        e.max_speed_kmh,
        e.limit_kmh,
        e.estimated,
        e.alert_id,
        a.resolved_at AS alert_resolved_at,
        ${EVENT_COUNT_SQL} AS count
    FROM trip_events e
    INNER JOIN trips t ON t.id = e.trip_id
    LEFT JOIN alerts a ON a.id = e.alert_id
    WHERE e.trip_id = ?
    ORDER BY e.from_m, e.started_at, e.id
`;

type OpenTrip = { id: number; distance_m: number };

type EventRow = {
    id: number;
    type: TripEventType;
    started_at: string;
    ended_at: string | null;
    from_m: number;
    to_m: number | null;
    max_speed_kmh: number | null;
    limit_kmh: number | null;
    estimated: number;
    alert_id: number | null;
    alert_resolved_at: string | null;
    count: number;
};

const openTrip = (vehicleId: number) =>
    stmt(SELECT_OPEN_TRIP).get(vehicleId) as OpenTrip | undefined;

const openEventId = (tripId: number, type: TripEventType) =>
    (stmt(SELECT_OPEN_EVENT).get(tripId, type) as { id: number } | undefined)
        ?.id;

/**
 * Records the events of the running trip as they happen. Without a running
 * trip nothing is recorded: the event has no place on a line.
 */
export class TripEventModel {
    /** Metres driven on the running trip so far, or null without one. */
    static openDistance(vehicleId: number): number | null {
        const trip = openTrip(vehicleId);
        return trip ? Number(trip.distance_m) : null;
    }

    /**
     * The vehicle is over the limit: keep the run's top speed, or start the
     * run. It starts at `fromM` (where it first went over), or where the
     * trip is now when it carries on into a new trip.
     */
    static trackSpeeding(
        vehicleId: number,
        input: {
            alertId: number | undefined;
            startedAt: string;
            fromM?: number;
            maxSpeedKmh: number;
            limitKmh: number;
        },
    ): void {
        const trip = openTrip(vehicleId);

        if (!trip) {
            return;
        }

        const existing = openEventId(trip.id, "SPEEDING");

        if (existing !== undefined) {
            stmt(UPDATE_SPEEDING).run(
                input.maxSpeedKmh,
                input.limitKmh,
                input.alertId ?? null,
                existing,
            );
            return;
        }

        const now = Number(trip.distance_m);
        const fromM =
            input.fromM !== undefined && input.fromM <= now ? input.fromM : now;

        stmt(INSERT_EVENT).run(
            trip.id,
            "SPEEDING",
            input.alertId ?? null,
            input.startedAt,
            fromM,
            input.maxSpeedKmh,
            input.limitKmh,
        );
    }

    /** Lost signal while driving: a point where the vehicle stands. */
    static startOffline(
        vehicleId: number,
        input: { alertId: number; startedAt: string },
    ): void {
        const trip = openTrip(vehicleId);

        if (!trip || openEventId(trip.id, "OFFLINE") !== undefined) {
            return;
        }

        stmt(INSERT_EVENT).run(
            trip.id,
            "OFFLINE",
            input.alertId,
            input.startedAt,
            Number(trip.distance_m),
            null,
            null,
        );
    }

    /** Ends the running events of this type on these vehicles' running trips. */
    static end(
        vehicleIds: readonly number[],
        type: TripEventType,
        endedAt: string,
    ): void {
        if (vehicleIds.length === 0) {
            return;
        }

        stmt(END_FOR_VEHICLES).run(endedAt, type, JSON.stringify(vehicleIds));
    }

    static listForTrip(tripId: number): TripEvent[] {
        return (stmt(LIST_FOR_TRIP).all(tripId) as EventRow[]).map((row) => ({
            id: row.id,
            type: row.type,
            started_at: row.started_at,
            ended_at: row.ended_at,
            from_m: Number(row.from_m),
            to_m: row.to_m === null ? null : Number(row.to_m),
            max_speed_kmh:
                row.max_speed_kmh === null ? null : Number(row.max_speed_kmh),
            limit_kmh: row.limit_kmh === null ? null : Number(row.limit_kmh),
            estimated: row.estimated === 1,
            count: Number(row.count),
            alert_id: row.alert_id,
            alert_open: row.alert_id !== null && row.alert_resolved_at === null,
        }));
    }
}
