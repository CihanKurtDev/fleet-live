import type {
    Vehicle,
    VehicleInput,
    VehicleListQuery,
    VehicleListResponse,
    VehicleSortKey,
    VehicleFilterId,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { db } from "../db/database";

export type VehicleCreateInput = Pick<
    VehicleInput,
    "license_plate" | "driver_name"
> &
    Partial<Pick<VehicleInput, "fuel_level" | "status">>;

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

const SELECT_ONE = `
    SELECT
        v.id,
        v.license_plate,
        v.driver_name,
        v.fuel_level,
        v.status,
        t.latitude,
        t.longitude,
        t.speed,
        t.recorded_at,
        v.active_alerts,
        v.created_at
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.id = ?
`;

const INSERT_VEHICLE = `
    INSERT INTO vehicles (license_plate, driver_name, fuel_level, status)
    VALUES (?, ?, ?, ?)
`;

const UPDATE_VEHICLE = `
    UPDATE vehicles
    SET license_plate = ?, driver_name = ?, fuel_level = ?, status = ?
    WHERE id = ?
`;

const DELETE_VEHICLE = `DELETE FROM vehicles WHERE id = ?`;

const FACET_SQL = `
    SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(active_alerts > 0), 0) AS alerts,
        COALESCE(SUM(fuel_level < 20), 0) AS low_fuel,
        COALESCE(SUM(status = 'DRIVING'), 0) AS driving,
        COALESCE(SUM(status = 'OFFLINE'), 0) AS offline
    FROM vehicles v
    WHERE (?1 = '' OR v.search_text LIKE ?2 ESCAPE '#')
`;

type ListRow = Vehicle & { total: number };

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
    const { total: _total, ...vehicle } = row;
    return vehicle;
}

export class VehicleModel {
    static list(query: VehicleListQuery): VehicleListResponse {
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
                v.fuel_level,
                v.status,
                t.latitude,
                t.longitude,
                t.speed,
                t.recorded_at,
                v.active_alerts,
                v.created_at,
                COUNT(*) OVER () AS total
            FROM vehicles v
            LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE (?1 = '' OR v.search_text LIKE ?2 ESCAPE '#')
              ${filterSql}
            ORDER BY ${nullsLast}${sortColumn} ${sortDirection}, v.id ASC
            LIMIT ?3 OFFSET ?4
        `;

        const rows = stmt(listSql).all(
            search,
            like,
            query.limit,
            offset,
        ) as ListRow[];

        let total = rows[0]?.total ?? 0;

        if (rows.length === 0) {
            const countSql = `
                SELECT COUNT(*) AS total
                FROM vehicles v
                WHERE (?1 = '' OR v.search_text LIKE ?2 ESCAPE '#')
                  ${filterSql}
            `;
            total = (stmt(countSql).get(search, like) as { total: number })
                .total;
        }

        const counts = stmt(FACET_SQL).get(search, like) as FacetRow;
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

    static getById(id: number): Vehicle | undefined {
        return stmt(SELECT_ONE).get(id) as Vehicle | undefined;
    }

    static create(input: VehicleCreateInput): Vehicle {
        const result = stmt(INSERT_VEHICLE).run(
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

    static replace(id: number, input: VehiclePutInput): Vehicle | undefined {
        const result = stmt(UPDATE_VEHICLE).run(
            input.license_plate,
            input.driver_name,
            input.fuel_level,
            input.status,
            id,
        );

        if (result.changes === 0) {
            return undefined;
        }
        return this.getById(id);
    }

    static update(id: number, input: VehiclePatchInput): Vehicle | undefined {
        const current = this.getById(id);
        if (!current) {
            return undefined;
        }

        const result = stmt(UPDATE_VEHICLE).run(
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
        const result = stmt(DELETE_VEHICLE).run(id);
        return result.changes > 0;
    }

    static resetForTests() {
        db.exec("DELETE FROM vehicles");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts')",
        );
    }
}
