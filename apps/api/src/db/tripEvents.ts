import type { DatabaseSync } from "node:sqlite";

/*
 * What happened on a trip, at which point of it: each time the vehicle was
 * over the limit (SPEEDING) and each signal loss while it drove (OFFLINE).
 * `from_m` / `to_m` are metres from the trip's start in the same measure as
 * `trips.distance_m` (the sum of the reported segments), so the map places
 * them on the drawn line by their share of it. The inbox warning stays one
 * row per trip; these rows are its parts.
 */
export const TRIP_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS trip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('SPEEDING', 'OFFLINE')),
    alert_id INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    from_m REAL NOT NULL,
    to_m REAL,
    max_speed_kmh REAL,
    limit_kmh REAL,
    -- Older trips: the point was estimated from the warning's time.
    estimated INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (trip_id)
        REFERENCES trips(id)
        ON DELETE CASCADE,

    FOREIGN KEY (alert_id)
        REFERENCES alerts(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_events_trip
    ON trip_events(trip_id, from_m);

CREATE INDEX IF NOT EXISTS idx_trip_events_alert
    ON trip_events(alert_id);
`;

function hasColumn(database: DatabaseSync, table: string, column: string) {
    const rows = database
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;

    return rows.some((row) => row.name === column);
}

/** Every start: the table, and the driver who drove each trip. */
export function ensureTripEvents(database: DatabaseSync) {
    database.exec(TRIP_EVENTS_SQL);

    if (!hasColumn(database, "trips", "driver_id")) {
        database.exec(
            `ALTER TABLE trips ADD COLUMN driver_id INTEGER
                 REFERENCES drivers(id) ON DELETE SET NULL`,
        );
    }

    database.exec(
        `CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id)`,
    );
}

/**
 * A warning that overlaps the trip: opened before its end, still running
 * (or ended) after its start. A speeding run goes on across a turnaround,
 * so one warning can cover several trips.
 */
const OVERLAPS = `
    julianday(a.created_at) <= julianday(t.ended_at)
    AND julianday(COALESCE(a.ended_at, a.resolved_at, 'now')) >= julianday(t.started_at)
`;

/**
 * For trips from before events were recorded (run once per migration). A
 * running trip is driven by the vehicle's current driver (no driver change
 * while driving). A closed one takes the driver of a warning that overlaps
 * it (the snapshot is the same person, for the same reason); without one it
 * stays unknown. Each overlapping warning becomes an event whose point is
 * estimated from its time (the trip's start when it began before), without
 * a stretch: the map shows where roughly, not how far.
 */
export function backfillTripHistory(database: DatabaseSync) {
    database.exec(`
        UPDATE trips
        SET driver_id = (
            SELECT v.current_driver_id FROM vehicles v WHERE v.id = trips.vehicle_id
        )
        WHERE ended_at IS NULL AND driver_id IS NULL;

        UPDATE trips
        SET driver_id = (
            SELECT a.driver_id
            FROM alerts a, trips t
            WHERE t.id = trips.id
              AND a.vehicle_id = t.vehicle_id
              AND a.driver_id IS NOT NULL
              AND ${OVERLAPS}
            ORDER BY a.created_at
            LIMIT 1
        )
        WHERE ended_at IS NOT NULL AND driver_id IS NULL;

        INSERT INTO trip_events (
            trip_id, type, alert_id, started_at, ended_at,
            from_m, to_m, max_speed_kmh, limit_kmh, estimated
        )
        SELECT
            t.id,
            a.type,
            a.id,
            MAX(a.created_at, t.started_at),
            a.ended_at,
            t.distance_m * COALESCE(
                MIN(1.0, MAX(0.0,
                    (julianday(a.created_at) - julianday(t.started_at))
                    / NULLIF(julianday(t.ended_at) - julianday(t.started_at), 0)
                )),
                0
            ),
            NULL,
            CASE WHEN a.type = 'SPEEDING'
                 THEN json_extract(a.details, '$.max_speed_kmh') END,
            CASE WHEN a.type = 'SPEEDING'
                 THEN json_extract(a.details, '$.limit_kmh') END,
            1
        FROM alerts a
        INNER JOIN trips t
            ON t.vehicle_id = a.vehicle_id
           AND t.ended_at IS NOT NULL
           AND ${OVERLAPS}
        WHERE a.type IN ('SPEEDING', 'OFFLINE')
          AND NOT EXISTS (
              SELECT 1 FROM trip_events e
              WHERE e.alert_id = a.id AND e.trip_id = t.id
          );
    `);
}

/**
 * How many overshoots an event stands for: an estimated one is the whole
 * warning when the warning began on this trip, else one run carried over.
 * Needs `e` (trip_events), `a` (its alert) and `t` (its trip).
 */
export const EVENT_COUNT_SQL = `
    CASE WHEN e.estimated = 1
              AND a.type = 'SPEEDING'
              AND julianday(a.created_at) >= julianday(t.started_at)
         THEN COALESCE(json_extract(a.details, '$.event_count'), 1)
         ELSE 1 END`;
