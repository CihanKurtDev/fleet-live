import {
    DAMAGE_LIST_LIMIT,
    DAMAGE_PHOTOS_MAX,
    DAMAGE_PHOTO_MAX_BYTES,
    berlinTodayIso,
    type Damage,
    type DamageInput,
    type DamagePhotoType,
} from "@fleet-live/shared";

import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import { AppError, NotFoundError } from "../lib/errors";
import { DriveModel } from "./drive.model";

export type DamageActor = { id: number; name: string };

type DamageRow = Omit<Damage, "drivable" | "photo_ids"> & { drivable: number; photo_ids: string };

export type DamagePhoto = { content_type: DamagePhotoType; data: Uint8Array };

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
    d.created_at,
    d.occurred_time,
    d.latitude,
    d.longitude,
    d.driver_id,
    d.driver_name,
    (
        SELECT COALESCE(json_group_array(p.id), '[]')
        FROM (SELECT id FROM damage_photos WHERE damage_id = d.id ORDER BY id) p
    ) AS photo_ids
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
        driver_id: row.driver_id === null ? null : Number(row.driver_id),
        photo_ids: (JSON.parse(row.photo_ids) as number[]).map(Number),
    };
}

type DamageVehicle = {
    id: number;
    license_plate: string;
    status: string;
    current_driver_id: number | null;
    driver_name: string | null;
};

function vehicleOf(vehicleId: number, companyId: number): DamageVehicle {
    const vehicle = stmt(
        `
        SELECT id, license_plate, status, current_driver_id, driver_name
        FROM vehicles
        WHERE id = ? AND company_id = ?
        `,
    ).get(vehicleId, companyId) as DamageVehicle | undefined;

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

/**
 * A vehicle that cannot be driven is off the road: a breakdown on a trip
 * stops it where it stands (the trip ends there), then it has no current
 * driver until the damage is repaired.
 */
function takeOffTheRoad(vehicle: DamageVehicle, companyId: number, actor: DamageActor | null) {
    if (vehicle.status === "DRIVING") {
        DriveModel.report(vehicle.id, companyId, "IDLE");
    }

    stmt(
        `UPDATE vehicles SET current_driver_id = NULL, driver_name = NULL WHERE id = ?`,
    ).run(vehicle.id);

    // Nobody drives it to its planned workshop stay any more: it is towed
    // there (the dispatcher can still switch to „Werkstatt holt ab“).
    const stay = stmt(
        `
        SELECT id FROM workshop_visits
        WHERE vehicle_id = ? AND state = 'PLANNED' AND transport = 'DRIVER'
        `,
    ).get(vehicle.id) as { id: number } | undefined;

    if (stay) {
        stmt(
            `UPDATE workshop_visits SET transport = 'TOW', bring_driver_id = NULL WHERE id = ?`,
        ).run(stay.id);
        stmt(
            `
            INSERT INTO workshop_visit_events (visit_id, action, actor_user_id, actor_name, details)
            VALUES (?, 'updated', ?, ?, ?)
            `,
        ).run(
            stay.id,
            actor?.id ?? null,
            actor?.name ?? null,
            JSON.stringify({ fields: ["transport", "bring_driver_id"] }),
        );
    }
}

/** The first bytes say what a file is; the declared type must match them. */
function photoMatches(type: DamagePhotoType, data: Uint8Array): boolean {
    const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
    const ascii = (from: number, text: string) =>
        [...text].every((char, index) => data[from + index] === char.charCodeAt(0));

    switch (type) {
        case "image/jpeg":
            return starts(0xff, 0xd8, 0xff);
        case "image/png":
            return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
        case "image/webp":
            return ascii(0, "RIFF") && ascii(8, "WEBP");
    }
}

function refuseClosed(damage: Damage) {
    if (damage.state !== "OPEN") {
        const message = "Der Schaden ist abgeschlossen.";
        throw new AppError(409, "DAMAGE_CLOSED", message, { state: message });
    }
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

        const id = withTransaction(() => {
            // The driver at the moment of the report, before an undrivable
            // damage takes them off the vehicle.
            const result = stmt(
                `
                INSERT INTO vehicle_damages (
                    vehicle_id, occurred_on, description, severity, drivable,
                    reported_by_user_id, reported_by_name,
                    occurred_time, latitude, longitude, driver_id, driver_name
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                vehicleId,
                input.occurred_on,
                input.description,
                input.severity,
                input.drivable ? 1 : 0,
                actor.id,
                actor.name,
                input.occurred_time ?? null,
                input.latitude ?? null,
                input.longitude ?? null,
                vehicle.current_driver_id,
                vehicle.current_driver_id === null ? null : vehicle.driver_name,
            );

            if (!input.drivable) {
                takeOffTheRoad(vehicle, companyId, actor);
            }

            return Number(result.lastInsertRowid);
        });

        return damageOf(id, companyId);
    }

    static update(
        damageId: number,
        companyId: number,
        patch: Partial<DamageInput>,
        actor: DamageActor | null = null,
    ): Damage {
        const damage = damageOf(damageId, companyId);
        refuseClosed(damage);

        const next = { ...damage, ...patch };
        const becomesUndrivable = damage.drivable && patch.drivable === false;

        withTransaction(() => {
            stmt(
                `
                UPDATE vehicle_damages
                SET occurred_on = ?, description = ?, severity = ?, drivable = ?,
                    occurred_time = ?, latitude = ?, longitude = ?
                WHERE id = ?
                `,
            ).run(
                next.occurred_on,
                next.description,
                next.severity,
                next.drivable ? 1 : 0,
                next.occurred_time ?? null,
                next.latitude ?? null,
                next.longitude ?? null,
                damageId,
            );

            if (becomesUndrivable) {
                takeOffTheRoad(vehicleOf(damage.vehicle_id, companyId), companyId, actor);
            }
        });

        return damageOf(damageId, companyId);
    }

    /** A photo of an open damage; at most `DAMAGE_PHOTOS_MAX`, the type read from the bytes. */
    static addPhoto(damageId: number, companyId: number, photo: DamagePhoto): Damage {
        const damage = damageOf(damageId, companyId);
        refuseClosed(damage);

        if (damage.photo_ids.length >= DAMAGE_PHOTOS_MAX) {
            const message = `Höchstens ${DAMAGE_PHOTOS_MAX} Fotos je Schaden.`;
            throw new AppError(409, "DAMAGE_PHOTOS_FULL", message, { photos: message });
        }

        if (photo.data.byteLength === 0 || photo.data.byteLength > DAMAGE_PHOTO_MAX_BYTES) {
            const message = `Ein Foto darf höchstens ${Math.round(DAMAGE_PHOTO_MAX_BYTES / 1_000_000 * 10) / 10} MB groß sein.`;
            throw new AppError(400, "DAMAGE_PHOTO_SIZE", message, { photos: message });
        }

        if (!photoMatches(photo.content_type, photo.data)) {
            const message = "Die Datei ist kein JPEG-, PNG- oder WebP-Bild.";
            throw new AppError(400, "DAMAGE_PHOTO_TYPE", message, { photos: message });
        }

        stmt(
            `INSERT INTO damage_photos (damage_id, content_type, data) VALUES (?, ?, ?)`,
        ).run(damageId, photo.content_type, photo.data);

        return damageOf(damageId, companyId);
    }

    static photo(damageId: number, photoId: number, companyId: number): DamagePhoto {
        const row = stmt(
            `
            SELECT p.content_type, p.data
            FROM damage_photos p
            JOIN vehicle_damages d ON d.id = p.damage_id
            JOIN vehicles v ON v.id = d.vehicle_id
            WHERE p.id = ? AND p.damage_id = ? AND v.company_id = ?
            `,
        ).get(photoId, damageId, companyId) as DamagePhoto | undefined;

        if (!row) {
            throw new NotFoundError("Foto nicht gefunden.");
        }

        return row;
    }

    static deletePhoto(damageId: number, photoId: number, companyId: number): Damage {
        const damage = damageOf(damageId, companyId);
        refuseClosed(damage);

        const result = stmt(`DELETE FROM damage_photos WHERE id = ? AND damage_id = ?`).run(
            photoId,
            damageId,
        );

        if (Number(result.changes) === 0) {
            throw new NotFoundError("Foto nicht gefunden.");
        }

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

    /** The damages a stay takes, as a whole set: the others go back to unplanned. */
    static setForVisit(vehicleId: number, visitId: number, damageIds: number[]) {
        const linked = new Set(
            (
                stmt(
                    `SELECT id FROM vehicle_damages WHERE workshop_visit_id = ? AND state = 'OPEN'`,
                ).all(visitId) as { id: number }[]
            ).map((row) => Number(row.id)),
        );

        for (const id of linked) {
            if (!damageIds.includes(id)) {
                stmt(`UPDATE vehicle_damages SET workshop_visit_id = NULL WHERE id = ?`).run(id);
            }
        }

        this.linkToVisit(
            vehicleId,
            visitId,
            damageIds.filter((id) => !linked.has(id)),
        );
    }

    /** An open damage that it cannot be driven with: nobody drives it to the workshop. */
    static notDrivable(vehicleId: number): boolean {
        return Boolean(
            stmt(
                `SELECT 1 FROM vehicle_damages WHERE vehicle_id = ? AND state = 'OPEN' AND drivable = 0`,
            ).get(vehicleId),
        );
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
