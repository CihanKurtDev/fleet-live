import type { TelemetryPatch, TelemetryPoint } from "@fleet-live/shared";
import { config } from "../config";
import { db } from "../db/database";
import { stmt } from "../db/statements";
import { nowSqlite } from "../lib/sqlTime";
import { nextSimTick } from "../sim/routes";
import { TripModel } from "./trip.model";

type DrivingVehicle = {
    id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
    fuel_level: number;
};

const SELECT_DRIVING_BY_IDS = `
    SELECT
        v.id,
        COALESCE(t.latitude, 50.9375) AS latitude,
        COALESCE(t.longitude, 6.9603) AS longitude,
        t.speed,
        v.fuel_level
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.status = 'DRIVING'
      AND v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
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

const UPDATE_FUEL = `UPDATE vehicles SET fuel_level = ? WHERE id = ?`;

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

/** Verbrauch der Simulation: 100 % reichen für rund 400 km. */
const FUEL_PERCENT_PER_KM = 0.25;
/** Unter dieser Marke wird getankt, damit die Flotte nicht dauerhaft leer steht. */
const REFUEL_BELOW_PERCENT = 5;

let batchCursor = 0;

function nextFuelLevel(current: number, meters: number): number {
    const used = (meters / 1_000) * FUEL_PERCENT_PER_KM;
    const remaining = current - used;

    return remaining <= REFUEL_BELOW_PERCENT ? 100 : remaining;
}

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

function writePatches(vehicles: DrivingVehicle[]): TelemetryPatch[] {
    if (vehicles.length === 0) {
        return [];
    }

    const insert = stmt(INSERT_TELEMETRY);
    const prune = stmt(PRUNE_TELEMETRY);
    const updateFuel = stmt(UPDATE_FUEL);
    const recordedAt = nowSqlite();
    const patches: TelemetryPatch[] = [];
    const keep = config.telemetryKeepPerVehicle;

    db.exec("BEGIN");
    try {
        for (const vehicle of vehicles) {
            const next = nextSimTick(
                vehicle.id,
                {
                    lat: vehicle.latitude,
                    lng: vehicle.longitude,
                },
                vehicle.speed,
            );
            const { lat: latitude, lng: longitude, speed, path } = next;
            const fuelLevel = nextFuelLevel(vehicle.fuel_level, next.meters);

            insert.run(
                vehicle.id,
                latitude,
                longitude,
                speed,
                recordedAt,
            );

            prune.run(vehicle.id, vehicle.id, keep);
            updateFuel.run(fuelLevel, vehicle.id);

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
                speed,
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

    return patches;
}

export class TelemetryModel {
    static tickDrivingVehicles(
        focusIds: number[] = [],
        limit = config.telemetryBatchSize,
    ): TelemetryPatch[] {
        if (focusIds.length === 0) {
            return [];
        }

        const focused = stmt(SELECT_DRIVING_BY_IDS).all(
            JSON.stringify(focusIds),
        ) as DrivingVehicle[];

        return writePatches(takeBatch(focused, limit));
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
