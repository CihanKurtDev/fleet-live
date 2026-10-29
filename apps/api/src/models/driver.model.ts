import { DRIVER_TALK_MIN_OPEN_WARNINGS } from "@fleet-live/shared";
import type {
    Driver,
    DriverDetail,
    DriverIncidentCounts,
    DriverListQuery,
    DriverListResponse,
    DriverSortKey,
    DriverVehicle,
    VehicleStatus,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { withTransaction } from "../db/database";
import {
    AppError,
    ConflictError,
    NotFoundError,
    isUniqueConstraintError,
} from "../lib/errors";
import { WorkshopModel } from "./workshop.model";
import { pagedQuery, type SqlParam } from "../lib/pagination";

const INSERT_OR_IGNORE = `
    INSERT INTO drivers (company_id, name, phone, licence_expires_on, licence_checked_on)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id, name) DO NOTHING
`;

const INSERT_DRIVER = `
    INSERT INTO drivers (company_id, name, phone, licence_expires_on, licence_checked_on)
    VALUES (?, ?, ?, ?, ?)
`;

const SELECT_ID = `
    SELECT id FROM drivers WHERE company_id = ? AND name = ?
`;

const SELECT_ONE = `
    SELECT id, name, phone, licence_expires_on, licence_checked_on, active, created_at
    FROM drivers
    WHERE id = ? AND company_id = ?
`;

type DriverCore = {
    id: number;
    name: string;
    phone: string | null;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
    active: number | boolean;
    created_at: string;
};

type DriverDateInput = {
    licence_expires_on?: string | null;
    licence_checked_on?: string | null;
};

type DriverRow = {
    id: number;
    name: string;
    phone: string | null;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
    active: number | boolean;
    created_at: string;
    vehicle_count: number;
    vehicle_plate: string | null;
    current_vehicle_plate: string | null;
    current_vehicle_status: VehicleStatus | null;
    open_warnings: number;
    last_warning_at: string | null;
    speeding: number;
    all_incidents: number;
    total?: number;
};

function toLikePattern(search: string): string {
    const escaped = search
        .replaceAll("#", "##")
        .replaceAll("%", "#%")
        .replaceAll("_", "#_");

    return `%${escaped.toLowerCase()}%`;
}

function toCounts(row: DriverRow): DriverIncidentCounts {
    const speeding = Number(row.speeding);

    return {
        all: speeding,
        SPEEDING: speeding,
        LOW_FUEL: 0,
        OFFLINE: 0,
    };
}

function toDriver(row: DriverRow): Driver {
    return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        licence_expires_on: row.licence_expires_on,
        licence_checked_on: row.licence_checked_on,
        active: Number(row.active) === 1,
        created_at: row.created_at,
        vehicle_count: Number(row.vehicle_count),
        vehicle_plate: row.vehicle_plate,
        current_vehicle_plate: row.current_vehicle_plate,
        current_vehicle_status: row.current_vehicle_status,
        open_warnings: Number(row.open_warnings),
        last_warning_at: row.last_warning_at ?? null,
        counts: toCounts(row),
    };
}

const AGG_SELECT = `
    d.id,
    d.name,
    d.phone,
    d.licence_expires_on,
    d.licence_checked_on,
    d.active,
    d.created_at,
    (
        SELECT COUNT(*)
        FROM driver_vehicles dv
        WHERE dv.driver_id = d.id
    ) AS vehicle_count,
    CASE
        WHEN (
            SELECT COUNT(*) FROM driver_vehicles dv WHERE dv.driver_id = d.id
        ) = 1 THEN (
            SELECT v.license_plate
            FROM driver_vehicles dv
            INNER JOIN vehicles v ON v.id = dv.vehicle_id
            WHERE dv.driver_id = d.id
        )
        ELSE NULL
    END AS vehicle_plate,
    (
        SELECT v.license_plate
        FROM vehicles v
        WHERE v.current_driver_id = d.id
        LIMIT 1
    ) AS current_vehicle_plate,
    (
        SELECT v.status
        FROM vehicles v
        WHERE v.current_driver_id = d.id
        LIMIT 1
    ) AS current_vehicle_status,
    (
        SELECT COUNT(*)
        FROM alerts a
        WHERE a.driver_id = d.id
          AND a.type = 'SPEEDING'
          AND a.resolved_at IS NULL
    ) AS open_warnings,
    (
        SELECT MAX(a.created_at)
        FROM alerts a
        WHERE a.driver_id = d.id
          AND a.type = 'SPEEDING'
          AND a.resolved_at IS NULL
    ) AS last_warning_at,
    (
        SELECT COUNT(*)
        FROM alerts a
        WHERE a.driver_id = d.id
          AND a.type = 'SPEEDING'
    ) AS speeding,
    (
        SELECT COUNT(*)
        FROM alerts a
        WHERE a.driver_id = d.id
          AND a.type = 'SPEEDING'
    ) AS all_incidents
`;

const SORT_SQL: Record<DriverSortKey, string> = {
    name: "d.name COLLATE NOCASE",
    vehicle_count: "vehicle_count",
    open_warnings: "open_warnings",
    counts: "all_incidents",
};

type DriverVehicleRow = Omit<DriverVehicle, "is_current"> & {
    is_current: number;
};

function loadAssignedVehicles(
    driverId: number,
    companyId: number,
): DriverVehicleRow[] {
    return stmt(
        `
        SELECT
            v.id,
            v.license_plate,
            v.status,
            v.active_alerts,
            CASE WHEN v.current_driver_id = ? THEN 1 ELSE 0 END AS is_current
        FROM driver_vehicles dv
        INNER JOIN vehicles v ON v.id = dv.vehicle_id
        WHERE dv.driver_id = ?
          AND v.company_id = ?
        ORDER BY v.license_plate COLLATE NOCASE
        `,
    ).all(driverId, driverId, companyId) as DriverVehicleRow[];
}

function mapAssigned(rows: DriverVehicleRow[]): DriverVehicle[] {
    return rows.map((row) => ({
        id: row.id,
        license_plate: row.license_plate,
        status: row.status,
        active_alerts: Number(row.active_alerts),
        is_current: Boolean(row.is_current),
    }));
}

export class DriverModel {
    static upsert(
        companyId: number,
        name: string,
        phone?: string | null,
        dates?: DriverDateInput,
    ): number {
        stmt(INSERT_OR_IGNORE).run(
            companyId,
            name,
            phone ?? null,
            dates?.licence_expires_on ?? null,
            dates?.licence_checked_on ?? null,
        );
        const row = stmt(SELECT_ID).get(companyId, name) as
            | { id: number }
            | undefined;

        if (!row) {
            throw new Error("Driver upsert did not return an id.");
        }

        return row.id;
    }

    static create(
        companyId: number,
        name: string,
        phone?: string | null,
        dates?: DriverDateInput,
    ): DriverCore {
        try {
            const result = stmt(INSERT_DRIVER).run(
                companyId,
                name,
                phone ?? null,
                dates?.licence_expires_on ?? null,
                dates?.licence_checked_on ?? null,
            );
            const created = this.getById(
                Number(result.lastInsertRowid),
                companyId,
            );

            if (!created) {
                throw new Error("Created driver was not found.");
            }

            return created;
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ConflictError(
                    "Ein Fahrer mit diesem Namen existiert bereits.",
                    { name: "Ein Fahrer mit diesem Namen existiert bereits." },
                );
            }

            throw error;
        }
    }

    static getById(id: number, companyId: number): DriverCore | undefined {
        const row = stmt(SELECT_ONE).get(id, companyId) as DriverCore | undefined;

        if (!row) {
            return undefined;
        }

        return { ...row, active: Number(row.active) === 1 };
    }

    static update(
        id: number,
        companyId: number,
        input: { name?: string; phone?: string | null } & DriverDateInput,
    ): DriverCore {
        const current = this.getById(id, companyId);
        if (!current) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        const name = input.name ?? current.name;
        const phone = input.phone !== undefined ? input.phone : current.phone;
        const licenceExpires =
            input.licence_expires_on !== undefined
                ? input.licence_expires_on
                : current.licence_expires_on;
        const licenceChecked =
            input.licence_checked_on !== undefined
                ? input.licence_checked_on
                : current.licence_checked_on;

        try {
            withTransaction(() => {
                stmt(
                    `
                    UPDATE drivers
                    SET name = ?, phone = ?, licence_expires_on = ?, licence_checked_on = ?
                    WHERE id = ? AND company_id = ?
                    `,
                ).run(name, phone, licenceExpires, licenceChecked, id, companyId);

                if (name !== current.name) {
                    stmt(
                        `
                        UPDATE vehicles
                        SET driver_name = ?
                        WHERE current_driver_id = ?
                          AND company_id = ?
                        `,
                    ).run(name, id, companyId);
                }
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ConflictError(
                    "Ein Fahrer mit diesem Namen existiert bereits.",
                    { name: "Ein Fahrer mit diesem Namen existiert bereits." },
                );
            }

            throw error;
        }

        const updated = this.getById(id, companyId);
        if (!updated) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        return updated;
    }

    static list(query: DriverListQuery, companyId: number): DriverListResponse {
        const search = query.search;
        const like = toLikePattern(search);
        const offset = (query.page - 1) * query.limit;
        const searchSql =
            search === "" ? "" : "AND lower(d.name) LIKE ? ESCAPE '#'";
        const vehicleSql =
            query.vehicle_id !== undefined
                ? `AND EXISTS (
                    SELECT 1 FROM driver_vehicles dv
                    WHERE dv.driver_id = d.id
                      AND dv.vehicle_id = ?
                  )`
                : "";
        const warningsSql =
            query.min_open_warnings !== undefined
                ? `AND (
                    SELECT COUNT(*)
                    FROM alerts a
                    WHERE a.driver_id = d.id
                      AND a.type = 'SPEEDING'
                      AND a.resolved_at IS NULL
                  ) >= ?`
                : "";
        const withoutVehicleSql = query.without_vehicle
            ? `AND NOT EXISTS (
                SELECT 1 FROM vehicles v
                WHERE v.current_driver_id = d.id
              )`
            : "";
        const filterSql = `${searchSql}
              ${vehicleSql}
              ${warningsSql}
              ${withoutVehicleSql}`;
        const sortKey = query.sort ?? "open_warnings";
        const sortColumn = SORT_SQL[sortKey];
        const sortDirection = query.sort
            ? query.dir === "desc"
                ? "DESC"
                : "ASC"
            : "DESC";

        const listSql = `
            SELECT
                ${AGG_SELECT},
                COUNT(*) OVER () AS total
            FROM drivers d
            WHERE d.company_id = ?
              ${filterSql}
            ORDER BY ${sortColumn} ${sortDirection}, d.id ASC
            LIMIT ? OFFSET ?
        `;
        const countSql = `
            SELECT COUNT(*) AS total
            FROM drivers d
            WHERE d.company_id = ?
              ${filterSql}
        `;

        const params: SqlParam[] = [companyId];
        if (search !== "") {
            params.push(like);
        }
        if (query.vehicle_id !== undefined) {
            params.push(query.vehicle_id);
        }
        if (query.min_open_warnings !== undefined) {
            params.push(query.min_open_warnings);
        }

        const { data, meta } = pagedQuery<DriverRow, Driver>({
            listSql,
            listParams: [...params, query.limit, offset],
            countSql,
            countParams: params,
            page: query.page,
            limit: query.limit,
            map: toDriver,
        });

        // Tile numbers follow the search (and a vehicle scope), not the
        // tile filters, so each tile shows what pressing it would list.
        const facetParams: SqlParam[] = [
            DRIVER_TALK_MIN_OPEN_WARNINGS,
            companyId,
            ...(search !== "" ? [like] : []),
            ...(query.vehicle_id !== undefined ? [query.vehicle_id] : []),
        ];
        const counts = stmt(
            `
            SELECT
                COUNT(*) AS all_count,
                COALESCE(SUM(open_warnings >= ?), 0) AS talk,
                COALESCE(SUM(has_current = 0), 0) AS without_vehicle
            FROM (
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM alerts a
                        WHERE a.driver_id = d.id
                          AND a.type = 'SPEEDING'
                          AND a.resolved_at IS NULL
                    ) AS open_warnings,
                    EXISTS (
                        SELECT 1 FROM vehicles v
                        WHERE v.current_driver_id = d.id
                    ) AS has_current
                FROM drivers d
                WHERE d.company_id = ?
                  ${searchSql}
                  ${vehicleSql}
            )
            `,
        ).get(...facetParams) as {
            all_count: number;
            talk: number;
            without_vehicle: number;
        };

        return {
            data,
            meta: {
                ...meta,
                counts: {
                    all: Number(counts.all_count),
                    talk: Number(counts.talk),
                    without_vehicle: Number(counts.without_vehicle),
                },
            },
        };
    }

    static getDetail(id: number, companyId: number): DriverDetail | undefined {
        const listSql = `
            SELECT ${AGG_SELECT}
            FROM drivers d
            WHERE d.id = ? AND d.company_id = ?
        `;
        const row = stmt(listSql).get(id, companyId) as DriverRow | undefined;

        if (!row) {
            return undefined;
        }

        const vehicles = mapAssigned(loadAssignedVehicles(id, companyId));
        const current = vehicles.find((vehicle) => vehicle.is_current) ?? null;

        return {
            ...toDriver(row),
            vehicles,
            current_vehicle: current,
        };
    }

    static assignVehicle(
        driverId: number,
        vehicleId: number,
        companyId: number,
    ): DriverDetail {
        const driver = this.getById(driverId, companyId);
        if (!driver) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        const vehicle = stmt(
            `
            SELECT id FROM vehicles
            WHERE id = ? AND company_id = ?
            `,
        ).get(vehicleId, companyId) as { id: number } | undefined;

        if (!vehicle) {
            throw new NotFoundError("Fahrzeug nicht gefunden.");
        }

        stmt(
            `
            INSERT OR IGNORE INTO driver_vehicles (driver_id, vehicle_id)
            VALUES (?, ?)
            `,
        ).run(driverId, vehicleId);

        const detail = this.getDetail(driverId, companyId);
        if (!detail) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        return detail;
    }

    static unassignVehicle(
        driverId: number,
        vehicleId: number,
        companyId: number,
    ): DriverDetail {
        const driver = this.getById(driverId, companyId);
        if (!driver) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        const vehicle = stmt(
            `
            SELECT id, license_plate, status, current_driver_id
            FROM vehicles
            WHERE id = ? AND company_id = ?
            `,
        ).get(vehicleId, companyId) as
            | {
                  id: number;
                  license_plate: string;
                  status: string;
                  current_driver_id: number | null;
              }
            | undefined;

        if (!vehicle) {
            throw new NotFoundError("Zuweisung nicht gefunden.");
        }

        if (
            vehicle.status === "DRIVING" &&
            vehicle.current_driver_id === driverId
        ) {
            const message = `${driver.name} ist noch unterwegs auf ${vehicle.license_plate}. Die Zuweisung lässt sich erst nach der Fahrt entfernen.`;
            throw new ConflictError(message, {
                vehicle_id: message,
            });
        }

        const result = stmt(
            `
            DELETE FROM driver_vehicles
            WHERE driver_id = ?
              AND vehicle_id = ?
              AND vehicle_id IN (
                  SELECT id FROM vehicles WHERE company_id = ?
              )
            `,
        ).run(driverId, vehicleId, companyId);

        if (result.changes === 0) {
            throw new NotFoundError("Zuweisung nicht gefunden.");
        }

        const detail = this.getDetail(driverId, companyId);
        if (!detail) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        return detail;
    }

    /**
     * Löscht einen Fahrer der Firma. `false`, wenn es ihn dort nicht gibt.
     * Fahrzeuge verlieren ihn als aktuellen Fahrer, Freigaben entfallen,
     * Warnungen bleiben als Historie ohne Fahrer (`driver_id` NULL).
     */
    static delete(driverId: number, companyId: number): boolean {
        const driver = this.getById(driverId, companyId);
        if (!driver) {
            return false;
        }

        const driving = stmt(
            `
            SELECT license_plate
            FROM vehicles
            WHERE current_driver_id = ?
              AND status = 'DRIVING'
            LIMIT 1
            `,
        ).get(driverId) as { license_plate: string } | undefined;

        if (driving) {
            throw new ConflictError(
                `${driver.name} ist noch unterwegs auf ${driving.license_plate}. Der Fahrer lässt sich erst nach der Fahrt löschen.`,
            );
        }

        withTransaction(() => {
            stmt(
                `
                UPDATE vehicles
                SET current_driver_id = NULL,
                    driver_name = NULL
                WHERE current_driver_id = ?
                `,
            ).run(driverId);
            stmt(`DELETE FROM driver_vehicles WHERE driver_id = ?`).run(
                driverId,
            );
            stmt(`UPDATE alerts SET driver_id = NULL WHERE driver_id = ?`).run(
                driverId,
            );
            stmt(`DELETE FROM drivers WHERE id = ? AND company_id = ?`).run(
                driverId,
                companyId,
            );
        });

        return true;
    }

    static setCurrentVehicle(
        driverId: number,
        vehicleId: number | null,
        companyId: number,
    ): DriverDetail {
        const driver = this.getById(driverId, companyId);
        if (!driver) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        if (vehicleId !== null) {
            const assigned = stmt(
                `
                SELECT
                    v.id,
                    v.license_plate,
                    v.status,
                    v.current_driver_id
                FROM driver_vehicles dv
                INNER JOIN vehicles v ON v.id = dv.vehicle_id
                WHERE dv.driver_id = ?
                  AND dv.vehicle_id = ?
                  AND v.company_id = ?
                `,
            ).get(driverId, vehicleId, companyId) as
                | {
                      id: number;
                      license_plate: string;
                      status: string;
                      current_driver_id: number | null;
                  }
                | undefined;

            if (!assigned) {
                throw new ConflictError(
                    "Das Fahrzeug ist diesem Fahrer nicht zugewiesen.",
                    {
                        vehicle_id:
                            "Das Fahrzeug ist diesem Fahrer nicht zugewiesen.",
                    },
                );
            }

            if (
                assigned.status === "DRIVING" &&
                assigned.current_driver_id !== null &&
                assigned.current_driver_id !== driverId
            ) {
                const message = `${assigned.license_plate} ist unterwegs. Aktueller Fahrer lässt sich erst nach der Fahrt wechseln.`;
                throw new ConflictError(message, {
                    vehicle_id: message,
                });
            }

            const unavailable = WorkshopModel.unavailableReason(vehicleId);
            if (unavailable) {
                throw new AppError(409, "VEHICLE_UNAVAILABLE", unavailable, {
                    vehicle_id: unavailable,
                });
            }
        }

        const drivingCurrent = stmt(
            `
            SELECT id, license_plate
            FROM vehicles
            WHERE company_id = ?
              AND current_driver_id = ?
              AND status = 'DRIVING'
            LIMIT 1
            `,
        ).get(companyId, driverId) as
            | { id: number; license_plate: string }
            | undefined;

        if (
            drivingCurrent &&
            (vehicleId === null || drivingCurrent.id !== vehicleId)
        ) {
            const message =
                vehicleId === null
                    ? `${driver.name} ist noch unterwegs auf ${drivingCurrent.license_plate}. Das aktuelle Fahrzeug lässt sich erst nach der Fahrt aufheben.`
                    : `${driver.name} ist noch unterwegs auf ${drivingCurrent.license_plate}. Aktuelles Fahrzeug lässt sich erst nach der Fahrt wechseln.`;

            throw new ConflictError(message, {
                vehicle_id: message,
            });
        }

        withTransaction(() => {
            stmt(
                `
                UPDATE vehicles
                SET current_driver_id = NULL,
                    driver_name = NULL
                WHERE current_driver_id = ?
                  AND company_id = ?
                `,
            ).run(driverId, companyId);

            if (vehicleId !== null) {
                stmt(
                    `
                    UPDATE vehicles
                    SET current_driver_id = NULL,
                        driver_name = NULL
                    WHERE id = ?
                      AND company_id = ?
                    `,
                ).run(vehicleId, companyId);

                stmt(
                    `
                    UPDATE vehicles
                    SET current_driver_id = ?,
                        driver_name = ?
                    WHERE id = ?
                      AND company_id = ?
                    `,
                ).run(driverId, driver.name, vehicleId, companyId);
            }
        });

        const detail = this.getDetail(driverId, companyId);
        if (!detail) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        return detail;
    }
}
