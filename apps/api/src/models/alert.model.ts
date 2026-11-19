import type {
    Alert,
    AlertBulkFilter,
    AlertDetails,
    AlertListQuery,
    AlertListResponse,
    AlertSeverity,
    AlertSortKey,
    AlertType,
    SpeedingAlertDetails,
} from "@fleet-live/shared";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    formatAlertEvent,
    isSpeedingAlertDetails,
} from "@fleet-live/shared";
import { withTransaction } from "../db/database";
import { SELF_CLOSING_TYPES_SQL } from "../db/stateAlerts";
import { stmt } from "../db/statements";
import { overLimitKmh, speedingSeverity } from "../lib/speeding";
import { nowSqlite } from "../lib/sqlTime";
import { PrivacyModel } from "./privacy.model";

const ALERT_COLUMNS = `
        a.id,
        a.vehicle_id,
        a.driver_id,
        v.license_plate,
        d.name AS driver_name,
        a.type,
        a.severity,
        a.message,
        a.details,
        a.created_at,
        a.ended_at,
        a.resolved_at,
        a.resolution_note,
        (
            SELECT e.trip_id FROM trip_events e
            WHERE e.alert_id = a.id
            ORDER BY e.id
            LIMIT 1
        ) AS trip_id
`;

const SELECT_ONE = `
    SELECT
        ${ALERT_COLUMNS}
    FROM alerts a
    INNER JOIN vehicles v ON v.id = a.vehicle_id
    LEFT JOIN drivers d ON d.id = a.driver_id
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

// One warning per trip: the latest unresolved one since the open trip began.
const SELECT_TRIP_SPEEDING = `
    SELECT a.id, a.details
    FROM alerts a
    WHERE a.vehicle_id = ?
      AND a.type = 'SPEEDING'
      AND a.resolved_at IS NULL
      AND a.ended_at IS NOT NULL
      AND a.created_at >= (
          SELECT t.started_at FROM trips t
          WHERE t.vehicle_id = a.vehicle_id AND t.ended_at IS NULL
          ORDER BY t.started_at DESC LIMIT 1
      )
    ORDER BY a.created_at DESC
    LIMIT 1
`;

const REOPEN_SPEEDING = `
    UPDATE alerts
    SET ended_at = NULL, severity = ?, message = ?, details = ?
    WHERE id = ?
      AND type = 'SPEEDING'
`;

const SELECT_DETAILS = `SELECT details FROM alerts WHERE id = ?`;

const INSERT_SPEEDING = `
    INSERT INTO alerts (
        vehicle_id,
        driver_id,
        type,
        severity,
        message,
        details,
        created_at
    )
    VALUES (?, ?, 'SPEEDING', ?, ?, ?, ?)
`;

const UPDATE_SPEEDING = `
    UPDATE alerts
    SET severity = ?, message = ?, details = ?
    WHERE id = ?
      AND type = 'SPEEDING'
      AND ended_at IS NULL
`;

const SELECT_ALL_OPEN_SPEEDING = `
    SELECT a.id AS id, a.vehicle_id AS vehicle_id, v.company_id AS company_id
    FROM alerts a
    JOIN vehicles v ON v.id = a.vehicle_id
    WHERE a.type = 'SPEEDING'
      AND a.ended_at IS NULL
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
        driver_id,
        type,
        severity,
        message,
        details,
        created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_TYPED = `
    UPDATE alerts
    SET severity = ?, message = ?, details = ?
    WHERE id = ?
      AND ended_at IS NULL
`;

// A warning that follows a state is also done when the state is over: nobody
// has to click it away.
const END_OPEN_TYPE = `
    UPDATE alerts
    SET ended_at = ?,
        resolved_at = CASE WHEN type IN ${SELF_CLOSING_TYPES_SQL}
                           THEN COALESCE(resolved_at, ?) ELSE resolved_at END
    WHERE vehicle_id = ?
      AND type = ?
      AND ended_at IS NULL
`;

const END_OPEN_TYPE_FOR_VEHICLES = `
    UPDATE alerts
    SET ended_at = ?,
        resolved_at = CASE WHEN type IN ${SELF_CLOSING_TYPES_SQL}
                           THEN COALESCE(resolved_at, ?) ELSE resolved_at END
    WHERE type = ?
      AND ended_at IS NULL
      AND vehicle_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
`;

const RESOLVE = `
    UPDATE alerts
    SET resolved_at = ?
    WHERE id = ?
      AND resolved_at IS NULL
      AND type NOT IN ${SELF_CLOSING_TYPES_SQL}
      AND vehicle_id IN (
          SELECT id FROM vehicles WHERE company_id = ?
      )
`;

// Die IDs kommen als JSON-Array: ein Statement für jede Listenlänge.
const COUNT_FOR_COMPANY = `
    SELECT COUNT(*) AS found
    FROM alerts a
    INNER JOIN vehicles v ON v.id = a.vehicle_id
    WHERE a.id IN (SELECT value FROM json_each(?))
      AND v.company_id = ?
`;

const RESOLVE_MANY = `
    UPDATE alerts
    SET resolved_at = ?
    WHERE id IN (SELECT value FROM json_each(?))
      AND resolved_at IS NULL
      AND type NOT IN ${SELF_CLOSING_TYPES_SQL}
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
    driver_name: "d.name COLLATE NOCASE",
    license_plate: "v.license_plate COLLATE NOCASE",
};

type AlertSqlRow = Omit<Alert, "details"> & {
    details: string | AlertDetails | null;
    total?: number;
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
    const { total: _total, details, trip_id, ...alert } = row;
    return {
        ...alert,
        details: parseDetails(details),
        trip_id: trip_id === null || trip_id === undefined ? null : Number(trip_id),
    };
}

type SpeedingPlace = Pick<SpeedingAlertDetails, "max_speed_kmh" | "limit_kmh">;

/** Of two places, the one further over its limit; the first wins a tie. */
function worstPlace(first: SpeedingPlace, second: SpeedingPlace): SpeedingPlace {
    const pick =
        overLimitKmh(second.max_speed_kmh, second.limit_kmh) >
        overLimitKmh(first.max_speed_kmh, first.limit_kmh)
            ? second
            : first;
    return { max_speed_kmh: pick.max_speed_kmh, limit_kmh: pick.limit_kmh };
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

function currentDriverId(vehicleId: number): number | null {
    const row = stmt(
        `SELECT current_driver_id FROM vehicles WHERE id = ?`,
    ).get(vehicleId) as { current_driver_id: number | null } | undefined;

    return row?.current_driver_id ?? null;
}

type AlertScope = { sql: string; params: Array<number | string>; narrowed: boolean };
type AlertCountGroup = { type: AlertType; open: number; resolved: number; all: number };

/** Vehicle, driver and search of a list. The search finds the vehicles and drivers first. */
function alertScope(
    companyId: number,
    query: { vehicle_id?: number; driver_id?: number; search: string },
    searchDrivers: boolean,
): AlertScope {
    const parts: string[] = [];
    const params: Array<number | string> = [];

    if (query.vehicle_id !== undefined) {
        parts.push("AND a.vehicle_id = ?");
        params.push(query.vehicle_id);
    }

    if (query.driver_id !== undefined) {
        parts.push("AND a.driver_id = ?");
        params.push(query.driver_id);
    }

    if (query.search !== "") {
        const like = `%${query.search.toLowerCase().replace(/[#%_]/g, "#$&")}%`;
        const plates = "a.vehicle_id IN (SELECT id FROM vehicles WHERE company_id = ? AND lower(license_plate) LIKE ? ESCAPE '#')";

        parts.push(
            searchDrivers
                ? `AND (${plates} OR a.driver_id IN (SELECT id FROM drivers WHERE company_id = ? AND lower(name) LIKE ? ESCAPE '#'))`
                : `AND ${plates}`,
        );
        params.push(companyId, like, ...(searchDrivers ? [companyId, like] : []));
    }

    return { sql: parts.join("\n"), params, narrowed: parts.length > 0 };
}

/** Open and resolved per type: running counters, or a count where the list is narrowed. */
function countGroups(companyId: number, scope: AlertScope): AlertCountGroup[] {
    const rows = (
        scope.narrowed
            ? stmt(`
                SELECT a.type, SUM(a.resolved_at IS NULL) AS open_count, SUM(a.resolved_at IS NOT NULL) AS resolved_count
                FROM alerts a
                WHERE a.company_id = ? ${scope.sql}
                GROUP BY a.type
            `).all(companyId, ...scope.params)
            : stmt("SELECT type, open_count, resolved_count FROM alert_counts WHERE company_id = ?").all(companyId)
    ) as Array<{ type: AlertType; open_count: number; resolved_count: number }>;

    return rows.map((row) => ({
        type: row.type,
        open: Number(row.open_count),
        resolved: Number(row.resolved_count),
        all: Number(row.open_count) + Number(row.resolved_count),
    }));
}

export class AlertModel {
    static listForCompany(
        companyId: number,
        query: AlertListQuery,
        options: { searchDrivers?: boolean } = {},
    ): AlertListResponse {
        const scope = alertScope(companyId, query, options.searchDrivers !== false);
        const groups = countGroups(companyId, scope);
        const offset = (query.page - 1) * query.limit;
        const sortColumn = SORT_SQL[query.sort];
        const sortDirection = query.dir === "asc" ? "ASC" : "DESC";
        const nullsLast = query.sort === "driver_name" ? "d.name IS NULL, " : "";
        const typeSql = query.type !== undefined ? "AND a.type = ?" : "";
        const typeParams = query.type !== undefined ? [query.type] : [];
        // CROSS JOIN keeps the warnings first: the index gives their order,
        // so a page reads its rows and no more.
        const rows = stmt(`
            SELECT ${ALERT_COLUMNS}
            FROM alerts a
            CROSS JOIN vehicles v ON v.id = a.vehicle_id
            LEFT JOIN drivers d ON d.id = a.driver_id
            WHERE a.company_id = ?
              ${scope.sql}
              ${FILTER_SQL[query.filter]}
              ${typeSql}
            ORDER BY ${nullsLast}${sortColumn} ${sortDirection}, a.id ${sortDirection}
            LIMIT ? OFFSET ?
        `).all(companyId, ...scope.params, ...typeParams, query.limit, offset) as AlertSqlRow[];

        const inFilter = (group: AlertCountGroup) => group[query.filter];
        const total = groups
            .filter((group) => query.type === undefined || group.type === query.type)
            .reduce((sum, group) => sum + inFilter(group), 0);
        const sumOf = (pick: (group: AlertCountGroup) => number) =>
            groups.reduce((sum, group) => sum + pick(group), 0);
        const typeCount = (type: AlertType) =>
            groups.filter((group) => group.type === type).reduce((sum, group) => sum + inFilter(group), 0);
        const talk = stmt(
            "SELECT COUNT(*) AS n FROM drivers WHERE company_id = ? AND open_warnings >= ?",
        ).get(companyId, DRIVER_TALK_MIN_OPEN_WARNINGS) as { n: number };

        return {
            data: rows.map(toAlert),
            meta: {
                page: query.page,
                limit: query.limit,
                total,
                pageCount: Math.max(1, Math.ceil(total / query.limit)),
                counts: {
                    all: sumOf((group) => group.all),
                    open: sumOf((group) => group.open),
                    resolved: sumOf((group) => group.resolved),
                },
                type_counts: {
                    all: sumOf(inFilter),
                    SPEEDING: typeCount("SPEEDING"),
                    LOW_FUEL: typeCount("LOW_FUEL"),
                    OFFLINE: typeCount("OFFLINE"),
                },
                resolved_kept_days: PrivacyModel.alertDays(companyId),
                talk_drivers: options.searchDrivers === false ? 0 : Number(talk.n),
            },
        };
    }

    /**
     * Erledigt alle offenen Tempo-Warnungen eines Filters. `expected` ist die
     * Zahl, die der Mensch bestätigt hat: Hat sich die Liste seitdem geändert,
     * ändert sich nichts und zurück kommt die neue Zahl.
     */
    static resolveMatching(
        companyId: number,
        filter: AlertBulkFilter,
        expected: number,
    ): { resolved: number } | { changed: number } {
        const scope = alertScope(companyId, { ...filter, search: filter.search ?? "" }, true);
        const where = `
            WHERE a.company_id = ?
              ${scope.sql}
              AND a.type = 'SPEEDING'
              AND a.resolved_at IS NULL`;
        const params = [companyId, ...scope.params];

        return withTransaction(() => {
            const { n } = stmt(`SELECT COUNT(*) AS n FROM alerts a ${where}`).get(...params) as { n: number };

            if (Number(n) !== expected) {
                return { changed: Number(n) };
            }

            const result = stmt(`
                UPDATE alerts SET resolved_at = ?
                WHERE id IN (SELECT a.id FROM alerts a ${where})
            `).run(nowSqlite(), ...params);

            return { resolved: Number(result.changes) };
        });
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

    /**
     * Erledigt mehrere Warnungen der Firma in einer Transaktion. Fehlt eine
     * ID in dieser Firma, ändert sich nichts und das Ergebnis ist `undefined`.
     * Schon erledigte Zeilen bleiben unverändert; zurück kommt die Zahl der
     * Zeilen, die dieser Aufruf geschlossen hat.
     */
    static resolveMany(
        ids: number[],
        companyId: number,
    ): { resolved: number } | undefined {
        const idsJson = JSON.stringify(ids);

        return withTransaction(() => {
            const { found } = stmt(COUNT_FOR_COMPANY).get(
                idsJson,
                companyId,
            ) as { found: number };

            if (Number(found) !== ids.length) {
                return undefined;
            }

            const result = stmt(RESOLVE_MANY).run(
                nowSqlite(),
                idsJson,
                companyId,
            );

            return { resolved: Number(result.changes) };
        });
    }

    /**
     * „Gespräch geführt“: every open speeding warning of the driver is cleared
     * at once, with the talk as the note. Returns how many it cleared.
     */
    static resolveSpeedingForDriver(
        driverId: number,
        companyId: number,
        note: string,
    ): number {
        const result = stmt(
            `
            UPDATE alerts
            SET resolved_at = ?, resolution_note = ?
            WHERE driver_id = ?
              AND type = 'SPEEDING'
              AND resolved_at IS NULL
              AND vehicle_id IN (SELECT id FROM vehicles WHERE company_id = ?)
            `,
        ).run(nowSqlite(), note, driverId, companyId);
        return Number(result.changes);
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

        // Same trip, already warned: the new overshoot joins that warning
        // instead of making the 100th row of one drive.
        const same = stmt(SELECT_TRIP_SPEEDING).get(input.vehicleId) as
            | { id: number; details: string | null }
            | undefined;
        const before = same ? parseDetails(same.details) : null;

        if (same && isSpeedingAlertDetails(before)) {
            const total = before.duration_s;
            const merged: SpeedingAlertDetails = {
                ...worstPlace(
                    { max_speed_kmh: before.max_speed_kmh, limit_kmh: before.limit_kmh },
                    input.details,
                ),
                duration_s: total + input.details.duration_s,
                event_count: (before.event_count ?? 1) + 1,
                carried_duration_s: total,
                carried_max_kmh: before.max_speed_kmh,
                carried_limit_kmh: before.limit_kmh,
            };

            stmt(REOPEN_SPEEDING).run(
                speedingSeverity(merged.max_speed_kmh, merged.limit_kmh),
                speedingMessage(merged),
                speedingDetailsJson(merged),
                same.id,
            );

            return same.id;
        }

        const result = stmt(INSERT_SPEEDING).run(
            input.vehicleId,
            currentDriverId(input.vehicleId),
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
        // Add what earlier overshoots of this trip already counted.
        const row = stmt(SELECT_DETAILS).get(id) as
            | { details: string | null }
            | undefined;
        const current = row ? parseDetails(row.details) : null;
        const carried = isSpeedingAlertDetails(current) ? current : null;
        const merged: SpeedingAlertDetails = carried?.carried_duration_s !== undefined
            ? {
                  ...details,
                  // The running overshoot wins a tie: its place is the newer.
                  ...worstPlace(details, {
                      max_speed_kmh: carried.carried_max_kmh ?? 0,
                      limit_kmh: carried.carried_limit_kmh ?? carried.limit_kmh,
                  }),
                  duration_s: carried.carried_duration_s + details.duration_s,
                  event_count: carried.event_count,
                  carried_duration_s: carried.carried_duration_s,
                  carried_max_kmh: carried.carried_max_kmh,
                  carried_limit_kmh: carried.carried_limit_kmh,
              }
            : details;

        stmt(UPDATE_SPEEDING).run(
            carried?.carried_duration_s !== undefined
                ? speedingSeverity(merged.max_speed_kmh, merged.limit_kmh)
                : severity,
            speedingMessage(merged),
            speedingDetailsJson(merged),
            id,
        );
    }

    static listOpenSpeeding(): Array<{
        id: number;
        vehicle_id: number;
        company_id: number;
    }> {
        return stmt(SELECT_ALL_OPEN_SPEEDING).all() as Array<{
            id: number;
            vehicle_id: number;
            company_id: number;
        }>;
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
            currentDriverId(input.vehicleId),
            input.type,
            input.severity,
            input.message,
            detailsJson,
            input.createdAt,
        );

        return { id: Number(result.lastInsertRowid), opened: true };
    }

    /** Wie `endOpenType` für viele Fahrzeuge in einer Anweisung (ein Tick). */
    static endOpenTypeForVehicles(
        vehicleIds: number[],
        type: AlertType,
        endedAt: string,
    ): number {
        if (vehicleIds.length === 0) {
            return 0;
        }

        const result = stmt(END_OPEN_TYPE_FOR_VEHICLES).run(
            endedAt,
            endedAt,
            type,
            JSON.stringify(vehicleIds),
        );
        return Number(result.changes);
    }

    static endOpenType(
        vehicleId: number,
        type: AlertType,
        endedAt: string,
    ): boolean {
        const result = stmt(END_OPEN_TYPE).run(endedAt, endedAt, vehicleId, type);
        return result.changes > 0;
    }
}
