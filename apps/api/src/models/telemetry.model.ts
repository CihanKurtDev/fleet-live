import type { TelemetryPatch, TelemetryPoint, VehicleType } from "@fleet-live/shared";
import { config } from "../config";
import { db } from "../db/database";
import { stmt } from "../db/statements";
import { nowSqlite, nowSqliteMs } from "../lib/sqlTime";
import { simDashboardMeters } from "../sim/device";
import { nextSimTick, SIM_PING_SECONDS } from "../sim/routes";
import { SpeedingEventModel } from "./speedingEvent.model";
import { TripModel } from "./trip.model";
import { isCompanySimRunning } from "../lib/simControl";

type DrivingVehicle = {
    id: number;
    company_id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
    fuel_level: number;
    vehicle_type: VehicleType | null;
    odometer_m: number | null;
    /** The last report, to see a long pause. */
    recorded_at: string | null;
    /** The home depot, whose roads the simulated vehicle drives. */
    home_latitude: number | null;
    home_longitude: number | null;
};

/**
 * A trip that has not reported for this long has ended: the next report
 * starts a new one instead of drawing one trip over two days.
 */
export const TRIP_GAP_MS = 30 * 60 * 1000;

const msOf = (sqlite: string | null) =>
    sqlite === null ? null : Date.parse(`${sqlite.replace(" ", "T")}Z`);

/** Ein Ping, den ein Gerät senden würde: das Fahrzeug und die Zeit seit dem letzten. */
type Ping = { vehicle: DrivingVehicle; elapsedS: number };

/** Alle fahrenden Fahrzeuge, oder nur die Ids aus dem JSON-Array (`?` = null: alle). */
const SELECT_DRIVING = `
    SELECT
        v.id,
        v.company_id,
        -- Nur ohne gespeicherten Punkt (Altbestand vor Import/Backfill).
        -- Liegt der Punkt am Depot, wählt pickRoute die nächste Strecke:
        -- München bleibt auf München–Nürnberg, nicht auf Köln.
        COALESCE(t.latitude, 50.9375) AS latitude,
        COALESCE(t.longitude, 6.9603) AS longitude,
        t.speed,
        v.fuel_level,
        v.vehicle_type,
        v.odometer_m,
        t.recorded_at,
        hs.latitude AS home_latitude,
        hs.longitude AS home_longitude
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    LEFT JOIN sites hs ON hs.id = v.home_site_id
    WHERE v.status = 'DRIVING'
      AND (
          ?1 IS NULL
          OR v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?1))
      )
      AND (
          v.current_driver_id IS NOT NULL
          OR NOT EXISTS (
              SELECT 1 FROM driver_vehicles dv WHERE dv.vehicle_id = v.id
          )
      )
`;

const SELECT_LAST_POSITION = `
    SELECT
        v.fuel_level,
        t.latitude,
        t.longitude
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.id = ?
`;

/**
 * One write per ping on the vehicle row. The odometer is the dashboard
 * reading when the ping carries one (`?3`, then `odometer_reported_at` is the
 * ping time); otherwise it grows by the metres the trip got (NULL stays NULL).
 */
const UPDATE_VEHICLE_PING = `
    UPDATE vehicles
    SET fuel_level = ?1,
        speed_limit_kmh = ?2,
        odometer_m = COALESCE(?3, odometer_m + ?4),
        odometer_reported_at = CASE WHEN ?3 IS NULL THEN odometer_reported_at ELSE ?5 END
    WHERE id = ?6
`;

const INSERT_TELEMETRY = `
    INSERT INTO telemetry (vehicle_id, latitude, longitude, speed, recorded_at)
    VALUES (?, ?, ?, ?, ?)
`;

const PRUNE_TELEMETRY = `
    DELETE FROM telemetry
    WHERE vehicle_id = ? AND id IN (
        SELECT id FROM (
            SELECT id FROM telemetry
            WHERE vehicle_id = ?
            ORDER BY recorded_at DESC, id DESC
            LIMIT -1 OFFSET ?
        )
    )
`;

const SELECT_HISTORY = `
    SELECT id, vehicle_id, latitude, longitude, speed, recorded_at
    FROM telemetry
    WHERE vehicle_id = ?
    ORDER BY recorded_at DESC, id DESC
    LIMIT ?
`;

/** Eine Zeile pro Fahrzeug, nicht ein Statement pro Fahrzeug. */
export const TELEMETRY_INSERT_CHUNK = 200;

export type InitialTelemetryPoint = {
    vehicleId: number;
    latitude: number;
    longitude: number;
    speed: number;
};

let batchCursor = 0;

function takeBatch<T>(items: T[], limit: number): T[] {
    if (items.length <= limit) {
        batchCursor = 0;
        return items;
    }

    const start = batchCursor % items.length;
    const batch: T[] = [];

    for (let index = 0; index < limit; index += 1) {
        batch.push(items[(start + index) % items.length] as T);
    }

    batchCursor = start + limit;
    return batch;
}

/** `parked`: the device reported ignition off at its destination (not on the wire). */
type TickedPatch = TelemetryPatch & { company_id: number; parked?: true };

function writePatches(pings: Ping[]): TickedPatch[] {
    if (pings.length === 0) {
        return [];
    }

    const insert = stmt(INSERT_TELEMETRY);
    const prune = stmt(PRUNE_TELEMETRY);
    const updateVehicle = stmt(UPDATE_VEHICLE_PING);
    const recordedAt = nowSqliteMs();
    const nowMs = msOf(recordedAt) ?? Date.now();
    const patches: TickedPatch[] = [];
    const keep = config.telemetryKeepPerVehicle;

    db.exec("BEGIN");
    try {
        for (const { vehicle, elapsedS } of pings) {
            // Silent for a long time (server off, sim paused): the trip ended
            // at its last report; this report starts the next one.
            const lastMs = msOf(vehicle.recorded_at);
            if (lastMs !== null && nowMs - lastMs > TRIP_GAP_MS && vehicle.recorded_at) {
                SpeedingEventModel.endForVehicle(vehicle.id, lastMs);
                TripModel.close(vehicle.id, vehicle.recorded_at.slice(0, 19));
            }

            const next = nextSimTick(
                vehicle.id,
                {
                    lat: vehicle.latitude,
                    lng: vehicle.longitude,
                },
                vehicle.speed,
                elapsedS,
                vehicle.vehicle_type,
                vehicle.home_latitude === null || vehicle.home_longitude === null
                    ? null
                    : { lat: vehicle.home_latitude, lng: vehicle.home_longitude },
            );
            const { lat: latitude, lng: longitude, speed, path, limit_kmh } =
                next;
            const fuelLevel = vehicle.fuel_level;

            insert.run(
                vehicle.id,
                latitude,
                longitude,
                speed,
                recordedAt,
            );

            prune.run(vehicle.id, vehicle.id, keep);

            // Moved off a convoy at the start: the old trip ends where it was,
            // the line does not jump across the map.
            if (next.relocated) {
                TripModel.close(vehicle.id);
            }

            const pathDelta = TripModel.appendPoints(
                vehicle.id,
                path,
                speed,
            );
            const meters = pathDelta?.meters ?? 0;
            // What the device read from the dashboard, if it reads it.
            const dashboardM = simDashboardMeters(vehicle, meters);
            const odometerM =
                dashboardM ??
                (vehicle.odometer_m === null ? null : vehicle.odometer_m + meters);
            updateVehicle.run(
                fuelLevel,
                limit_kmh,
                dashboardM,
                meters,
                recordedAt,
                vehicle.id,
            );

            if (next.turnedAround) {
                TripModel.close(vehicle.id);
            }

            patches.push({
                id: vehicle.id,
                company_id: vehicle.company_id,
                speed,
                speed_limit_kmh: limit_kmh,
                latitude,
                longitude,
                recorded_at: recordedAt,
                fuel_level: fuelLevel,
                ...(odometerM === null
                    ? {}
                    : { odometer_km: Math.floor(odometerM / 1000) }),
                ...(dashboardM === null
                    ? {}
                    : { odometer_from_device: true as const }),
                ...(next.parked ? { parked: true as const } : {}),
                ...(pathDelta
                    ? {
                          path_delta: pathDelta.suffix,
                          ...(pathDelta.reset
                              ? { path_reset: true }
                              : {}),
                      }
                    : {}),
            });
        }

        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    const companies = new Set(pings.map(({ vehicle }) => vehicle.company_id));

    for (const companyId of companies) {
        TripModel.pruneClosedForCompany(companyId);
    }

    return patches;
}

/**
 * Wie ein Gerät: jedes Fahrzeug meldet sich in seinem eigenen, leicht
 * schwankenden Abstand um `PING_INTERVAL_MS` (60–160 %), nicht alle im selben
 * Moment. Die Strecke eines Pings folgt aus der echten Zeit seit dem letzten.
 */
const PING_JITTER_MIN = 0.6;
const PING_JITTER_SPAN = 1;
/** Ein Fahrzeug, das lange nichts gemeldet hat, springt nicht um die ganze Pause. */
const MAX_ELAPSED_S = 30;

type PingClock = { lastMs: number; dueMs: number };

const pingClocks = new Map<number, PingClock>();

function nextPingDelayMs() {
    return (
        config.pingIntervalMs *
        (PING_JITTER_MIN + Math.random() * PING_JITTER_SPAN)
    );
}

function duePings(rows: DrivingVehicle[], nowMs: number): Ping[] {
    const due: Ping[] = [];

    for (const vehicle of rows) {
        const clock = pingClocks.get(vehicle.id);

        if (!clock) {
            // Neu im Blick: Phase streuen, damit nicht alle gleichzeitig melden.
            pingClocks.set(vehicle.id, {
                lastMs: nowMs,
                dueMs: nowMs + Math.random() * config.pingIntervalMs,
            });
            continue;
        }

        if (nowMs < clock.dueMs) {
            continue;
        }

        due.push({
            vehicle,
            elapsedS: Math.min(MAX_ELAPSED_S, (nowMs - clock.lastMs) / 1000),
        });
        clock.lastMs = nowMs;
        clock.dueMs = nowMs + nextPingDelayMs();
    }

    if (pingClocks.size > rows.length * 2 + 100) {
        const driving = new Set(rows.map((vehicle) => vehicle.id));

        for (const id of pingClocks.keys()) {
            if (!driving.has(id)) {
                pingClocks.delete(id);
            }
        }
    }

    return due;
}

export class TelemetryModel {
    /**
     * Ein Durchlauf des Simulators: jedes fahrende Fahrzeug, dessen nächster
     * Ping fällig ist, schreibt genau einen Punkt. Mit `onlyIds` melden genau
     * diese Fahrzeuge sofort, mit der nominellen Pingzeit (Tests).
     */
    static tickDrivingVehicles(
        onlyIds?: number[],
        limit = config.telemetryBatchSize,
        nowMs = Date.now(),
    ): TickedPatch[] {
        const rows = (
            stmt(SELECT_DRIVING).all(
                onlyIds ? JSON.stringify(onlyIds) : null,
            ) as DrivingVehicle[]
        ).filter((vehicle) => isCompanySimRunning(vehicle.company_id));
        const pings: Ping[] = onlyIds
            ? rows.map((vehicle) => ({
                  vehicle,
                  elapsedS: SIM_PING_SECONDS,
              }))
            : duePings(rows, nowMs);

        return writePatches(takeBatch(pings, limit));
    }

    /**
     * Schreibt einen letzten Punkt mit Tempo 0, wenn eine Fahrt endet.
     * Ohne das behält ein Fahrzeug im Feierabend seine Reisegeschwindigkeit.
     */
    /**
     * A position report with the ignition off somewhere else: a towed vehicle,
     * or one the workshop fetched. It moved without being driven, so no trip.
     */
    static recordMovedTo(
        vehicleId: number,
        latitude: number,
        longitude: number,
    ): (TelemetryPatch & { company_id: number }) | undefined {
        const vehicle = stmt(`SELECT company_id, fuel_level FROM vehicles WHERE id = ?`).get(
            vehicleId,
        ) as { company_id: number; fuel_level: number } | undefined;

        if (!vehicle) {
            return undefined;
        }

        const recordedAt = nowSqliteMs();

        stmt(INSERT_TELEMETRY).run(vehicleId, latitude, longitude, 0, recordedAt);
        stmt(PRUNE_TELEMETRY).run(vehicleId, vehicleId, config.telemetryKeepPerVehicle);

        return {
            id: vehicleId,
            company_id: Number(vehicle.company_id),
            speed: 0,
            latitude,
            longitude,
            recorded_at: recordedAt,
            fuel_level: vehicle.fuel_level,
        };
    }

    static recordStandstill(vehicleId: number): TelemetryPatch | undefined {
        const row = stmt(SELECT_LAST_POSITION).get(vehicleId) as
            | {
                  fuel_level: number;
                  latitude: number | null;
                  longitude: number | null;
              }
            | undefined;

        if (!row || row.latitude === null || row.longitude === null) {
            return undefined;
        }

        const recordedAt = nowSqliteMs();

        stmt(INSERT_TELEMETRY).run(
            vehicleId,
            row.latitude,
            row.longitude,
            0,
            recordedAt,
        );
        stmt(PRUNE_TELEMETRY).run(
            vehicleId,
            vehicleId,
            config.telemetryKeepPerVehicle,
        );

        return {
            id: vehicleId,
            speed: 0,
            latitude: row.latitude,
            longitude: row.longitude,
            recorded_at: recordedAt,
            fuel_level: row.fuel_level,
        };
    }

    /**
     * Mehrere Erstpunkte in einem INSERT pro Chunk.
     * Der Trigger setzt `last_telemetry_id` zeilenweise.
     */
    static insertInitialBatch(points: InitialTelemetryPoint[]): void {
        if (points.length === 0) {
            return;
        }

        const recordedAt = nowSqlite();

        for (
            let offset = 0;
            offset < points.length;
            offset += TELEMETRY_INSERT_CHUNK
        ) {
            const chunk = points.slice(offset, offset + TELEMETRY_INSERT_CHUNK);
            const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
            const params = chunk.flatMap((point) => [
                point.vehicleId,
                point.latitude,
                point.longitude,
                point.speed,
                recordedAt,
            ]);

            db.prepare(
                `
                INSERT INTO telemetry (
                    vehicle_id, latitude, longitude, speed, recorded_at
                )
                VALUES ${placeholders}
                `,
            ).run(...params);
        }
    }

    static listForVehicle(vehicleId: number, limit: number): TelemetryPoint[] {
        const rows = stmt(SELECT_HISTORY).all(
            vehicleId,
            limit,
        ) as TelemetryPoint[];

        return rows.reverse();
    }

    static countForVehicle(vehicleId: number): number {
        const row = stmt(
            "SELECT COUNT(*) AS total FROM telemetry WHERE vehicle_id = ?",
        ).get(vehicleId) as { total: number };

        return row.total;
    }
}
