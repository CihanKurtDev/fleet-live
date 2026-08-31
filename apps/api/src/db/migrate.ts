import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 3;

type TableColumn = {
    name: string;
};

const INDEXES_AND_TRIGGERS = `
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_id
    ON telemetry(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at
    ON telemetry(recorded_at);

CREATE INDEX IF NOT EXISTS idx_alerts_vehicle_id
    ON alerts(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_status
    ON vehicles(status);

CREATE INDEX IF NOT EXISTS idx_vehicles_fuel
    ON vehicles(fuel_level);

CREATE INDEX IF NOT EXISTS idx_vehicles_plate
    ON vehicles(license_plate);

CREATE INDEX IF NOT EXISTS idx_vehicles_company
    ON vehicles(company_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_recorded
    ON telemetry(vehicle_id, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_open
    ON alerts(vehicle_id)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_search
    ON vehicles(search_text);

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started
    ON trips(vehicle_id, started_at DESC, id DESC);

-- Ein Fahrzeug kann nur auf einer Fahrt sein. Die Invariante gehört in die
-- Datenbank, nicht in die Reihenfolge der Controller-Aufrufe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_open
    ON trips(vehicle_id)
    WHERE ended_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_telemetry_after_insert
AFTER INSERT ON telemetry
BEGIN
    UPDATE vehicles
    SET last_telemetry_id = NEW.id
    WHERE id = NEW.vehicle_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_after_insert
AFTER INSERT ON alerts
WHEN NEW.resolved_at IS NULL
BEGIN
    UPDATE vehicles
    SET active_alerts = active_alerts + 1
    WHERE id = NEW.vehicle_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_after_update
AFTER UPDATE OF resolved_at ON alerts
BEGIN
    UPDATE vehicles
    SET active_alerts = active_alerts
        + CASE
            WHEN OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL THEN -1
            WHEN OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS NULL THEN 1
            ELSE 0
        END
    WHERE id = NEW.vehicle_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_after_delete
AFTER DELETE ON alerts
WHEN OLD.resolved_at IS NULL
BEGIN
    UPDATE vehicles
    SET active_alerts = MAX(0, active_alerts - 1)
    WHERE id = OLD.vehicle_id;
END;
`;

export function dropMaintenanceTriggers(database: DatabaseSync) {
    database.exec(`
        DROP TRIGGER IF EXISTS trg_telemetry_after_insert;
        DROP TRIGGER IF EXISTS trg_alerts_after_insert;
        DROP TRIGGER IF EXISTS trg_alerts_after_update;
        DROP TRIGGER IF EXISTS trg_alerts_after_delete;
    `);
}

export function applyMaintenanceTriggers(database: DatabaseSync) {
    database.exec(INDEXES_AND_TRIGGERS);
}

function columnNames(database: DatabaseSync, table: string): Set<string> {
    // table_xinfo includes generated columns; table_info hides them.
    const columns = database
        .prepare(`PRAGMA table_xinfo(${table})`)
        .all() as TableColumn[];

    return new Set(columns.map((column) => column.name));
}

function migrateToV1(database: DatabaseSync) {
    const names = columnNames(database, "vehicles");

    if (!names.has("last_telemetry_id")) {
        database.exec(
            "ALTER TABLE vehicles ADD COLUMN last_telemetry_id INTEGER",
        );
    }

    if (!names.has("active_alerts")) {
        database.exec(
            "ALTER TABLE vehicles ADD COLUMN active_alerts INTEGER NOT NULL DEFAULT 0",
        );
    }

    if (!names.has("search_text")) {
        database.exec(`
            ALTER TABLE vehicles
            ADD COLUMN search_text TEXT
            GENERATED ALWAYS AS (lower(license_plate || ' ' || driver_name)) VIRTUAL
        `);
    }

    applyMaintenanceTriggers(database);

    database.exec(`
        UPDATE vehicles
        SET last_telemetry_id = (
            SELECT t.id
            FROM telemetry t
            WHERE t.vehicle_id = vehicles.id
            ORDER BY t.recorded_at DESC, t.id DESC
            LIMIT 1
        )
        WHERE last_telemetry_id IS NULL;

        UPDATE vehicles
        SET active_alerts = (
            SELECT COUNT(*)
            FROM alerts a
            WHERE a.vehicle_id = vehicles.id
              AND a.resolved_at IS NULL
        );
    `);
}

/**
 * `trips` legt schema.sql selbst an (CREATE TABLE IF NOT EXISTS läuft bei
 * jedem Start). Fehlen hier nur die Indizes für bestehende Datenbanken.
 */
function migrateToV2(database: DatabaseSync) {
    applyMaintenanceTriggers(database);
}

/**
 * Mandant am Fahrzeug. Bestehende DBs bekommen drei Seed-Firmen und
 * `company_id` (Default 1). Neue DBs legen die Tabelle über schema.sql an;
 * die Firmenzeilen braucht auch der API-Create, solange es kein Login gibt.
 */
function migrateToV3(database: DatabaseSync) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO companies (id, name) VALUES
            (1, 'Rheinland Logistik'),
            (2, 'Alpen Spedition'),
            (3, 'Nordost Transport');
    `);

    const names = columnNames(database, "vehicles");

    if (!names.has("company_id")) {
        database.exec(`
            ALTER TABLE vehicles
            ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1
            REFERENCES companies(id)
        `);
    }

    applyMaintenanceTriggers(database);
}

export function migrate(database: DatabaseSync) {
    const row = database.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
    const currentVersion = row?.user_version ?? 0;

    if (currentVersion < 1) {
        migrateToV1(database);
    }

    if (currentVersion < 2) {
        migrateToV2(database);
    }

    if (currentVersion < 3) {
        migrateToV3(database);
    }

    if (currentVersion < SCHEMA_VERSION) {
        database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    database.exec("ANALYZE");
}
