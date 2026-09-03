import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { migrate } from "../db/migrate";

const schemaSql = readFileSync(join(__dirname, "../db/schema.sql"), "utf8");

const supportTables = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'dispatcher'
    );
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        path TEXT NOT NULL DEFAULT '',
        point_count INTEGER NOT NULL DEFAULT 0,
        distance_m REAL NOT NULL DEFAULT 0,
        max_speed REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        resolved_at TEXT
    );
`;

function oldVehiclesDb(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO companies (id, name) VALUES (1, 'Test');

        CREATE TABLE drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (company_id, name)
        );
        INSERT INTO drivers (id, company_id, name) VALUES (1, 1, 'Ada');

        CREATE TABLE vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            driver_id INTEGER,
            license_plate TEXT NOT NULL,
            driver_name TEXT,
            fuel_level REAL NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT 'IDLE',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_telemetry_id INTEGER,
            active_alerts INTEGER NOT NULL DEFAULT 0,
            speed_limit_kmh REAL,
            search_text TEXT GENERATED ALWAYS AS (
                lower(license_plate || ' ' || coalesce(driver_name, ''))
            ) VIRTUAL
        );
        INSERT INTO vehicles (
            id, company_id, driver_id, license_plate, driver_name, status
        ) VALUES (1, 1, 1, 'K-AB 1', 'Ada', 'DRIVING');

        CREATE TABLE telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed REAL NOT NULL,
            recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TRIGGER trg_telemetry_after_insert
        AFTER INSERT ON telemetry
        BEGIN
            UPDATE vehicles
            SET last_telemetry_id = NEW.id
            WHERE id = NEW.vehicle_id;
        END;

        INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
        VALUES (1, 50.9, 6.9, 40);

        ${supportTables}

        PRAGMA user_version = 13;
    `);
    return database;
}

describe("assignment schema migrate", () => {
    it("applies schema.sql to a v13 vehicles table without current_driver_id", () => {
        const database = oldVehiclesDb();
        database.exec(schemaSql);
        migrate(database);

        const names = database
            .prepare("PRAGMA table_xinfo(vehicles)")
            .all() as Array<{ name: string }>;
        assert.ok(names.some((column) => column.name === "current_driver_id"));
        assert.equal(
            (
                database
                    .prepare("SELECT COUNT(*) AS n FROM vehicles")
                    .get() as { n: number }
            ).n,
            1,
        );
        database.close();
    });

    it("rebuilds vehicles while a telemetry trigger still points at the table", () => {
        const database = oldVehiclesDb();
        migrate(database);

        const row = database
            .prepare(
                "SELECT current_driver_id, driver_name FROM vehicles WHERE id = 1",
            )
            .get() as { current_driver_id: number; driver_name: string };
        assert.equal(row.current_driver_id, 1);
        assert.equal(row.driver_name, "Ada");
        database.close();
    });

    it("renames a leftover vehicles_v14 after a crashed rebuild", () => {
        const database = new DatabaseSync(":memory:");
        database.exec(`
            CREATE TABLE companies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            INSERT INTO companies (id, name) VALUES (1, 'Test');

            CREATE TABLE vehicles_v14 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                current_driver_id INTEGER,
                license_plate TEXT NOT NULL,
                driver_name TEXT,
                fuel_level REAL NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT 'IDLE',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_telemetry_id INTEGER,
                active_alerts INTEGER NOT NULL DEFAULT 0,
                speed_limit_kmh REAL,
                search_text TEXT GENERATED ALWAYS AS (
                    lower(license_plate || ' ' || coalesce(driver_name, ''))
                ) VIRTUAL
            );
            INSERT INTO vehicles_v14 (id, company_id, license_plate)
            VALUES (1, 1, 'K-AB 1');

            CREATE TABLE telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                speed REAL NOT NULL,
                recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TRIGGER trg_telemetry_after_insert
            AFTER INSERT ON telemetry
            BEGIN
                UPDATE vehicles
                SET last_telemetry_id = NEW.id
                WHERE id = NEW.vehicle_id;
            END;

            ${supportTables}

            PRAGMA user_version = 13;
        `);

        migrate(database);

        const leftover = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vehicles_v14'",
            )
            .get();
        assert.equal(leftover, undefined);
        assert.equal(
            (
                database
                    .prepare("SELECT license_plate FROM vehicles WHERE id = 1")
                    .get() as { license_plate: string }
            ).license_plate,
            "K-AB 1",
        );
        database.close();
    });

    it("keeps vehicles_v14 when schema.sql recreated an empty vehicles table", () => {
        const database = new DatabaseSync(":memory:");
        database.exec(`
            CREATE TABLE companies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            INSERT INTO companies (id, name) VALUES (1, 'Test');

            CREATE TABLE vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                current_driver_id INTEGER,
                license_plate TEXT NOT NULL,
                driver_name TEXT,
                fuel_level REAL NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT 'IDLE'
            );

            CREATE TABLE vehicles_v14 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                current_driver_id INTEGER,
                license_plate TEXT NOT NULL,
                driver_name TEXT,
                fuel_level REAL NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT 'IDLE',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_telemetry_id INTEGER,
                active_alerts INTEGER NOT NULL DEFAULT 0,
                speed_limit_kmh REAL,
                search_text TEXT GENERATED ALWAYS AS (
                    lower(license_plate || ' ' || coalesce(driver_name, ''))
                ) VIRTUAL
            );
            INSERT INTO vehicles_v14 (id, company_id, license_plate)
            VALUES (1, 1, 'K-AB 1');

            CREATE TABLE telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                speed REAL NOT NULL,
                recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            ${supportTables}

            PRAGMA user_version = 13;
        `);

        migrate(database);

        assert.equal(
            (
                database
                    .prepare("SELECT COUNT(*) AS n FROM vehicles")
                    .get() as { n: number }
            ).n,
            1,
        );
        assert.equal(
            database
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vehicles_v14'",
                )
                .get(),
            undefined,
        );
        database.close();
    });
});
