import type { TelemetryPatch, TelemetryPoint } from "@fleet-live/shared";
import { config } from "../config";
import { db } from "../db/database";
import { stmt } from "../db/statements";

type DrivingVehicle = {
    id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
};

const SELECT_DRIVING_BY_IDS = `
    SELECT
        v.id,
        COALESCE(t.latitude, 50.9375) AS latitude,
        COALESCE(t.longitude, 6.9603) AS longitude,
        t.speed
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.status = 'DRIVING'
      AND v.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
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

let batchCursor = 0;

function nowSqlite(): string {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Tempo ändert sich in kleinen Schritten, nicht als Würfelwurf 30–120.
 * Später kommt die Geschwindigkeit aus der tatsächlichen Bewegung auf der Karte.
 */
function nextSpeed(current: number | null): number {
    const cruising = current !== null && current > 15 ? current : 55 + Math.random() * 25;
    const delta = (Math.random() - 0.5) * 10;
    return Math.round(Math.min(128, Math.max(18, cruising + delta)));
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
    const recordedAt = nowSqlite();
    const patches: TelemetryPatch[] = [];
    const keep = config.telemetryKeepPerVehicle;

    db.exec("BEGIN");
    try {
        for (const vehicle of vehicles) {
            const speed = nextSpeed(vehicle.speed);
            const latitude =
                vehicle.latitude + (Math.random() - 0.5) * 0.0008;
            const longitude =
                vehicle.longitude + (Math.random() - 0.5) * 0.0008;

            insert.run(
                vehicle.id,
                latitude,
                longitude,
                speed,
                recordedAt,
            );

            prune.run(vehicle.id, vehicle.id, keep);

            patches.push({
                id: vehicle.id,
                speed,
                latitude,
                longitude,
                recorded_at: recordedAt,
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
