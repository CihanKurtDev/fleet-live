import {
    ODOMETER_HISTORY_LIMIT,
    type OdometerReading,
    type OdometerSource,
    type VehicleOdometer,
} from "@fleet-live/shared";

import { stmt } from "../db/statements";
import { NotFoundError } from "../lib/errors";

export type OdometerActor = { id: number; name: string };

const SELECT_KM = `
    SELECT CAST(v.odometer_m / 1000 AS INTEGER) AS km
    FROM vehicles v
    WHERE v.id = ? AND v.company_id = ?
`;

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
 * (`vehicles.odometer_m`) und wächst mit jeder gemeldeten Teilstrecke
 * (`TripModel.appendPoints`, dieselben Meter wie `trips.distance_m`). Wer ihn
 * setzt (Anlegen, Import, Korrektur), schreibt eine Zeile in den Verlauf.
 */
export class OdometerModel {
    /** Current reading of a vehicle of the company; `undefined` for another company's. */
    static km(vehicleId: number, companyId: number): number | null | undefined {
        const row = stmt(SELECT_KM).get(vehicleId, companyId) as
            | { km: number | null }
            | undefined;
        return row ? row.km : undefined;
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
        const previous = this.km(vehicleId, companyId);

        if (previous === undefined) {
            throw new NotFoundError("Fahrzeug nicht gefunden.");
        }

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
        const km = this.km(vehicleId, companyId);

        if (km === undefined) {
            throw new NotFoundError("Fahrzeug nicht gefunden.");
        }

        const readings = stmt(SELECT_READINGS).all(
            vehicleId,
            ODOMETER_HISTORY_LIMIT,
        ) as OdometerReading[];

        return { km, readings };
    }
}
