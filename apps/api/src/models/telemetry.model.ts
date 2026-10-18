import type { TelemetryPatch, TelemetryPoint } from "@fleet-live/shared";
import { config } from "../config";
import { db } from "../db/database";
import { stmt } from "../db/statements";
import { nowSqlite } from "../lib/sqlTime";
import { nextSimTick, SIM_PING_SECONDS } from "../sim/routes";
import { TripModel } from "./trip.model";
import { isCompanySimRunning } from "../lib/simControl";

type DrivingVehicle = {
    id: number;
    company_id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
    fuel_level: number;
};

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
        v.fuel_level
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
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

const UPDATE_FUEL_AND_LIMIT = `UPDATE vehicles SET fuel_level = ?, speed_limit_kmh = ? WHERE id = ?`;

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

type TickedPatch = TelemetryPatch & { company_id: number };

function writePatches(pings: Ping[]): TickedPatch[] {
    if (pings.length === 0) {
        return [];
    }

    const insert = stmt(INSERT_TELEMETRY);
    const prune = stmt(PRUNE_TELEMETRY);
    const updateFuelAndLimit = stmt(UPDATE_FUEL_AND_LIMIT);
    const recordedAt = nowSqlite();
    const patches: TickedPatch[] = [];
    const keep = config.telemetryKeepPerVehicle;

    db.exec("BEGIN");
    try {
        for (const { vehicle, elapsedS } of pings) {
            const next = nextSimTick(
                vehicle.id,
                {
                    lat: vehicle.latitude,
                    lng: vehicle.longitude,
                },
                vehicle.speed,
                elapsedS,
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
            updateFuelAndLimit.run(fuelLevel, limit_kmh, vehicle.id);

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

        const recordedAt = nowSqlite();

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
