import {
    ODOMETER_HISTORY_LIMIT,
    type OdometerReading,
    type OdometerSource,
    type VehicleOdometer,
} from "@fleet-live/shared";

import { stmt } from "../db/statements";
import { AppError, NotFoundError } from "../lib/errors";

export type OdometerActor = { id: number; name: string };

const SELECT_KM = `
    SELECT CAST(v.odometer_m / 1000 AS INTEGER) AS km, v.odometer_reported_at AS reported_at
    FROM vehicles v
    WHERE v.id = ? AND v.company_id = ?
`;

const FROM_DEVICE_MESSAGE =
    "Der Kilometerstand kommt vom Fahrzeug, wie auf dem Tacho, und lässt sich nicht korrigieren.";

const SET_KM = `UPDATE vehicles SET odometer_m = ? WHERE id = ?`;

const INSERT_READING = `
    INSERT INTO odometer_readings (
        vehicle_id, km, previous_km, source, note, actor_user_id, actor_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const SELECT_READINGS = `
    SELECT id, km, previous_km, source, note, actor_name, created_at
    FROM odometer_readings
    WHERE vehicle_id = ?
    ORDER BY id DESC
    LIMIT ?
`;

/**
 * Der Kilometerstand eines Fahrzeugs. Er steht in Metern am Fahrzeug
 * (`vehicles.odometer_m`). Liest das Gerät den Tacho (LKW über FMS), meldet
 * es ihn mit jedem Ping; sonst wächst er mit jeder gemeldeten Teilstrecke
 * (`TripModel.appendPoints`, dieselben Meter wie `trips.distance_m`). Wer ihn
 * setzt (Anlegen, Import, Korrektur), schreibt eine Zeile in den Verlauf; ein
 * Stand vom Tacho wird nicht überschrieben.
 */
export class OdometerModel {
    private static row(vehicleId: number, companyId: number) {
        return stmt(SELECT_KM).get(vehicleId, companyId) as
            | { km: number | null; reported_at: string | null }
            | undefined;
    }

    /** Current reading of a vehicle of the company; `undefined` for another company's. */
    static km(vehicleId: number, companyId: number): number | null | undefined {
        return this.row(vehicleId, companyId)?.km;
    }

    /** The device reports the dashboard reading: nobody sets it by hand or by import. */
    static fromDevice(vehicleId: number, companyId: number): boolean {
        return Boolean(this.row(vehicleId, companyId)?.reported_at);
    }

    /**
     * Sets the reading and logs it. Returns false (and writes nothing) when
     * the vehicle already shows that reading.
     */
    static set(
        vehicleId: number,
        companyId: number,
        km: number,
        source: OdometerSource,
        actor: OdometerActor | null,
        note: string | null = null,
    ): boolean {
        const row = this.row(vehicleId, companyId);

        if (row === undefined) {
            throw new NotFoundError("Fahrzeug nicht gefunden.");
        }

        if (row.reported_at) {
            throw new AppError(409, "ODOMETER_FROM_DEVICE", FROM_DEVICE_MESSAGE, {
                km: FROM_DEVICE_MESSAGE,
            });
        }

        const previous = row.km;

        if (previous === km) {
            return false;
        }

        stmt(SET_KM).run(km * 1000, vehicleId);
        stmt(INSERT_READING).run(
            vehicleId,
            km,
            previous,
            source,
            note,
            actor?.id ?? null,
            actor?.name ?? null,
        );
        return true;
    }

    static forVehicle(vehicleId: number, companyId: number): VehicleOdometer {
        const row = this.row(vehicleId, companyId);

        if (row === undefined) {
            throw new NotFoundError("Fahrzeug nicht gefunden.");
        }

        const readings = stmt(SELECT_READINGS).all(
            vehicleId,
            ODOMETER_HISTORY_LIMIT,
        ) as OdometerReading[];

        return { km: row.km, reported_at: row.reported_at, readings };
    }
}
