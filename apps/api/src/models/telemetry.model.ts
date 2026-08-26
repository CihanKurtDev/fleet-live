import type { TelemetryPatch } from "@fleet-live/shared";
import { config } from "../config";
import { db } from "../db/database";
import { stmt } from "../db/statements";

type DrivingVehicle = {
    id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
};

const SELECT_DRIVING_AFTER = `
    SELECT
        v.id,
        COALESCE(t.latitude, 50.9375) AS latitude,
        COALESCE(t.longitude, 6.9603) AS longitude,
        t.speed
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.status = 'DRIVING' AND v.id > ?
    ORDER BY v.id ASC
    LIMIT ?
`;

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

let cursorId = 0;

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

function writePatches(vehicles: DrivingVehicle[]): TelemetryPatch[] {
    if (vehicles.length === 0) {
        return [];
    }

    const insert = stmt(INSERT_TELEMETRY);
    const recordedAt = nowSqlite();
    const patches: TelemetryPatch[] = [];

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
        if (focusIds.length > 0) {
            const focused = stmt(SELECT_DRIVING_BY_IDS).all(
                JSON.stringify(focusIds),
            ) as DrivingVehicle[];
            return writePatches(focused);
        }

        let driving = stmt(SELECT_DRIVING_AFTER).all(
            cursorId,
            limit,
        ) as DrivingVehicle[];

        if (driving.length === 0 && cursorId > 0) {
            cursorId = 0;
            driving = stmt(SELECT_DRIVING_AFTER).all(
                0,
                limit,
            ) as DrivingVehicle[];
        }

        const patches = writePatches(driving);
        cursorId = driving[driving.length - 1]?.id ?? 0;
        return patches;
    }
}
