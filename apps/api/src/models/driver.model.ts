import type {
    BriefingDriver,
    Driver,
    DriverDetail,
    DriverIncidentCounts,
    DriverListQuery,
    DriverListResponse,
    DriverSortKey,
    DriverVehicle,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { db } from "../db/database";
import { ConflictError, NotFoundError, isUniqueConstraintError } from "../lib/errors";
import { pagedQuery, type SqlParam } from "../lib/pagination";

const INSERT_OR_IGNORE = `
    INSERT INTO drivers (company_id, name)
    VALUES (?, ?)
    ON CONFLICT(company_id, name) DO NOTHING
`;

const INSERT_DRIVER = `
    INSERT INTO drivers (company_id, name)
    VALUES (?, ?)
`;

const SELECT_ID = `
    SELECT id FROM drivers WHERE company_id = ? AND name = ?
`;

const SELECT_ONE = `
    SELECT id, name, created_at
    FROM drivers
    WHERE id = ? AND company_id = ?
`;

type DriverRow = {
    id: number;
    name: string;
    created_at: string;
    vehicle_count: number;
    vehicle_plate: string | null;
    current_vehicle_plate: string | null;
    open_warnings: number;
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
        created_at: row.created_at,
        vehicle_count: Number(row.vehicle_count),
        vehicle_plate: row.vehicle_plate,
        current_vehicle_plate: row.current_vehicle_plate,
        open_warnings: Number(row.open_warnings),
        counts: toCounts(row),
    };
}

const AGG_SELECT = `
    d.id,
    d.name,
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
        SELECT COUNT(*)
        FROM alerts a
        WHERE a.driver_id = d.id
          AND a.type = 'SPEEDING'
          AND a.resolved_at IS NULL
    ) AS open_warnings,
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

function loadAssignedVehicles(
    driverId: number,
    companyId: number,
): DriverVehicle[] {
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
    ).all(driverId, driverId, companyId) as Array<
        Omit<DriverVehicle, "is_current"> & { is_current: number }
    >;
}

function mapAssigned(
    rows: Array<Omit<DriverVehicle, "is_current"> & { is_current: number }>,
): DriverVehicle[] {
    return rows.map((row) => ({
        id: row.id,
        license_plate: row.license_plate,
        status: row.status,
        active_alerts: Number(row.active_alerts),
        is_current: Boolean(row.is_current),
    }));
}

export class DriverModel {
    static upsert(companyId: number, name: string): number {
        stmt(INSERT_OR_IGNORE).run(companyId, name);
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
    ): { id: number; name: string; created_at: string } {
        try {
            const result = stmt(INSERT_DRIVER).run(companyId, name);
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

    static getById(
        id: number,
        companyId: number,
    ): { id: number; name: string; created_at: string } | undefined {
        return stmt(SELECT_ONE).get(id, companyId) as
            | { id: number; name: string; created_at: string }
            | undefined;
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
        const sortKey = query.sort ?? "name";
        const sortColumn = SORT_SQL[sortKey];
        const sortDirection = query.dir === "desc" ? "DESC" : "ASC";

        const listSql = `
            SELECT
                ${AGG_SELECT},
                COUNT(*) OVER () AS total
            FROM drivers d
            WHERE d.company_id = ?
              ${searchSql}
              ${vehicleSql}
            ORDER BY ${sortColumn} ${sortDirection}, d.id ASC
            LIMIT ? OFFSET ?
        `;
        const countSql = `
            SELECT COUNT(*) AS total
            FROM drivers d
            WHERE d.company_id = ?
              ${searchSql}
              ${vehicleSql}
        `;

        const params: SqlParam[] = [companyId];
        if (search !== "") {
            params.push(like);
        }
        if (query.vehicle_id !== undefined) {
            params.push(query.vehicle_id);
        }

        return pagedQuery<DriverRow, Driver>({
            listSql,
            listParams: [...params, query.limit, offset],
            countSql,
            countParams: params,
            page: query.page,
            limit: query.limit,
            map: toDriver,
        });
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
                SELECT v.id, v.company_id
                FROM driver_vehicles dv
                INNER JOIN vehicles v ON v.id = dv.vehicle_id
                WHERE dv.driver_id = ?
                  AND dv.vehicle_id = ?
                  AND v.company_id = ?
                `,
            ).get(driverId, vehicleId, companyId) as
                | { id: number }
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
        }

        const drivingCurrent = stmt(
            `
            SELECT id
            FROM vehicles
            WHERE company_id = ?
              AND current_driver_id = ?
              AND status = 'DRIVING'
            LIMIT 1
            `,
        ).get(companyId, driverId) as { id: number } | undefined;

        if (
            drivingCurrent &&
            (vehicleId === null || drivingCurrent.id !== vehicleId)
        ) {
            throw new ConflictError(
                "Fahrer ist noch unterwegs. Aktuelles Fahrzeug lässt sich erst nach der Fahrt wechseln.",
                {
                    vehicle_id:
                        "Fahrer ist noch unterwegs. Aktuelles Fahrzeug lässt sich erst nach der Fahrt wechseln.",
                },
            );
        }

        db.exec("BEGIN");

        try {
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

            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

        const detail = this.getDetail(driverId, companyId);
        if (!detail) {
            throw new NotFoundError("Fahrer nicht gefunden.");
        }

        return detail;
    }

    static listTopByOpenWarnings(
        companyId: number,
        limit: number,
    ): BriefingDriver[] {
        const rows = stmt(
            `
            SELECT
                d.id,
                d.name,
                COUNT(a.id) AS open_warnings
            FROM drivers d
            INNER JOIN alerts a
                ON a.driver_id = d.id
               AND a.type = 'SPEEDING'
               AND a.resolved_at IS NULL
            WHERE d.company_id = ?
            GROUP BY d.id
            ORDER BY open_warnings DESC, d.name COLLATE NOCASE, d.id ASC
            LIMIT ?
            `,
        ).all(companyId, limit) as Array<{
            id: number;
            name: string;
            open_warnings: number;
        }>;

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            open_warnings: Number(row.open_warnings),
        }));
    }
}
