import { db } from "./database";
import { seedLivedIn } from "./seedLivedIn";
import {
    applyMaintenanceTriggers,
    dropMaintenanceTriggers,
} from "./migrate";
import { upsertDevAccounts } from "./devAccounts";

const largeMode = process.argv.includes("--large");

const insertDriver = db.prepare(`
    INSERT INTO drivers (company_id, name)
    VALUES (?, ?)
    ON CONFLICT(company_id, name) DO NOTHING
`);

const selectDriverId = db.prepare(`
    SELECT id FROM drivers WHERE company_id = ? AND name = ?
`);

const insertTelemetry = db.prepare(`
    INSERT INTO telemetry (
        vehicle_id,
        latitude,
        longitude,
        speed
    )
    VALUES (?, ?, ?, ?)
`);

const insertAlert = db.prepare(`
    INSERT INTO alerts (
        type,
        severity,
        message,
        vehicle_id
    )
    VALUES (?, ?, ?, ?)
`);

const CITIES = [
    { lat: 50.9375, lng: 6.9603 },
    { lat: 51.2277, lng: 6.7735 },
    { lat: 48.1351, lng: 11.582 },
    { lat: 52.52, lng: 13.405 },
    { lat: 53.5511, lng: 9.9937 },
];

const PREFIXES = ["K", "D", "M", "B", "HH", "S", "F", "HB"];
const FIRST_NAMES = [
    "Max",
    "Anna",
    "Tim",
    "Lisa",
    "Jonas",
    "Clara",
    "Peter",
    "Nina",
    "Lukas",
    "Sarah",
    "Tobias",
    "Laura",
    "Sven",
    "Melanie",
    "Felix",
    "Lea",
    "David",
    "Marie",
    "Paul",
    "Sophie",
    "Jan",
    "Emma",
    "Ben",
    "Mia",
    "Finn",
];
const LAST_NAMES = [
    "Müller",
    "Schmidt",
    "Schneider",
    "Fischer",
    "Weber",
    "Meyer",
    "Wagner",
    "Becker",
    "Hoffmann",
    "Schäfer",
    "Bauer",
    "Koch",
    "Richter",
    "Klein",
    "Wolf",
    "Schröder",
    "Neumann",
    "Schwarz",
    "Zimmermann",
    "Krüger",
    "Hartmann",
    "Lange",
    "Werner",
    "Krause",
];
const STATUSES = ["DRIVING", "DRIVING", "IDLE", "STOPPED", "OFFLINE"] as const;
const DRIVER_NAME_CYCLE = FIRST_NAMES.length * LAST_NAMES.length;

/** Large-Seed: Demo-Login (Firma 1) sieht die Last; 2/3 nur Isolation. */
function largeCompanyIdAt(index: number) {
    if (index % 100 === 0) {
        return 2;
    }

    if (index % 100 === 1) {
        return 3;
    }

    return 1;
}

/** Cartesian first×last — same `%` on both lists only yields `min(len)` unique names. */
function driverNameAt(index: number) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last =
        LAST_NAMES[
            Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length
        ];
    const generation = Math.floor(index / DRIVER_NAME_CYCLE);

    return generation === 0
        ? `${first} ${last}`
        : `${first} ${last} ${generation + 1}`;
}

function randomInt(min: number, max: number) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function demoAlert(status: string, fuel: number) {
    if (status === "OFFLINE") {
        return {
            type: "OFFLINE",
            severity: "HIGH",
            message: "Fahrzeug sendet kein Signal.",
        };
    }

    if (fuel < 20) {
        return {
            type: "LOW_FUEL",
            severity: "MEDIUM",
            message: "Tankstand ist niedrig.",
        };
    }

    return null;
}

function upsertDriverId(companyId: number, name: string): number {
    insertDriver.run(companyId, name);
    const row = selectDriverId.get(companyId, name) as
        | { id: number }
        | undefined;

    if (!row) {
        throw new Error(`Driver upsert did not return an id for ${name}.`);
    }

    return row.id;
}

function seedLarge() {
    const vehicleCount = 50_000;
    const telemetryPerVehicle = 10;
    const lastTelemetryId = new Map<number, number>();
    const insertVehicleStrict = db.prepare(`
        INSERT INTO vehicles (
            license_plate,
            driver_name,
            current_driver_id,
            fuel_level,
            status,
            company_id
        )
        VALUES (?, NULL, NULL, ?, ?, ?)
    `);
    const insertAssignment = db.prepare(`
        INSERT INTO driver_vehicles (driver_id, vehicle_id)
        VALUES (?, ?)
    `);
    const setCurrent = db.prepare(`
        UPDATE vehicles
        SET current_driver_id = ?, driver_name = ?
        WHERE id = ?
    `);
    const driverIds = new Map<string, number>();

    dropMaintenanceTriggers(db);

    db.exec("BEGIN");
    try {
        upsertDevAccounts(db);

        // Vorherige Teilläufe (FK-Fehler nach COMMIT alle 1000 Zeilen)
        // würden sonst verwaiste lastInsertRowid=0 und doppelte Kennzeichen erzeugen.
        db.exec("DELETE FROM driver_vehicles");
        db.exec("DELETE FROM vehicles");
        db.exec("DELETE FROM drivers");
        db.exec("DELETE FROM trip_month_km");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts', 'drivers')",
        );

        for (let i = 0; i < vehicleCount; i += 1) {
            const prefix = PREFIXES[i % PREFIXES.length];
            const plate = `${prefix}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))} ${String(i).padStart(5, "0")}`;
            const driver = driverNameAt(i);
            const fuel = randomInt(3, 100);
            const status = STATUSES[randomInt(0, STATUSES.length - 1)];
            const companyId = largeCompanyIdAt(i);
            const cacheKey = `${companyId}\0${driver}`;
            let driverId = driverIds.get(cacheKey);

            if (driverId === undefined) {
                driverId = upsertDriverId(companyId, driver);
                driverIds.set(cacheKey, driverId);
            }

            const result = insertVehicleStrict.run(
                plate,
                fuel,
                status,
                companyId,
            );
            const vehicleId = Number(result.lastInsertRowid);

            if (!Number.isInteger(vehicleId) || vehicleId < 1) {
                throw new Error(`Invalid vehicle id after insert for ${plate}.`);
            }

            insertAssignment.run(driverId, vehicleId);
            setCurrent.run(driverId, driver, vehicleId);

            if (status !== "OFFLINE") {
                const city = CITIES[i % CITIES.length];
                // Spread around the city so zoom-in can drop under FLEET_POSITIONS_MAX.
                const originLat =
                    city.lat + ((((i * 17) % 401) - 200) * 0.00045);
                const originLng =
                    city.lng + ((((i * 29) % 401) - 200) * 0.0006);

                for (let t = 0; t < telemetryPerVehicle; t += 1) {
                    const telemetry = insertTelemetry.run(
                        vehicleId,
                        originLat + t * 0.00008,
                        originLng + t * 0.00008,
                        status === "DRIVING" ? randomInt(30, 120) : 0,
                    );
                    lastTelemetryId.set(
                        vehicleId,
                        Number(telemetry.lastInsertRowid),
                    );
                }
            }

            if (i % 10 === 0) {
                const alert = demoAlert(status, fuel);
                if (alert) {
                    insertAlert.run(
                        alert.type,
                        alert.severity,
                        alert.message,
                        vehicleId,
                    );
                }
            }
        }

        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    const updateLast = db.prepare(
        "UPDATE vehicles SET last_telemetry_id = ? WHERE id = ?",
    );
    const updateAlerts = db.prepare(`
        UPDATE vehicles
        SET active_alerts = (
            SELECT COUNT(*) FROM alerts a
            WHERE a.vehicle_id = vehicles.id AND a.resolved_at IS NULL
        )
    `);

    db.exec("BEGIN");
    try {
        for (const [vehicleId, telemetryId] of lastTelemetryId) {
            updateLast.run(telemetryId, vehicleId);
        }
        updateAlerts.run();
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    applyMaintenanceTriggers(db);
    db.exec("ANALYZE");
}

try {
    if (largeMode) {
        seedLarge();
        console.log(
            "Database seeded with ~50k vehicles and ~500k telemetry rows.",
        );
    } else {
        const summary = seedLivedIn(db);
        console.log(
            `Database seeded: ${summary.vehicles} Fahrzeuge. Firma 1: ${summary.mixLabel}.`,
        );
    }
} catch (error) {
    try {
        db.exec("ROLLBACK");
    } catch {
        // already rolled back inside seedLarge
    }
    throw error;
}
