import type {
    Driver,
    DriverDetail,
    DriverIncidentCounts,
    DriverListQuery,
    DriverListResponse,
    DriverSortKey,
    DriverVehicle,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";

const INSERT_OR_IGNORE = `
    INSERT INTO drivers (company_id, name)
    VALUES (?, ?)
    ON CONFLICT(company_id, name) DO NOTHING
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
    open_warnings: number;
    speeding: number;
    low_fuel: number;
    offline: number;
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
    return {
        all: Number(row.all_incidents),
        SPEEDING: Number(row.speeding),
        LOW_FUEL: Number(row.low_fuel),
        OFFLINE: Number(row.offline),
    };
}

function toDriver(row: DriverRow): Driver {
    return {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        vehicle_count: Number(row.vehicle_count),
        vehicle_plate: row.vehicle_plate,
        open_warnings: Number(row.open_warnings),
        counts: toCounts(row),
    };
}

const AGG_SELECT = `
    d.id,
    d.name,
    d.created_at,
    COUNT(DISTINCT v.id) AS vehicle_count,
    CASE
        WHEN COUNT(DISTINCT v.id) = 1 THEN MIN(v.license_plate)
        ELSE NULL
    END AS vehicle_plate,
    COALESCE(SUM(a.id IS NOT NULL AND a.resolved_at IS NULL), 0) AS open_warnings,
    COALESCE(SUM(a.type = 'SPEEDING'), 0) AS speeding,
    COALESCE(SUM(a.type = 'LOW_FUEL'), 0) AS low_fuel,
    COALESCE(SUM(a.type = 'OFFLINE'), 0) AS offline,
    COUNT(a.id) AS all_incidents
`;

const SORT_SQL: Record<DriverSortKey, string> = {
    name: "d.name COLLATE NOCASE",
    vehicle_count: "vehicle_count",
    open_warnings: "open_warnings",
    counts: "all_incidents",
};

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
            search === ""
                ? ""
                : "AND lower(d.name) LIKE ? ESCAPE '#'";
        const sortKey = query.sort ?? "name";
        const sortColumn = SORT_SQL[sortKey];
        const sortDirection = query.dir === "desc" ? "DESC" : "ASC";

        const listSql = `
            SELECT
                ${AGG_SELECT},
                COUNT(*) OVER () AS total
            FROM drivers d
            LEFT JOIN vehicles v ON v.driver_id = d.id
            LEFT JOIN alerts a ON a.vehicle_id = v.id
            WHERE d.company_id = ?
              ${searchSql}
            GROUP BY d.id
            ORDER BY ${sortColumn} ${sortDirection}, d.id ASC
            LIMIT ? OFFSET ?
        `;

        const params =
            search === ""
                ? [companyId, query.limit, offset]
                : [companyId, like, query.limit, offset];

        const rows = stmt(listSql).all(...params) as DriverRow[];
        let total = rows[0]?.total ?? 0;

        if (rows.length === 0) {
            const countSql = `
                SELECT COUNT(*) AS total
                FROM drivers d
                WHERE d.company_id = ?
                  ${searchSql}
            `;
            const countParams = search === "" ? [companyId] : [companyId, like];
            total = (
                stmt(countSql).get(...countParams) as { total: number }
            ).total;
        }

        const pageCount = Math.max(1, Math.ceil(total / query.limit));

        return {
            data: rows.map(toDriver),
            meta: {
                page: query.page,
                limit: query.limit,
                total,
                pageCount,
            },
        };
    }

    static getDetail(id: number, companyId: number): DriverDetail | undefined {
        const listSql = `
            SELECT ${AGG_SELECT}
            FROM drivers d
            LEFT JOIN vehicles v ON v.driver_id = d.id
            LEFT JOIN alerts a ON a.vehicle_id = v.id
            WHERE d.id = ? AND d.company_id = ?
            GROUP BY d.id
        `;
        const row = stmt(listSql).get(id, companyId) as DriverRow | undefined;

        if (!row) {
            return undefined;
        }

        const vehicles = stmt(
            `
            SELECT id, license_plate, status, active_alerts
            FROM vehicles
            WHERE driver_id = ? AND company_id = ?
            ORDER BY license_plate COLLATE NOCASE
            `,
        ).all(id, companyId) as DriverVehicle[];

        return {
            ...toDriver(row),
            vehicles,
        };
    }
}
