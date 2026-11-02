import {
    WORKSHOP_PLACE_LIST_MAX,
    parseWorkshopReasons,
    type TelemetryPatch,
    type WorkshopPlace,
    type WorkshopPlaceAppointment,
    type WorkshopPlaceInput,
    type WorkshopPlacePatch,
    type WorkshopPlaceVehicle,
} from "@fleet-live/shared";

import { stmt } from "../db/statements";
import { haversineMeters } from "../lib/geo";
import { nowSqlite } from "../lib/sqlTime";
import { AppError, ConflictError, isUniqueConstraintError, NotFoundError } from "../lib/errors";

type PlaceRow = Omit<WorkshopPlace, "vehicles_here" | "here" | "appointments"> & { company_id: number };

const SELECT_PLACES = `
    SELECT w.id, w.company_id, w.name, w.address, w.phone, w.latitude, w.longitude, w.radius_m,
        (SELECT COUNT(*) FROM vehicles v WHERE v.at_workshop_id = w.id) AS vehicles_here
    FROM workshops w
    WHERE w.company_id = ?
    ORDER BY w.name COLLATE NOCASE, w.id
`;

const SELECT_PLACE = `
    SELECT id, company_id, name, address, phone, latitude, longitude, radius_m
    FROM workshops
    WHERE id = ? AND company_id = ?
`;

/** The circle a position lies in, the nearest one if circles overlap. */
export function workshopAt(
    places: PlaceRow[],
    latitude: number,
    longitude: number,
): PlaceRow | undefined {
    let best: { place: PlaceRow; distance: number } | undefined;

    for (const place of places) {
        const distance = haversineMeters(
            { lat: latitude, lng: longitude },
            { lat: place.latitude, lng: place.longitude },
        );
        if (distance <= place.radius_m && (!best || distance < best.distance)) {
            best = { place, distance };
        }
    }

    return best?.place;
}

function duplicate(error: unknown): never {
    if (isUniqueConstraintError(error)) {
        throw new ConflictError("Eine Werkstatt mit diesem Namen gibt es schon.", {
            name: "Eine Werkstatt mit diesem Namen gibt es schon.",
        });
    }
    throw error;
}

/**
 * Workshops are places of the company with a circle, like depots. Which circle
 * a vehicle stands in is kept on the vehicle (`at_workshop_id`), so arriving,
 * picking up and „ohne Termin“ are plain SQL like every other count.
 */
export class WorkshopPlaceModel {
    static list(companyId: number): WorkshopPlace[] {
        const here = stmt(
            `
            SELECT v.at_workshop_id AS workshop_id, v.id AS vehicle_id, v.license_plate
            FROM vehicles v
            WHERE v.company_id = ? AND v.at_workshop_id IS NOT NULL
            ORDER BY v.license_plate COLLATE NOCASE
            `,
        ).all(companyId) as (WorkshopPlaceVehicle & { workshop_id: number })[];
        const appointments = stmt(
            `
            SELECT w.workshop_id, w.id AS visit_id, w.vehicle_id, v.license_plate, w.state,
                w.planned_on, w.planned_time, w.reasons
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE v.company_id = ? AND w.workshop_id IS NOT NULL
              AND w.state IN ('PLANNED', 'IN_WORKSHOP')
            ORDER BY w.planned_on, w.planned_time IS NULL, w.planned_time, w.id
            `,
        ).all(companyId) as (Omit<WorkshopPlaceAppointment, "reasons"> & {
            workshop_id: number;
            reasons: string;
        })[];
        const of = <T extends { workshop_id: number }>(rows: T[], id: number) =>
            rows.filter((row) => Number(row.workshop_id) === id).slice(0, WORKSHOP_PLACE_LIST_MAX);

        return (stmt(SELECT_PLACES).all(companyId) as (PlaceRow & { vehicles_here: number })[]).map(
            ({ company_id: _company, ...place }) => {
                const id = Number(place.id);
                return {
                    ...place,
                    id,
                    vehicles_here: Number(place.vehicles_here),
                    here: of(here, id).map((row) => ({
                        vehicle_id: Number(row.vehicle_id),
                        license_plate: row.license_plate,
                    })),
                    appointments: of(appointments, id).map((row) => ({
                        visit_id: Number(row.visit_id),
                        vehicle_id: Number(row.vehicle_id),
                        license_plate: row.license_plate,
                        state: row.state,
                        planned_on: row.planned_on,
                        planned_time: row.planned_time ?? null,
                        reasons: parseWorkshopReasons(row.reasons),
                    })),
                };
            },
        );
    }

    static find(id: number, companyId: number): PlaceRow | undefined {
        return stmt(SELECT_PLACE).get(id, companyId) as PlaceRow | undefined;
    }

    static get(id: number, companyId: number): WorkshopPlace {
        const place = this.list(companyId).find((entry) => entry.id === id);
        if (!place) {
            throw new NotFoundError("Werkstatt nicht gefunden.");
        }
        return place;
    }

    static create(companyId: number, input: WorkshopPlaceInput): WorkshopPlace {
        let id: number;
        try {
            const result = stmt(
                `
                INSERT INTO workshops (company_id, name, address, phone, latitude, longitude, radius_m)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                companyId,
                input.name,
                input.address,
                input.phone,
                input.latitude,
                input.longitude,
                input.radius_m,
            );
            id = Number(result.lastInsertRowid);
        } catch (error) {
            duplicate(error);
        }

        this.refreshInside(companyId);
        return this.get(id, companyId);
    }

    static update(id: number, companyId: number, patch: WorkshopPlacePatch): WorkshopPlace {
        const current = this.find(id, companyId);
        if (!current) {
            throw new NotFoundError("Werkstatt nicht gefunden.");
        }

        const next = { ...current, ...patch };
        try {
            stmt(
                `
                UPDATE workshops
                SET name = ?, address = ?, phone = ?, latitude = ?, longitude = ?, radius_m = ?
                WHERE id = ? AND company_id = ?
                `,
            ).run(
                next.name,
                next.address,
                next.phone,
                next.latitude,
                next.longitude,
                next.radius_m,
                id,
                companyId,
            );
        } catch (error) {
            duplicate(error);
        }

        this.refreshInside(companyId);
        return this.get(id, companyId);
    }

    static delete(id: number, companyId: number): void {
        if (!this.find(id, companyId)) {
            throw new NotFoundError("Werkstatt nicht gefunden.");
        }

        const open = stmt(
            `
            SELECT v.license_plate FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE w.workshop_id = ? AND w.state IN ('PLANNED', 'IN_WORKSHOP')
            LIMIT 1
            `,
        ).get(id) as { license_plate: string } | undefined;
        if (open) {
            const message = `Ein offener Aufenthalt nutzt diese Werkstatt (${open.license_plate}). Erst ihn abschließen oder absagen.`;
            throw new AppError(409, "WORKSHOP_IN_USE", message, { workshop: message });
        }

        stmt(`UPDATE vehicles SET at_workshop_id = NULL WHERE at_workshop_id = ?`).run(id);
        stmt(`DELETE FROM workshops WHERE id = ? AND company_id = ?`).run(id, companyId);
    }

    /** Lays the last positions of the company onto its workshop circles again. */
    static refreshInside(companyId: number): void {
        const places = this.placesOf(companyId);
        const rows = stmt(
            `
            SELECT v.id, v.at_workshop_id, t.latitude, t.longitude
            FROM vehicles v
            JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
            `,
        ).all(companyId) as { id: number; at_workshop_id: number | null; latitude: number; longitude: number }[];
        const set = stmt(`UPDATE vehicles SET at_workshop_id = ? WHERE id = ?`);

        for (const row of rows) {
            const next = workshopAt(places, row.latitude, row.longitude)?.id ?? null;
            if (next !== row.at_workshop_id) {
                set.run(next, row.id);
            }
        }
    }

    /**
     * After a tick: which workshop circle each reporting vehicle is in, and a
     * finished stay is picked up when its vehicle leaves that circle.
     * Returns the companies whose vehicles changed.
     */
    static applyPatches(patches: Array<TelemetryPatch & { company_id: number }>): number[] {
        if (patches.length === 0) {
            return [];
        }

        const notify = new Set<number>();
        const byCompany = new Map<number, PlaceRow[]>();
        const ids = JSON.stringify(patches.map((patch) => patch.id));
        const current = new Map(
            (
                stmt(
                    `SELECT id, at_workshop_id FROM vehicles WHERE id IN (SELECT value FROM json_each(?))`,
                ).all(ids) as { id: number; at_workshop_id: number | null }[]
            ).map((row) => [Number(row.id), row.at_workshop_id]),
        );
        const set = stmt(`UPDATE vehicles SET at_workshop_id = ? WHERE id = ?`);
        const pickUp = stmt(
            `
            UPDATE workshop_visits
            SET picked_up_at = ?
            WHERE vehicle_id = ? AND state = 'DONE' AND picked_up_at IS NULL
              AND workshop_id IS NOT NULL AND workshop_id IS NOT ?
            RETURNING id
            `,
        );
        const logPickUp = stmt(
            `
            INSERT INTO workshop_visit_events (visit_id, action, actor_user_id, actor_name, details)
            VALUES (?, 'picked_up', NULL, NULL, ?)
            `,
        );

        for (const patch of patches) {
            let places = byCompany.get(patch.company_id);
            if (!places) {
                places = this.placesOf(patch.company_id);
                byCompany.set(patch.company_id, places);
            }

            const next = workshopAt(places, patch.latitude, patch.longitude)?.id ?? null;
            const before = current.get(patch.id) ?? null;
            if (next === before) {
                continue;
            }

            set.run(next, patch.id);
            notify.add(patch.company_id);

            // Left the workshop it was finished at: picked up.
            for (const row of pickUp.all(nowSqlite(), patch.id, next) as { id: number }[]) {
                logPickUp.run(row.id, JSON.stringify({ by: "position" }));
            }
        }

        return [...notify];
    }

    private static placesOf(companyId: number): PlaceRow[] {
        return stmt(
            `
            SELECT id, company_id, name, address, phone, latitude, longitude, radius_m
            FROM workshops WHERE company_id = ?
            `,
        ).all(companyId) as PlaceRow[];
    }
}
