import type {
    FleetDriver,
    FleetDriversQuery,
    FleetDriversResponse,
    FleetPosition,
    FleetPositionsQuery,
    FleetPositionsResponse,
    Vehicle,
    VehicleInput,
    VehicleListQuery,
    VehicleListResponse,
    VehicleSortKey,
    VehicleFilterId,
} from "@fleet-live/shared";
import { FLEET_DRIVERS_LIST_LIMIT, FLEET_POSITIONS_MAX } from "@fleet-live/shared";
import { DriverModel } from "./driver.model";
import { SpeedingEventModel } from "./speedingEvent.model";
import { stmt } from "../db/statements";
import { db } from "../db/database";

export type VehicleCreateInput = Pick<
    VehicleInput,
    "license_plate" | "driver_name"
> &
    Partial<Pick<VehicleInput, "fuel_level" | "status">> & {
        company_id?: number;
    };

export type VehiclePutInput = VehicleInput;

export type VehiclePatchInput = Partial<VehicleInput>;

const SORT_COLUMNS: Record<VehicleSortKey, string> = {
    license_plate: "v.license_plate",
    driver_name: "v.driver_name",
    status: "v.status",
    fuel_level: "v.fuel_level",
    speed: "t.speed",
    active_alerts: "v.active_alerts",
};

const FILTER_SQL: Record<VehicleFilterId, string> = {
    alerts: "v.active_alerts > 0",
    low_fuel: "v.fuel_level < 20",
    driving: "v.status = 'DRIVING'",
    offline: "v.status = 'OFFLINE'",
};

const SPEEDING_OPEN_SQL = `EXISTS (
        SELECT 1 FROM alerts a
        WHERE a.vehicle_id = v.id
          AND a.type = 'SPEEDING'
          AND a.ended_at IS NULL
    ) AS speeding_open`;

const SELECT_ONE = `
    SELECT
        v.id,
        v.license_plate,
        v.driver_name,
        v.driver_id,
        v.fuel_level,
        v.status,
        t.latitude,
        t.longitude,
        t.speed,
        t.recorded_at,
        v.active_alerts,
        ${SPEEDING_OPEN_SQL},
        v.created_at
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.id = ?
`;

const INSERT_VEHICLE = `
    INSERT INTO vehicles (
        license_plate,
        driver_name,
        driver_id,
        fuel_level,
        status,
        company_id
    )
    VALUES (?, ?, ?, ?, ?, ?)
`;

const UPDATE_VEHICLE = `
    UPDATE vehicles
    SET license_plate = ?, driver_name = ?, driver_id = ?, fuel_level = ?, status = ?
    WHERE id = ? AND company_id = ?
`;

const DELETE_VEHICLE = `DELETE FROM vehicles WHERE id = ? AND company_id = ?`;

function searchMatchSql(searchPlaceholder: string, likePlaceholder: string) {
    return `(${searchPlaceholder} = '' OR v.search_text LIKE ${likePlaceholder} ESCAPE '#')`;
}

const LIST_SEARCH_SQL = searchMatchSql("?1", "?2");

const FACET_SQL = `
    SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(active_alerts > 0), 0) AS alerts,
        COALESCE(SUM(fuel_level < 20), 0) AS low_fuel,
        COALESCE(SUM(status = 'DRIVING'), 0) AS driving,
        COALESCE(SUM(status = 'OFFLINE'), 0) AS offline
    FROM vehicles v
    WHERE v.company_id = ?3
      AND ${LIST_SEARCH_SQL}
`;

type ListRow = Omit<Vehicle, "speeding_open"> & {
    speeding_open: number | boolean;
    total: number;
};

type FacetRow = {
    all_count: number;
    alerts: number;
    low_fuel: number;
    driving: number;
    offline: number;
};

function toLikePattern(search: string): string {
    const escaped = search
        .replaceAll("#", "##")
        .replaceAll("%", "#%")
        .replaceAll("_", "#_");

    return `%${escaped.toLowerCase()}%`;
}

function toVehicle(row: ListRow): Vehicle {
    const { total: _total, speeding_open, ...vehicle } = row;
    return {
        ...vehicle,
        speeding_open: Boolean(speeding_open),
    };
}

export class VehicleModel {
    static list(query: VehicleListQuery, companyId: number): VehicleListResponse {
        const search = query.search;
        const like = toLikePattern(search);
        const offset = (query.page - 1) * query.limit;
        const filterSql = query.filter
            ? `AND ${FILTER_SQL[query.filter]}`
            : "";
        const sortColumn = query.sort
            ? SORT_COLUMNS[query.sort]
            : "v.id";
        const sortDirection = query.dir === "desc" ? "DESC" : "ASC";
        const nullsLast =
            query.sort === "speed" ? `${sortColumn} IS NULL, ` : "";

        const listSql = `
            SELECT
                v.id,
                v.license_plate,
                v.driver_name,
                v.driver_id,
                v.fuel_level,
                v.status,
                t.latitude,
                t.longitude,
                t.speed,
                t.recorded_at,
                v.active_alerts,
                ${SPEEDING_OPEN_SQL},
                v.created_at,
                COUNT(*) OVER () AS total
            FROM vehicles v
            LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?3
              AND ${LIST_SEARCH_SQL}
              ${filterSql}
            ORDER BY ${nullsLast}${sortColumn} ${sortDirection}, v.id ASC
            LIMIT ?4 OFFSET ?5
        `;

        const rows = stmt(listSql).all(
            search,
            like,
            companyId,
            query.limit,
            offset,
        ) as ListRow[];

        let total = rows[0]?.total ?? 0;

        if (rows.length === 0) {
            const countSql = `
                SELECT COUNT(*) AS total
                FROM vehicles v
                WHERE v.company_id = ?3
                  AND ${LIST_SEARCH_SQL}
                  ${filterSql}
            `;
            total = (
                stmt(countSql).get(search, like, companyId) as { total: number }
            ).total;
        }

        const counts = stmt(FACET_SQL).get(search, like, companyId) as FacetRow;
        const pageCount = Math.max(1, Math.ceil(total / query.limit));

        return {
            data: rows.map(toVehicle),
            meta: {
                page: query.page,
                limit: query.limit,
                total,
                pageCount,
                counts: {
                    all: Number(counts.all_count),
                    alerts: Number(counts.alerts),
                    low_fuel: Number(counts.low_fuel),
                    driving: Number(counts.driving),
                    offline: Number(counts.offline),
                },
            },
        };
    }

    /**
     * Letzte Positionen für die Flottenkarte. Ohne Telemetrie kein Punkt.
     * `bbox` schränkt auf den sichtbaren Ausschnitt ein. Mehr Treffer als
     * `FLEET_POSITIONS_MAX` → `truncated`, keine Punkte (kein ID-Sample).
     */
    static positions(
        query: FleetPositionsQuery,
        companyId: number,
    ): FleetPositionsResponse {
        const search = query.search ?? "";
        const like = toLikePattern(search);
        const selectedDrivers = query.drivers ?? [];
        const filterSql = query.filter
            ? `AND ${FILTER_SQL[query.filter]}`
            : "";
        const driverSql =
            selectedDrivers.length > 0
                ? `AND v.driver_name IN (${selectedDrivers.map(() => "?").join(",")})`
                : "";
        const bboxSql = query.bbox
            ? `AND t.latitude BETWEEN ? AND ?
               AND t.longitude BETWEEN ? AND ?`
            : "";
        const sql = `
            SELECT
                v.id,
                v.license_plate,
                v.driver_name,
                v.status,
                t.latitude,
                t.longitude,
                t.speed,
                t.recorded_at
            FROM vehicles v
            INNER JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
              AND ${searchMatchSql("?", "?")}
              ${filterSql}
              ${driverSql}
              ${bboxSql}
            ORDER BY v.id ASC
            LIMIT ?
        `;
        const limit = FLEET_POSITIONS_MAX + 1;
        const params = [
            companyId,
            search,
            like,
            ...selectedDrivers,
            ...(query.bbox
                ? [
                      query.bbox.south,
                      query.bbox.north,
                      query.bbox.west,
                      query.bbox.east,
                  ]
                : []),
            limit,
        ];
        const rows = stmt(sql).all(...params) as FleetPosition[];
        const truncated = rows.length > FLEET_POSITIONS_MAX;

        return {
            data: truncated ? [] : rows,
            meta: { truncated },
        };
    }

    static drivers(
        query: FleetDriversQuery,
        companyId: number,
    ): FleetDriversResponse {
        const roster = Number(
            (
                stmt(`SELECT COUNT(*) AS n FROM vehicles WHERE company_id = ?`).get(
                    companyId,
                ) as { n: number }
            ).n,
        );
        const names = query.names ?? [];
        const search = query.search ?? "";
        const page = query.page ?? 1;
        const limit = FLEET_DRIVERS_LIST_LIMIT;
        const rosterMeta = {
            total: roster,
            page: 1,
            limit,
            pageCount: 0,
        };

        if (names.length === 0 && search === "") {
            return { data: [], meta: rosterMeta };
        }

        if (names.length > 0) {
            const placeholders = names.map(() => "?").join(",");
            const data = stmt(
                `
                SELECT v.driver_name AS name, v.license_plate
                FROM vehicles v
                WHERE v.company_id = ?
                  AND v.driver_name IN (${placeholders})
                ORDER BY v.driver_name COLLATE NOCASE, v.license_plate COLLATE NOCASE
                LIMIT ?
                `,
            ).all(companyId, ...names, limit) as FleetDriver[];

            return {
                data,
                meta: { total: roster, page: 1, limit, pageCount: 1 },
            };
        }

        const like = toLikePattern(search);
        const offset = (page - 1) * limit;
        const rows = stmt(
            `
            SELECT
                v.driver_name AS name,
                v.license_plate,
                COUNT(*) OVER () AS total
            FROM vehicles v
            WHERE v.company_id = ?
              AND v.search_text LIKE ? ESCAPE '#'
            ORDER BY v.driver_name COLLATE NOCASE, v.license_plate COLLATE NOCASE
            LIMIT ? OFFSET ?
            `,
        ).all(companyId, like, limit, offset) as Array<
            FleetDriver & { total: number }
        >;

        let total = rows[0]?.total ?? 0;

        if (rows.length === 0) {
            total = Number(
                (
                    stmt(
                        `
                        SELECT COUNT(*) AS n
                        FROM vehicles v
                        WHERE v.company_id = ?
                          AND v.search_text LIKE ? ESCAPE '#'
                        `,
                    ).get(companyId, like) as { n: number }
                ).n,
            );
        }

        return {
            data: rows.map(({ total: _total, ...row }) => row),
            meta: {
                total,
                page,
                limit,
                pageCount: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    static getById(id: number, companyId: number): Vehicle | undefined {
        const row = stmt(`${SELECT_ONE} AND v.company_id = ?`).get(
            id,
            companyId,
        ) as ListRow | undefined;

        return row ? toVehicle(row) : undefined;
    }

    static ownedIds(ids: number[], companyId: number): number[] {
        const unique: number[] = [];
        const seen = new Set<number>();

        for (const id of ids) {
            if (!Number.isInteger(id) || id < 1 || seen.has(id)) {
                continue;
            }

            seen.add(id);
            unique.push(id);
        }

        if (unique.length === 0) {
            return [];
        }

        const placeholders = unique.map(() => "?").join(",");
        const rows = stmt(
            `
            SELECT id
            FROM vehicles
            WHERE company_id = ?
              AND id IN (${placeholders})
            `,
        ).all(companyId, ...unique) as Array<{ id: number }>;
        const allowed = new Set(rows.map((row) => row.id));

        return unique.filter((id) => allowed.has(id));
    }

    static create(input: VehicleCreateInput): Vehicle {
        const companyId = input.company_id ?? 1;
        const driverId = DriverModel.upsert(companyId, input.driver_name);
        const result = stmt(INSERT_VEHICLE).run(
            input.license_plate,
            input.driver_name,
            driverId,
            input.fuel_level ?? 100,
            input.status ?? "IDLE",
            companyId,
        );

        const created = this.getById(Number(result.lastInsertRowid), companyId);
        if (!created) {
            throw new Error("Created vehicle was not found.");
        }
        return created;
    }

    static replace(
        id: number,
        input: VehiclePutInput,
        companyId: number,
    ): Vehicle | undefined {
        const driverId = DriverModel.upsert(companyId, input.driver_name);
        const result = stmt(UPDATE_VEHICLE).run(
            input.license_plate,
            input.driver_name,
            driverId,
            input.fuel_level,
            input.status,
            id,
            companyId,
        );

        if (result.changes === 0) {
            return undefined;
        }
        return this.getById(id, companyId);
    }

    static update(
        id: number,
        input: VehiclePatchInput,
        companyId: number,
    ): Vehicle | undefined {
        const current = this.getById(id, companyId);
        if (!current) {
            return undefined;
        }

        const driverName = input.driver_name ?? current.driver_name;
        const driverId = DriverModel.upsert(companyId, driverName);
        const result = stmt(UPDATE_VEHICLE).run(
            input.license_plate ?? current.license_plate,
            driverName,
            driverId,
            input.fuel_level ?? current.fuel_level,
            input.status ?? current.status,
            id,
            companyId,
        );

        if (result.changes === 0) {
            return undefined;
        }
        return this.getById(id, companyId);
    }

    static delete(id: number, companyId: number): boolean {
        const result = stmt(DELETE_VEHICLE).run(id, companyId);
        return result.changes > 0;
    }

    static resetForTests() {
        SpeedingEventModel.resetForTests();
        db.exec("DELETE FROM vehicles");
        db.exec("DELETE FROM drivers");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts', 'trips', 'drivers')",
        );
    }
}
