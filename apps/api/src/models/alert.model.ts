import type {
    Alert,
    AlertDetails,
    AlertListQuery,
    AlertListResponse,
    AlertSeverity,
    AlertSortKey,
    AlertType,
    SpeedingAlertDetails,
} from "@fleet-live/shared";
import { formatAlertEvent, isSpeedingAlertDetails } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { nowSqlite } from "../lib/sqlTime";

const ALERT_COLUMNS = `
        a.id,
        a.vehicle_id,
        v.driver_id,
        v.license_plate,
        v.driver_name,
        a.type,
        a.severity,
        a.message,
        a.details,
        a.created_at,
        a.ended_at,
        a.resolved_at
`;

const SELECT_ONE = `
    SELECT
        ${ALERT_COLUMNS}
    FROM alerts a
    INNER JOIN vehicles v ON v.id = a.vehicle_id
    WHERE a.id = ?
      AND v.company_id = ?
`;

const SELECT_OPEN_SPEEDING = `
    SELECT id, created_at, details
    FROM alerts
    WHERE vehicle_id = ?
      AND type = 'SPEEDING'
      AND ended_at IS NULL
    LIMIT 1
`;

const INSERT_SPEEDING = `
    INSERT INTO alerts (
        vehicle_id,
        type,
        severity,
        message,
        details,
        created_at
    )
    VALUES (?, 'SPEEDING', ?, ?, ?, ?)
`;

const UPDATE_SPEEDING = `
    UPDATE alerts
    SET severity = ?, message = ?, details = ?
    WHERE id = ?
      AND type = 'SPEEDING'
      AND ended_at IS NULL
`;

const END_SPEEDING = `
    UPDATE alerts
    SET ended_at = ?
    WHERE id = ?
      AND type = 'SPEEDING'
      AND ended_at IS NULL
`;

const SELECT_OPEN_TYPE = `
    SELECT id, created_at, details
    FROM alerts
    WHERE vehicle_id = ?
      AND type = ?
      AND ended_at IS NULL
    LIMIT 1
`;

const INSERT_TYPED = `
    INSERT INTO alerts (
        vehicle_id,
        type,
        severity,
        message,
        details,
        created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
`;

const UPDATE_TYPED = `
    UPDATE alerts
    SET severity = ?, message = ?, details = ?
    WHERE id = ?
      AND ended_at IS NULL
`;

const END_OPEN_TYPE = `
    UPDATE alerts
    SET ended_at = ?
    WHERE vehicle_id = ?
      AND type = ?
      AND ended_at IS NULL
`;

const RESOLVE = `
    UPDATE alerts
    SET resolved_at = ?
    WHERE id = ?
      AND resolved_at IS NULL
      AND vehicle_id IN (
          SELECT id FROM vehicles WHERE company_id = ?
      )
`;

const FILTER_SQL = {
    open: "AND a.resolved_at IS NULL",
    resolved: "AND a.resolved_at IS NOT NULL",
    all: "",
} as const;

const SORT_SQL: Record<AlertSortKey, string> = {
    created_at: "a.created_at",
    type: `CASE a.type
        WHEN 'SPEEDING' THEN 1
        WHEN 'LOW_FUEL' THEN 2
        WHEN 'OFFLINE' THEN 3
        ELSE 4
    END`,
    severity: `CASE a.severity
        WHEN 'LOW' THEN 1
        WHEN 'MEDIUM' THEN 2
        WHEN 'HIGH' THEN 3
        ELSE 4
    END`,
    driver_name: "v.driver_name COLLATE NOCASE",
    license_plate: "v.license_plate COLLATE NOCASE",
};

type AlertSqlRow = Omit<Alert, "details"> & {
    details: string | AlertDetails | null;
    total?: number;
};

type FacetRow = {
    all_count: number;
    open_count: number;
    resolved_count: number;
};

type TypeFacetRow = {
    all_count: number;
    speeding_count: number;
    low_fuel_count: number;
    offline_count: number;
};

function parseDetails(raw: unknown): AlertDetails | null {
    if (raw == null) {
        return null;
    }

    if (typeof raw === "object") {
        return raw as AlertDetails;
    }

    if (typeof raw !== "string" || raw === "") {
        return null;
    }

    try {
        return JSON.parse(raw) as AlertDetails;
    } catch {
        return null;
    }
}

function toAlert(row: AlertSqlRow): Alert {
    const { total: _total, details, ...alert } = row;
    return {
        ...alert,
        details: parseDetails(details),
    };
}

export function speedingDetailsJson(details: SpeedingAlertDetails): string {
    return JSON.stringify(details);
}

export function speedingMessage(details: SpeedingAlertDetails): string {
    return formatAlertEvent({
        type: "SPEEDING",
        message: "Geschwindigkeit überschritten.",
        details,
    });
}

export class AlertModel {
    static listForCompany(
        companyId: number,
        query: AlertListQuery,
    ): AlertListResponse {
        const offset = (query.page - 1) * query.limit;
        const filterSql = FILTER_SQL[query.filter];
        const vehicleSql =
            query.vehicle_id !== undefined ? "AND a.vehicle_id = ?" : "";
        const driverSql =
            query.driver_id !== undefined ? "AND v.driver_id = ?" : "";
        const typeSql = query.type !== undefined ? "AND a.type = ?" : "";
        const sortColumn = SORT_SQL[query.sort];
        const sortDirection = query.dir === "asc" ? "ASC" : "DESC";
        const scopeParams = [
            ...(query.vehicle_id !== undefined ? [query.vehicle_id] : []),
            ...(query.driver_id !== undefined ? [query.driver_id] : []),
        ];
        const typeParams =
            query.type !== undefined ? [query.type] : [];

        const listSql = `
            SELECT
                ${ALERT_COLUMNS},
                COUNT(*) OVER () AS total
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              ${vehicleSql}
              ${driverSql}
              ${filterSql}
              ${typeSql}
            ORDER BY ${sortColumn} ${sortDirection}, a.id ${sortDirection}
            LIMIT ? OFFSET ?
        `;

        const rows = stmt(listSql).all(
            companyId,
            ...scopeParams,
            ...typeParams,
            query.limit,
            offset,
        ) as AlertSqlRow[];

        let total = rows[0]?.total ?? 0;

        if (rows.length === 0) {
            const countSql = `
                SELECT COUNT(*) AS total
                FROM alerts a
                INNER JOIN vehicles v ON v.id = a.vehicle_id
                WHERE v.company_id = ?
                  ${vehicleSql}
                  ${driverSql}
                  ${filterSql}
                  ${typeSql}
            `;
            total = (
                stmt(countSql).get(
                    companyId,
                    ...scopeParams,
                    ...typeParams,
                ) as {
                    total: number;
                }
            ).total;
        }

        const facetSql = `
            SELECT
                COUNT(*) AS all_count,
                COALESCE(SUM(a.resolved_at IS NULL), 0) AS open_count,
                COALESCE(SUM(a.resolved_at IS NOT NULL), 0) AS resolved_count
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              ${vehicleSql}
              ${driverSql}
        `;
        const counts = stmt(facetSql).get(
            companyId,
            ...scopeParams,
        ) as FacetRow;

        const typeFacetSql = `
            SELECT
                COUNT(*) AS all_count,
                COALESCE(SUM(a.type = 'SPEEDING'), 0) AS speeding_count,
                COALESCE(SUM(a.type = 'LOW_FUEL'), 0) AS low_fuel_count,
                COALESCE(SUM(a.type = 'OFFLINE'), 0) AS offline_count
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              ${vehicleSql}
              ${driverSql}
              ${filterSql}
        `;
        const typeCounts = stmt(typeFacetSql).get(
            companyId,
            ...scopeParams,
        ) as TypeFacetRow;
        const pageCount = Math.max(1, Math.ceil(total / query.limit));

        return {
            data: rows.map(toAlert),
            meta: {
                page: query.page,
                limit: query.limit,
                total,
                pageCount,
                counts: {
                    all: Number(counts.all_count),
                    open: Number(counts.open_count),
                    resolved: Number(counts.resolved_count),
                },
                type_counts: {
                    all: Number(typeCounts.all_count),
                    SPEEDING: Number(typeCounts.speeding_count),
                    LOW_FUEL: Number(typeCounts.low_fuel_count),
                    OFFLINE: Number(typeCounts.offline_count),
                },
            },
        };
    }

    static listOpenNewest(companyId: number, limit: number): Alert[] {
        const rows = stmt(
            `
            SELECT ${ALERT_COLUMNS}
            FROM alerts a
            INNER JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.company_id = ?
              AND a.resolved_at IS NULL
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT ?
            `,
        ).all(companyId, limit) as AlertSqlRow[];

        return rows.map(toAlert);
    }

    static getById(id: number, companyId: number): Alert | undefined {
        const row = stmt(SELECT_ONE).get(id, companyId) as
            | AlertSqlRow
            | undefined;
        return row ? toAlert(row) : undefined;
    }

    /**
     * Setzt `resolved_at`, wenn die Warnung noch offen ist. Schon erledigte
     * Zeilen bleiben unverändert (kein zweiter Trigger-Tick am Zähler).
     */
    static resolve(id: number, companyId: number): Alert | undefined {
        const current = this.getById(id, companyId);
        if (!current) {
            return undefined;
        }

        if (current.resolved_at !== null) {
            return current;
        }

        stmt(RESOLVE).run(nowSqlite(), id, companyId);
        return this.getById(id, companyId) ?? current;
    }

    static findOpenSpeeding(vehicleId: number): {
        id: number;
        created_at: string;
        maxSpeed: number;
        details: SpeedingAlertDetails | null;
    } | undefined {
        const row = stmt(SELECT_OPEN_SPEEDING).get(vehicleId) as
            | {
                  id: number;
                  created_at: string;
                  details: string | null;
              }
            | undefined;

        if (!row) {
            return undefined;
        }

        const details = parseDetails(row.details);
        const speeding = isSpeedingAlertDetails(details) ? details : null;

        return {
            id: row.id,
            created_at: row.created_at,
            maxSpeed: speeding?.max_speed_kmh ?? 0,
            details: speeding,
        };
    }

    static openSpeeding(input: {
        vehicleId: number;
        createdAt: string;
        severity: "MEDIUM" | "HIGH";
        details: SpeedingAlertDetails;
    }): number {
        const existing = this.findOpenSpeeding(input.vehicleId);

        if (existing) {
            this.updateSpeeding(existing.id, input.severity, input.details);
            return existing.id;
        }

        const result = stmt(INSERT_SPEEDING).run(
            input.vehicleId,
            input.severity,
            speedingMessage(input.details),
            speedingDetailsJson(input.details),
            input.createdAt,
        );

        return Number(result.lastInsertRowid);
    }

    static updateSpeeding(
        id: number,
        severity: "MEDIUM" | "HIGH",
        details: SpeedingAlertDetails,
    ): void {
        stmt(UPDATE_SPEEDING).run(
            severity,
            speedingMessage(details),
            speedingDetailsJson(details),
            id,
        );
    }

    static endSpeeding(id: number, endedAt: string): void {
        stmt(END_SPEEDING).run(endedAt, id);
    }

    static findOpenByType(
        vehicleId: number,
        type: AlertType,
    ): { id: number } | undefined {
        const row = stmt(SELECT_OPEN_TYPE).get(vehicleId, type) as
            | { id: number }
            | undefined;
        return row ? { id: row.id } : undefined;
    }

    /**
     * Eine offene Zeile pro Fahrzeug und Typ. Schon offene Zeilen werden
     * nur aktualisiert (kein zweiter `active_alerts`-Tick).
     */
    static ensureOpen(input: {
        vehicleId: number;
        type: Exclude<AlertType, "SPEEDING">;
        createdAt: string;
        severity: AlertSeverity;
        message: string;
        details: AlertDetails | null;
    }): { id: number; opened: boolean } {
        const existing = this.findOpenByType(input.vehicleId, input.type);
        const detailsJson =
            input.details === null ? null : JSON.stringify(input.details);

        if (existing) {
            stmt(UPDATE_TYPED).run(
                input.severity,
                input.message,
                detailsJson,
                existing.id,
            );
            return { id: existing.id, opened: false };
        }

        const result = stmt(INSERT_TYPED).run(
            input.vehicleId,
            input.type,
            input.severity,
            input.message,
            detailsJson,
            input.createdAt,
        );

        return { id: Number(result.lastInsertRowid), opened: true };
    }

    static endOpenType(
        vehicleId: number,
        type: AlertType,
        endedAt: string,
    ): boolean {
        const result = stmt(END_OPEN_TYPE).run(endedAt, vehicleId, type);
        return result.changes > 0;
    }
}
