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

    it("leaves no vehicle on a trip without a driver when it takes a second vehicle from a driver", () => {
        const database = oldVehiclesDb();

        // Ada fährt zwei Fahrzeuge zugleich (alter Bestand), ein drittes hat nie einen Fahrer.
        database.exec(`
            INSERT INTO vehicles (id, company_id, driver_id, license_plate, driver_name, status)
            VALUES (2, 1, 1, 'K-AB 2', 'Ada', 'DRIVING'),
                   (3, 1, NULL, 'K-AB 3', NULL, 'DRIVING'),
                   (4, 1, NULL, 'K-AB 4', NULL, 'IDLE');
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
            VALUES (2, 50.9, 6.9, 70), (3, 50.9, 6.9, 90);
            INSERT INTO trips (vehicle_id) VALUES (1), (2), (3);
            INSERT INTO alerts (vehicle_id, type, severity, message)
            VALUES (2, 'SPEEDING', 'HIGH', 'zu schnell'),
                   (1, 'SPEEDING', 'HIGH', 'zu schnell');
        `);

        migrate(database);

        const vehicle = (id: number) =>
            database
                .prepare(
                    `SELECT v.status, v.current_driver_id,
                            (SELECT COUNT(*) FROM trips t WHERE t.vehicle_id = v.id AND t.ended_at IS NULL) AS open_trips,
                            (SELECT speed FROM telemetry t WHERE t.id = v.last_telemetry_id) AS speed,
                            (SELECT COUNT(*) FROM alerts a WHERE a.vehicle_id = v.id AND a.type = 'SPEEDING' AND a.ended_at IS NULL) AS open_speeding
                     FROM vehicles v WHERE v.id = ?`,
                )
                .get(id) as {
                status: string;
                current_driver_id: number | null;
                open_trips: number;
                speed: number | null;
                open_speeding: number;
            };

        // Das erste bleibt Adas aktuelles Fahrzeug und fährt weiter.
        assert.equal(vehicle(1).status, "DRIVING");
        assert.equal(vehicle(1).current_driver_id, 1);
        assert.equal(vehicle(1).open_trips, 1);
        assert.equal(vehicle(1).speed, 40);
        assert.equal(vehicle(1).open_speeding, 1);

        // Wer den Fahrer verliert oder nie einen hatte, steht danach still.
        for (const id of [2, 3]) {
            assert.equal(vehicle(id).status, "IDLE", `vehicle ${id}`);
            assert.equal(vehicle(id).open_trips, 0, `vehicle ${id}`);
            assert.equal(vehicle(id).speed, 0, `vehicle ${id}`);
            assert.equal(vehicle(id).open_speeding, 0, `vehicle ${id}`);
        }

        assert.equal(vehicle(4).status, "IDLE");

        const left = database
            .prepare(
                `SELECT COUNT(*) AS n FROM vehicles
                 WHERE status = 'DRIVING' AND current_driver_id IS NULL`,
            )
            .get() as { n: number };
        assert.equal(left.n, 0);

        // Ein zweiter Lauf (jeder Start) ändert nichts mehr.
        migrate(database);
        assert.equal(vehicle(1).status, "DRIVING");
        assert.equal(vehicle(2).status, "IDLE");
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
