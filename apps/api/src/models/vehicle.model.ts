import { db } from "../db/database";

export type VehicleWithLastTelemetry  = {
    id: number;
    license_plate: string;
    driver_name: string;
    fuel_level: number;
    status: string;
    latitude: number | null;
    longitude: number | null;
    speed: number | null;
    recorded_at: string | null;
}

export type VehicleCreateInput = {
    license_plate: string;
    driver_name: string;
    fuel_level?: number;
    status?: string;
}

export type VehiclePutInput = {
    license_plate: string;
    driver_name: string;
    fuel_level: number;
    status: string;
}

export type VehiclePatchInput = {
    license_plate?: string;
    driver_name?: string;
    fuel_level?: number;
    status?: string;
};

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
        t.recorded_at
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
    static getAll(): VehicleWithLastTelemetry[] {
        const statement = db.prepare(selectWithLastTelemetry);
        return statement.all() as VehicleWithLastTelemetry[];
    }

    static getById(id: number): VehicleWithLastTelemetry | undefined {
        return db
            .prepare(`${selectWithLastTelemetry} WHERE v.id = ?`)
            .get(id) as VehicleWithLastTelemetry | undefined;
    }

    static create(input: VehicleCreateInput): VehicleWithLastTelemetry {
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

    static replace(id: number, input: VehiclePutInput): VehicleWithLastTelemetry | undefined {
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

    static update(id: number, input: VehiclePatchInput): VehicleWithLastTelemetry | undefined {
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