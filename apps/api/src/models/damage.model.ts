import {
    DAMAGE_LIST_LIMIT,
    berlinTodayIso,
    type Damage,
    type DamageInput,
} from "@fleet-live/shared";

import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import { AppError, NotFoundError } from "../lib/errors";

export type DamageActor = { id: number; name: string };

type DamageRow = Omit<Damage, "drivable"> & { drivable: number };

const COLUMNS = `
    d.id,
    d.vehicle_id,
    d.occurred_on,
    d.description,
    d.severity,
    d.drivable,
    d.state,
    d.workshop_visit_id,
    w.state AS workshop_state,
    w.planned_on AS workshop_planned_on,
    d.closed_on,
    d.reported_by_name,
    d.created_at
`;

const FROM = `
    FROM vehicle_damages d
    JOIN vehicles v ON v.id = d.vehicle_id
    LEFT JOIN workshop_visits w ON w.id = d.workshop_visit_id
`;

function toDamage(row: DamageRow): Damage {
    return {
        ...row,
        id: Number(row.id),
        vehicle_id: Number(row.vehicle_id),
        drivable: Number(row.drivable) === 1,
        workshop_visit_id:
            row.workshop_visit_id === null ? null : Number(row.workshop_visit_id),
    };
}

function vehicleOf(vehicleId: number, companyId: number) {
    const vehicle = stmt(
        `SELECT id, license_plate, status FROM vehicles WHERE id = ? AND company_id = ?`,
    ).get(vehicleId, companyId) as
        | { id: number; license_plate: string; status: string }
        | undefined;

    if (!vehicle) {
        throw new NotFoundError();
    }

    return vehicle;
}

function damageOf(damageId: number, companyId: number): Damage {
    const row = stmt(`SELECT ${COLUMNS} ${FROM} WHERE d.id = ? AND v.company_id = ?`).get(
        damageId,
        companyId,
    ) as DamageRow | undefined;

    if (!row) {
        throw new NotFoundError("Schaden nicht gefunden.");
    }

    return toDamage(row);
}

/** „Nicht fahrbereit“ takes the vehicle off the road: not while it is driving. */
function refuseUndrivableWhileDriving(vehicle: { license_plate: string; status: string }) {
    if (vehicle.status === "DRIVING") {
        const message = `${vehicle.license_plate} ist auf Fahrt. „Nicht fahrbereit“ lässt sich eintragen, sobald die Fahrt endet.`;
        throw new AppError(409, "VEHICLE_DRIVING", message, { drivable: message });
    }
}

/** A vehicle that cannot be driven has no current driver. */
function releaseCurrentDriver(vehicleId: number) {
    stmt(
        `UPDATE vehicles SET current_driver_id = NULL, driver_name = NULL WHERE id = ?`,
    ).run(vehicleId);
}

const isOpenStay = (damage: Damage) =>
    damage.workshop_state === "PLANNED" || damage.workshop_state === "IN_WORKSHOP";

export class DamageModel {
    /** Open damages first, then the newest; at most `DAMAGE_LIST_LIMIT`. */
    static forVehicle(vehicleId: number, companyId: number): Damage[] {
        vehicleOf(vehicleId, companyId);

        return (
            stmt(
                `
                SELECT ${COLUMNS} ${FROM}
                WHERE d.vehicle_id = ?
                ORDER BY d.state = 'OPEN' DESC, d.occurred_on DESC, d.id DESC
                LIMIT ?
                `,
            ).all(vehicleId, DAMAGE_LIST_LIMIT) as DamageRow[]
        ).map(toDamage);
    }

    static create(
        vehicleId: number,
        companyId: number,
        input: DamageInput,
        actor: DamageActor,
    ): Damage {
        const vehicle = vehicleOf(vehicleId, companyId);

        if (!input.drivable) {
            refuseUndrivableWhileDriving(vehicle);
        }

        const id = withTransaction(() => {
            const result = stmt(
                `
                INSERT INTO vehicle_damages (
                    vehicle_id, occurred_on, description, severity, drivable,
                    reported_by_user_id, reported_by_name
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                vehicleId,
                input.occurred_on,
                input.description,
                input.severity,
                input.drivable ? 1 : 0,
                actor.id,
                actor.name,
            );

            if (!input.drivable) {
                releaseCurrentDriver(vehicleId);
            }

            return Number(result.lastInsertRowid);
        });

        return damageOf(id, companyId);
    }

    static update(damageId: number, companyId: number, patch: Partial<DamageInput>): Damage {
        const damage = damageOf(damageId, companyId);

        if (damage.state !== "OPEN") {
            const message = "Der Schaden ist abgeschlossen.";
            throw new AppError(409, "DAMAGE_CLOSED", message, { state: message });
        }

        const next = { ...damage, ...patch };
        const becomesUndrivable = damage.drivable && patch.drivable === false;

        if (becomesUndrivable) {
            refuseUndrivableWhileDriving(vehicleOf(damage.vehicle_id, companyId));
        }

        withTransaction(() => {
            stmt(
                `
                UPDATE vehicle_damages
                SET occurred_on = ?, description = ?, severity = ?, drivable = ?
                WHERE id = ?
                `,
            ).run(next.occurred_on, next.description, next.severity, next.drivable ? 1 : 0, damageId);

            if (becomesUndrivable) {
                releaseCurrentDriver(damage.vehicle_id);
            }
        });

        return damageOf(damageId, companyId);
    }

    /** Erledigt without a workshop (a scratch the company accepts). */
    static close(damageId: number, companyId: number): Damage {
        const damage = damageOf(damageId, companyId);

        if (damage.state !== "OPEN") {
            const message = "Der Schaden ist schon abgeschlossen.";
            throw new AppError(409, "DAMAGE_CLOSED", message, { state: message });
        }

        if (isOpenStay(damage)) {
            const message =
                "Der Schaden gehört zu einem offenen Werkstatt-Aufenthalt; er ist erledigt, wenn der fertig ist.";
            throw new AppError(409, "DAMAGE_IN_WORKSHOP", message, { state: message });
        }

        stmt(
            `UPDATE vehicle_damages SET state = 'CLOSED', closed_on = ? WHERE id = ?`,
        ).run(berlinTodayIso(), damageId);

        return damageOf(damageId, companyId);
    }

    /**
     * Links open damages of the vehicle to a new stay. Each must belong to the
     * vehicle, be open and not already be in an open stay.
     */
    static linkToVisit(vehicleId: number, visitId: number, damageIds: number[]) {
        for (const damageId of damageIds) {
            const row = stmt(
                `
                SELECT d.id
                FROM vehicle_damages d
                LEFT JOIN workshop_visits w ON w.id = d.workshop_visit_id
                WHERE d.id = ?
                  AND d.vehicle_id = ?
                  AND d.state = 'OPEN'
                  AND (w.id IS NULL OR w.state NOT IN ('PLANNED', 'IN_WORKSHOP'))
                `,
            ).get(damageId, vehicleId);

            if (!row) {
                const message = "Ein Schaden ist nicht offen oder gehört nicht zu diesem Fahrzeug.";
                throw new AppError(400, "VALIDATION_ERROR", message, { damage_ids: message });
            }

            stmt(`UPDATE vehicle_damages SET workshop_visit_id = ? WHERE id = ?`).run(
                visitId,
                damageId,
            );
        }
    }

    /** The stay is finished: its damages are repaired on that day. */
    static repairedByVisit(visitId: number, finishedOn: string) {
        stmt(
            `
            UPDATE vehicle_damages
            SET state = 'REPAIRED', closed_on = ?
            WHERE workshop_visit_id = ? AND state = 'OPEN'
            `,
        ).run(finishedOn, visitId);
    }

    /** The stay was cancelled: its damages are open and unplanned again. */
    static releaseFromVisit(visitId: number) {
        stmt(
            `
            UPDATE vehicle_damages
            SET workshop_visit_id = NULL
            WHERE workshop_visit_id = ? AND state = 'OPEN'
            `,
        ).run(visitId);
    }

    /**
     * Vehicles that cannot be driven and have no workshop date yet: the oldest
     * such damage per vehicle (filter \`damage_unplanned\` counts the same).
     */
    static unplannedForCompany(companyId: number): (Damage & { license_plate: string })[] {
        return (
            stmt(
                `
                SELECT ${COLUMNS}, v.license_plate
                ${FROM}
                WHERE v.company_id = ?
                  AND d.state = 'OPEN'
                  AND d.drivable = 0
                  AND d.id = (
                      SELECT d2.id FROM vehicle_damages d2
                      WHERE d2.vehicle_id = d.vehicle_id
                        AND d2.state = 'OPEN' AND d2.drivable = 0
                      ORDER BY d2.occurred_on, d2.id
                      LIMIT 1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM workshop_visits ow
                      WHERE ow.vehicle_id = d.vehicle_id
                        AND ow.state IN ('PLANNED', 'IN_WORKSHOP')
                  )
                ORDER BY d.occurred_on, d.id
                `,
            ).all(companyId) as (DamageRow & { license_plate: string })[]
        ).map((row) => ({ ...toDamage(row), license_plate: row.license_plate }));
    }
}
