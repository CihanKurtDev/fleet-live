import type { Vehicle, VehicleInput } from "@fleet-live/shared";
import { db } from "../db/database";

export type VehicleCreateInput = Pick<
    VehicleInput,
    "license_plate" | "driver_name"
> &
    Partial<Pick<VehicleInput, "fuel_level" | "status">>;

export type VehiclePutInput = VehicleInput;

export type VehiclePatchInput = Partial<VehicleInput>;

const selectWithLastTelemetry = `
    SELECT
        v.id,
        v.license_plate,
        v.driver_name,
        v.fuel_level,
        v.status,
        t.latitude,
        t.longitude,
        t.speed,
        t.recorded_at,
        (
            SELECT COUNT(*)
            FROM alerts a
            WHERE a.vehicle_id = v.id
              AND a.resolved_at IS NULL
        ) AS activeAlerts
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = (
        SELECT t2.id
        FROM telemetry t2
        WHERE t2.vehicle_id = v.id
        ORDER BY t2.recorded_at DESC, t2.id DESC
        LIMIT 1
    )
`;

export class VehicleModel {
    static getAll(): Vehicle[] {
        const statement = db.prepare(selectWithLastTelemetry);
        return statement.all() as Vehicle[];
    }

    static getById(id: number): Vehicle | undefined {
        return db
            .prepare(`${selectWithLastTelemetry} WHERE v.id = ?`)
            .get(id) as Vehicle | undefined;
    }

    static create(input: VehicleCreateInput): Vehicle {
    const result = db
        .prepare(
            `
                INSERT INTO vehicles (license_plate, driver_name, fuel_level, status)
                VALUES (?, ?, ?, ?)
            `,
        )
        .run(
            input.license_plate,
            input.driver_name,
            input.fuel_level ?? 100,
            input.status ?? "IDLE",
        );

    const created = this.getById(Number(result.lastInsertRowid));
        if (!created) {
            throw new Error("Created vehicle was not found.");
        }
        return created;
    }

    static replace(id: number, input: VehiclePutInput): Vehicle | undefined {
        const result = db
            .prepare(
                `
                    UPDATE vehicles
                    SET license_plate = ?, driver_name = ?, fuel_level = ?, status = ?
                    WHERE id = ?
                `,
            )
        .run(input.license_plate, input.driver_name, input.fuel_level, input.status, id);

        if (result.changes === 0) {
            return undefined;
        }
        return this.getById(id);
    }

    static update(id: number, input: VehiclePatchInput): Vehicle | undefined {
        const current = this.getById(id);
        if (!current) {
            return undefined;
        }

        const result = db
            .prepare(
                `
                    UPDATE vehicles
                    SET license_plate = ?, driver_name = ?, fuel_level = ?, status = ?
                    WHERE id = ?
                `,
            )
        .run(
            input.license_plate ?? current.license_plate,
            input.driver_name ?? current.driver_name,
            input.fuel_level ?? current.fuel_level,
            input.status ?? current.status,
            id,
        );

        if (result.changes === 0) {
            return undefined;
        }
        return this.getById(id);
    }

    static delete(id: number): boolean {
        const result = db.prepare("DELETE FROM vehicles WHERE id = ?").run(id);
        return result.changes > 0;
    }

}
