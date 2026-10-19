import type {
    AlertType,
    FleetDriver,
    FleetDensityCell,
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
} from "@fleet-live/shared";
import {
    ALERT_TYPES,
    FLEET_DRIVERS_LIST_LIMIT,
    FLEET_POSITIONS_MAX,
    VEHICLE_FILTERS,
    isAlertType,
    storedHuMonth,
} from "@fleet-live/shared";
import { DriverModel } from "./driver.model";
import { SiteModel } from "./site.model";
import { SpeedingEventModel } from "./speedingEvent.model";
import { ExceptionEventModel } from "./exceptionEvent.model";
import { config } from "../config";
import { stmt } from "../db/statements";
import { VEHICLE_CONCEPT_SQL, conceptCountsSql } from "../db/vehicleConcepts";
import { db } from "../db/database";
import { pagedQuery } from "../lib/pagination";
import { ConflictError, isUniqueConstraintError } from "../lib/errors";

export type VehicleCreateInput = Pick<VehicleInput, "license_plate"> &
    Partial<
        Pick<
            VehicleInput,
            | "fuel_level"
            | "status"
            | "vin"
            | "vehicle_type"
            | "hu_due_on"
            | "uvv_due_on"
            | "uvv_checked_on"
            | "depot"
            | "home_site_id"
            | "cost_center"
        >
    > & {
        company_id?: number;
        /** Nur Seed/Tests: legt Freigabe an und setzt aktuell, wenn frei. */
        driver_name?: string;
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
    vehicle_type: "v.vehicle_type",
    depot: "v.depot",
    hu_due_on: "v.hu_due_on",
    uvv_due_on: "v.uvv_due_on",
};

const FILTER_SQL = VEHICLE_CONCEPT_SQL;

const SPEEDING_OPEN_SQL = `${FILTER_SQL.speeding} AS speeding_open`;

const OPEN_ALERT_TYPES_SQL = `(
        SELECT GROUP_CONCAT(type)
        FROM (
            SELECT DISTINCT a.type AS type
            FROM alerts a
            WHERE a.vehicle_id = v.id
              AND a.resolved_at IS NULL
            ORDER BY a.type
        )
    ) AS open_alert_types`;

const SELECT_ONE = `
    SELECT
        v.id,
        v.license_plate,
        v.driver_name,
        v.current_driver_id,
        v.fuel_level,
        v.status,
        v.vin,
        v.vehicle_type,
        v.hu_due_on,
        v.uvv_checked_on,
        v.uvv_due_on,
        v.active,
        v.depot,
        v.home_site_id,
        v.cost_center,
        t.latitude,
        t.longitude,
        t.speed,
        v.speed_limit_kmh,
        t.recorded_at,
        v.active_alerts,
        ${SPEEDING_OPEN_SQL},
        ${OPEN_ALERT_TYPES_SQL},
        v.created_at
    FROM vehicles v
    LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
    WHERE v.id = ?
`;

const INSERT_VEHICLE = `
    INSERT INTO vehicles (
        license_plate,
        driver_name,
        current_driver_id,
        fuel_level,
        status,
        vin,
        vehicle_type,
        hu_due_on,
        uvv_due_on,
        uvv_checked_on,
        depot,
        cost_center,
        company_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_VEHICLE = `
    UPDATE vehicles
    SET license_plate = ?,
        fuel_level = ?,
        status = ?,
        vin = ?,
        vehicle_type = ?,
        hu_due_on = ?,
        uvv_due_on = ?,
        uvv_checked_on = ?,
        cost_center = ?
    WHERE id = ? AND company_id = ?
`;

const DELETE_VEHICLE = `DELETE FROM vehicles WHERE id = ? AND company_id = ?`;

function searchMatchSql(
    searchPlaceholder: string,
    likePlaceholder: string,
    eligibleLikePlaceholder: string,
) {
    return `(
        ${searchPlaceholder} = ''
        OR v.search_text LIKE ${likePlaceholder} ESCAPE '#'
        OR EXISTS (
            SELECT 1
            FROM driver_vehicles dv
            INNER JOIN drivers d ON d.id = dv.driver_id
            WHERE dv.vehicle_id = v.id
              AND lower(d.name) LIKE ${eligibleLikePlaceholder} ESCAPE '#'
        )
        OR lower(coalesce(v.vin, '')) LIKE ${likePlaceholder} ESCAPE '#'
        OR lower(coalesce(v.depot, '')) LIKE ${likePlaceholder} ESCAPE '#'
        OR lower(coalesce(v.cost_center, '')) LIKE ${likePlaceholder} ESCAPE '#'
    )`;
}

const LIST_SEARCH_SQL = searchMatchSql("?", "?", "?");

const FACET_SQL = `
    SELECT
        COUNT(*) AS all_count,
        ${conceptCountsSql(VEHICLE_FILTERS)}
    FROM vehicles v
    WHERE v.company_id = ?
      AND ${LIST_SEARCH_SQL}
`;

type ListRow = Omit<Vehicle, "speeding_open" | "open_alert_types"> & {
    speeding_open: number | boolean;
    open_alert_types: string | null;
    total: number;
};

function parseOpenAlertTypes(value: string | null | undefined): AlertType[] {
    if (!value) {
        return [];
    }

    const seen = new Set<AlertType>();

    for (const part of value.split(",")) {
        const type = part.trim();

        if (isAlertType(type)) {
            seen.add(type);
        }
    }

    return ALERT_TYPES.filter((type) => seen.has(type));
}

type FacetRow = {
    all_count: number;
    alerts: number;
    low_fuel: number;
    unassigned: number;
    driving: number;
    idle: number;
    offline: number;
    stopped: number;
    in_depot: number;
    speeding: number;
};

function toLikePattern(search: string): string {
    const escaped = search
        .replaceAll("#", "##")
        .replaceAll("%", "#%")
        .replaceAll("_", "#_");

    return `%${escaped.toLowerCase()}%`;
}

function throwIfUniqueConflict(error: unknown): never {
    const message = error instanceof Error ? error.message : "";

    if (/vin/i.test(message)) {
        throw new ConflictError("VIN ist bereits vergeben.", {
            vin: "VIN ist bereits vergeben.",
        });
    }

    throw new ConflictError();
}

function runUnique(run: () => ReturnType<ReturnType<typeof stmt>["run"]>) {
    try {
        return run();
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throwIfUniqueConflict(error);
        }

        throw error;
    }
}

function toVehicle(row: ListRow): Vehicle {
    const { total: _total, speeding_open, open_alert_types, active, ...vehicle } =
        row;
    return {
        ...vehicle,
        active: Number(active) === 1,
        speeding_open: Boolean(speeding_open),
        open_alert_types: parseOpenAlertTypes(open_alert_types),
        speed_limit_kmh:
            vehicle.speed_limit_kmh === null ||
            vehicle.speed_limit_kmh === undefined
                ? null
                : Number(vehicle.speed_limit_kmh),
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
        // Fehlende Werte (kein Fahrer, kein Tempo) immer ans Ende — sonst
        // landen Pool-Fahrzeuge vor „A“ bzw. nach dem Umdrehen vor „Z“.
        const nullsLast =
            query.sort === "speed" ||
            query.sort === "driver_name" ||
            query.sort === "vehicle_type" ||
            query.sort === "depot" ||
            query.sort === "hu_due_on" ||
            query.sort === "uvv_due_on"
                ? `${sortColumn} IS NULL, `
                : "";

        const listSql = `
            SELECT
                v.id,
                v.license_plate,
                v.driver_name,
                v.current_driver_id,
                v.fuel_level,
                v.status,
                v.vin,
                v.vehicle_type,
                v.hu_due_on,
                v.uvv_checked_on,
                v.uvv_due_on,
                v.active,
                v.depot,
                v.home_site_id,
                v.cost_center,
                t.latitude,
                t.longitude,
                t.speed,
                v.speed_limit_kmh,
                t.recorded_at,
                v.active_alerts,
                ${SPEEDING_OPEN_SQL},
                ${OPEN_ALERT_TYPES_SQL},
                v.created_at,
                COUNT(*) OVER () AS total
            FROM vehicles v
            LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
              AND ${LIST_SEARCH_SQL}
              ${filterSql}
            ORDER BY ${nullsLast}${sortColumn} ${sortDirection}, v.id ASC
            LIMIT ? OFFSET ?
        `;
        const countSql = `
            SELECT COUNT(*) AS total
            FROM vehicles v
            WHERE v.company_id = ?
              AND ${LIST_SEARCH_SQL}
              ${filterSql}
        `;
        const { data, meta } = pagedQuery<ListRow, Vehicle>({
            listSql,
            listParams: [companyId, search, like, like, like, like, like, query.limit, offset],
            countSql,
            countParams: [companyId, search, like, like, like, like, like],
            page: query.page,
            limit: query.limit,
            map: toVehicle,
        });

        const counts = stmt(FACET_SQL).get(
            companyId,
            search,
            like,
            like,
            like,
            like,
            like,
        ) as FacetRow;

        return {
            data,
            meta: {
                ...meta,
                counts: {
                    all: Number(counts.all_count),
                    alerts: Number(counts.alerts),
                    low_fuel: Number(counts.low_fuel),
                    unassigned: Number(counts.unassigned),
                    driving: Number(counts.driving),
                    idle: Number(counts.idle),
                    offline: Number(counts.offline),
                    stopped: Number(counts.stopped),
                    in_depot: Number(counts.in_depot),
                    speeding: Number(counts.speeding),
                },
            },
        };
    }

    /** Letzte Positionen oder serverseitig aggregierte Dichtezellen. */
    static positions(
        query: FleetPositionsQuery,
        companyId: number,
    ): FleetPositionsResponse {
        const selectedDrivers = query.drivers ?? [];
        const filterSql = query.filter
            ? `AND ${FILTER_SQL[query.filter]}`
            : "";
        const driverSql =
            selectedDrivers.length > 0
                ? `AND (
                    v.driver_name IN (${selectedDrivers.map(() => "?").join(",")})
                    OR EXISTS (
                        SELECT 1
                        FROM driver_vehicles dv
                        INNER JOIN drivers d ON d.id = dv.driver_id
                        WHERE dv.vehicle_id = v.id
                          AND d.name IN (${selectedDrivers.map(() => "?").join(",")})
                    )
                )`
                : "";
        // Suchtext statt Namensliste: aktueller Fahrer oder Kennzeichen.
        const driverSearch = query.driver_search ?? "";
        const driverSearchSql =
            driverSearch.length > 0
                ? `AND (
                    lower(coalesce(v.driver_name, '')) LIKE ? ESCAPE '#'
                    OR lower(v.license_plate) LIKE ? ESCAPE '#'
                )`
                : "";
        // `search` schränkt diese Antwort nicht ein. Die Karte sucht im
        // geladenen Bestand und blendet die übrigen Fahrzeuge nicht aus.
        const activeBbox = query.bbox;
        const bboxSql = activeBbox
            ? `AND t.latitude BETWEEN ? AND ?
               AND t.longitude BETWEEN ? AND ?`
            : "";
        const matchSql = `
            WHERE v.company_id = ?
              ${filterSql}
              ${driverSql}
              ${driverSearchSql}
        `;
        const matchParams = [
            companyId,
            ...selectedDrivers,
            ...selectedDrivers,
            ...(driverSearch.length > 0
                ? [toLikePattern(driverSearch), toLikePattern(driverSearch)]
                : []),
        ];
        const bboxParams = activeBbox
            ? [
                  activeBbox.south,
                  activeBbox.north,
                  activeBbox.west,
                  activeBbox.east,
              ]
            : [];
        const positionedFrom = `
            FROM vehicles v
            INNER JOIN telemetry t ON t.id = v.last_telemetry_id
            ${matchSql}
            ${bboxSql}
        `;
        const positionedParams = [...matchParams, ...bboxParams];
        const withoutPosition = Number(
            (
                stmt(
                    `
                    SELECT COUNT(*) AS n
                    FROM vehicles v
                    ${matchSql}
                      AND v.last_telemetry_id IS NULL
                    `,
                ).get(...matchParams) as { n: number }
            ).n,
        );
        const positionedAll = activeBbox
            ? Number(
                  (
                      stmt(
                          `
                          SELECT COUNT(*) AS n
                          FROM vehicles v
                          INNER JOIN telemetry t ON t.id = v.last_telemetry_id
                          ${matchSql}
                          `,
                      ).get(...matchParams) as { n: number }
                  ).n,
              )
            : null;
        const extent = stmt(
            `
            SELECT
                COUNT(*) AS total,
                MIN(t.latitude) AS min_latitude,
                MAX(t.latitude) AS max_latitude,
                MIN(t.longitude) AS min_longitude,
                MAX(t.longitude) AS max_longitude
            ${positionedFrom}
            `,
        ).get(...positionedParams) as {
            total: number;
            min_latitude: number | null;
            max_latitude: number | null;
            min_longitude: number | null;
            max_longitude: number | null;
        };
        const positionedTotal = Number(extent.total);
        const matched = (positionedAll ?? positionedTotal) + withoutPosition;

        if (positionedTotal <= FLEET_POSITIONS_MAX) {
            type PositionRow = {
                id: number;
                license_plate: string;
                driver_name: string | null;
                status: FleetPosition["status"];
                latitude: number | null;
                longitude: number | null;
                speed: number | null;
                recorded_at: string | null;
            };
            const rows = stmt(
                `
            SELECT
                v.id,
                v.license_plate,
                v.driver_name,
                v.status,
                t.latitude,
                t.longitude,
                t.speed,
                t.recorded_at
            ${positionedFrom}
            ORDER BY v.id ASC
                `,
            ).all(...positionedParams) as PositionRow[];
            const data: FleetPosition[] = rows.map((row) => ({
                ...row,
                has_position: true,
            }));

            if (!activeBbox && withoutPosition > 0) {
                const missing = stmt(
                    `
                    SELECT v.id, v.license_plate, v.driver_name, v.status
                    FROM vehicles v
                    ${matchSql}
                      AND v.last_telemetry_id IS NULL
                    ORDER BY v.id ASC
                    `,
                ).all(...matchParams) as Array<{
                    id: number;
                    license_plate: string;
                    driver_name: string | null;
                    status: FleetPosition["status"];
                }>;

                for (const row of missing) {
                    data.push({
                        ...row,
                        latitude: null,
                        longitude: null,
                        speed: null,
                        recorded_at: null,
                        has_position: false,
                    });
                }
            }

            return {
                mode: "positions",
                data,
                meta: {
                    total: data.length,
                    matched,
                    without_position: withoutPosition,
                },
            };
        }

        const total = positionedTotal;

        const columns = 32;
        const rows = 20;
        const west = activeBbox?.west ?? Number(extent.min_longitude);
        const east = activeBbox?.east ?? Number(extent.max_longitude);
        const south = activeBbox?.south ?? Number(extent.min_latitude);
        const north = activeBbox?.north ?? Number(extent.max_latitude);
        const cellWidth = Math.max((east - west) / columns, 1e-9);
        const cellHeight = Math.max((north - south) / rows, 1e-9);
        type DensityRow = {
            cell_x: number;
            cell_y: number;
            latitude: number;
            longitude: number;
            total: number;
            idle_count: number;
            driving_count: number;
            stopped_count: number;
            offline_count: number;
        };
        const densityRows = stmt(
            `
            SELECT
                MIN(${columns - 1}, MAX(0, CAST((t.longitude - ?) / ? AS INTEGER))) AS cell_x,
                MIN(${rows - 1}, MAX(0, CAST((t.latitude - ?) / ? AS INTEGER))) AS cell_y,
                AVG(t.latitude) AS latitude,
                AVG(t.longitude) AS longitude,
                COUNT(*) AS total,
                SUM(${VEHICLE_CONCEPT_SQL.idle}) AS idle_count,
                SUM(${VEHICLE_CONCEPT_SQL.driving}) AS driving_count,
                SUM(${VEHICLE_CONCEPT_SQL.stopped}) AS stopped_count,
                SUM(${VEHICLE_CONCEPT_SQL.offline}) AS offline_count
            ${positionedFrom}
            GROUP BY cell_x, cell_y
            ORDER BY cell_y, cell_x
            `,
        ).all(west, cellWidth, south, cellHeight, ...positionedParams) as DensityRow[];
        const data: FleetDensityCell[] = densityRows.map((row) => ({
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            bbox: {
                west: west + Number(row.cell_x) * cellWidth,
                south: south + Number(row.cell_y) * cellHeight,
                east: Math.min(east, west + (Number(row.cell_x) + 1) * cellWidth),
                north: Math.min(
                    north,
                    south + (Number(row.cell_y) + 1) * cellHeight,
                ),
            },
            total: Number(row.total),
            counts: {
                IDLE: Number(row.idle_count),
                DRIVING: Number(row.driving_count),
                STOPPED: Number(row.stopped_count),
                OFFLINE: Number(row.offline_count),
            },
        }));

        return {
            mode: "density",
            data,
            meta: { total, matched, without_position: withoutPosition },
        };
    }

    static drivers(
        query: FleetDriversQuery,
        companyId: number,
    ): FleetDriversResponse {
        const roster = Number(
            (
                stmt(`SELECT COUNT(*) AS n FROM drivers WHERE company_id = ?`).get(
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
                SELECT
                    d.id,
                    d.name,
                    (
                        SELECT v.license_plate
                        FROM vehicles v
                        WHERE v.current_driver_id = d.id
                        LIMIT 1
                    ) AS license_plate
                FROM drivers d
                WHERE d.company_id = ?
                  AND d.name IN (${placeholders})
                ORDER BY d.name COLLATE NOCASE
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
        const matchSql = `
            (
                lower(d.name) LIKE ? ESCAPE '#'
                OR EXISTS (
                    SELECT 1
                    FROM vehicles v
                    WHERE v.current_driver_id = d.id
                      AND lower(v.license_plate) LIKE ? ESCAPE '#'
                )
                OR EXISTS (
                    SELECT 1
                    FROM driver_vehicles dv
                    INNER JOIN vehicles v ON v.id = dv.vehicle_id
                    WHERE dv.driver_id = d.id
                      AND lower(v.license_plate) LIKE ? ESCAPE '#'
                )
            )
        `;
        const { data, meta } = pagedQuery<
            FleetDriver & { total: number },
            FleetDriver
        >({
            listSql: `
                SELECT
                    d.id,
                    d.name,
                    (
                        SELECT v.license_plate
                        FROM vehicles v
                        WHERE v.current_driver_id = d.id
                        LIMIT 1
                    ) AS license_plate,
                    COUNT(*) OVER () AS total
                FROM drivers d
                WHERE d.company_id = ?
                  AND ${matchSql}
                ORDER BY d.name COLLATE NOCASE
                LIMIT ? OFFSET ?
            `,
            listParams: [companyId, like, like, like, limit, offset],
            countSql: `
                SELECT COUNT(*) AS total
                FROM drivers d
                WHERE d.company_id = ?
                  AND ${matchSql}
            `,
            countParams: [companyId, like, like, like],
            page,
            limit,
            map: ({ total: _total, ...row }) => row,
        });

        return { data, meta };
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
        if (input.company_id === undefined && !config.isTest) {
            throw new Error("Vehicle company_id is required.");
        }

        // Tests default to company 1 for compact fixtures. Runtime callers must
        // always pass the authenticated or imported company explicitly.
        const companyId = input.company_id ?? 1;
        const result = runUnique(() =>
            stmt(INSERT_VEHICLE).run(
                input.license_plate,
                null,
                null,
                input.fuel_level ?? 100,
                input.status ?? "IDLE",
                input.vin ?? null,
                input.vehicle_type ?? null,
                storedHuMonth(input.hu_due_on ?? null),
                input.uvv_due_on ?? null,
                input.uvv_checked_on ?? null,
                null,
                input.cost_center ?? null,
                companyId,
            ),
        );

        const id = Number(result.lastInsertRowid);
        SiteModel.syncHome(id, companyId, input);

        const driverName = input.driver_name?.trim();

        if (driverName) {
            const driverId = DriverModel.upsert(companyId, driverName);
            DriverModel.assignVehicle(driverId, id, companyId);
            const occupied = stmt(
                `
                SELECT id FROM vehicles
                WHERE current_driver_id = ?
                LIMIT 1
                `,
            ).get(driverId) as { id: number } | undefined;

            if (!occupied) {
                DriverModel.setCurrentVehicle(driverId, id, companyId);
            }
        }

        const created = this.getById(id, companyId);
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
        const current = this.getById(id, companyId);
        if (!current) {
            return undefined;
        }

        // Während DRIVING schreibt die Telemetrie den Tank — kein Formularwert.
        const fuelLevel =
            current.status === "DRIVING" && input.status === "DRIVING"
                ? current.fuel_level
                : input.fuel_level;

        const result = runUnique(() =>
            stmt(UPDATE_VEHICLE).run(
                input.license_plate,
                fuelLevel,
                input.status,
                input.vin ?? null,
                input.vehicle_type ?? null,
                storedHuMonth(input.hu_due_on ?? null),
                input.uvv_due_on ?? null,
                input.uvv_checked_on !== undefined
                    ? input.uvv_checked_on
                    : current.uvv_checked_on,
                input.cost_center ?? null,
                id,
                companyId,
            ),
        );

        if (result.changes === 0) {
            return undefined;
        }

        SiteModel.syncHome(id, companyId, input);

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

        const nextStatus = input.status ?? current.status;
        const fuelLevel =
            current.status === "DRIVING" && nextStatus === "DRIVING"
                ? current.fuel_level
                : (input.fuel_level ?? current.fuel_level);

        const result = runUnique(() =>
            stmt(UPDATE_VEHICLE).run(
                input.license_plate ?? current.license_plate,
                fuelLevel,
                nextStatus,
                input.vin !== undefined ? input.vin : current.vin,
                input.vehicle_type !== undefined
                    ? input.vehicle_type
                    : current.vehicle_type,
                input.hu_due_on !== undefined
                    ? storedHuMonth(input.hu_due_on)
                    : current.hu_due_on,
                input.uvv_due_on !== undefined
                    ? input.uvv_due_on
                    : current.uvv_due_on,
                input.uvv_checked_on !== undefined
                    ? input.uvv_checked_on
                    : current.uvv_checked_on,
                input.cost_center !== undefined
                    ? input.cost_center
                    : current.cost_center,
                id,
                companyId,
            ),
        );

        if (result.changes === 0) {
            return undefined;
        }

        SiteModel.syncHome(id, companyId, input);

        return this.getById(id, companyId);
    }

    static delete(id: number, companyId: number): boolean {
        const result = stmt(DELETE_VEHICLE).run(id, companyId);
        return result.changes > 0;
    }

    static resetForTests() {
        SpeedingEventModel.resetForTests();
        ExceptionEventModel.resetForTests();
        db.exec("DELETE FROM vehicles");
        db.exec("DELETE FROM sites");
        db.exec("DELETE FROM drivers");
        db.exec("DELETE FROM trip_month_km");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts', 'trips', 'drivers')",
        );
    }
}
