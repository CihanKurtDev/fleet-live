import { db } from "./database";
import {
    applyMaintenanceTriggers,
    dropMaintenanceTriggers,
} from "./migrate";

const largeMode = process.argv.includes("--large");

const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
        name,
        email,
        password_hash
    )
    VALUES (?, ?, ?)
`);

const insertVehicle = db.prepare(`
    INSERT OR IGNORE INTO vehicles (
        license_plate,
        driver_name,
        fuel_level,
        status,
        company_id
    )
    VALUES (?, ?, ?, ?, ?)
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

const sampleVehicles: Array<{
    plate: string;
    driver: string;
    fuel: number;
    status: string;
    telemetry?: { lat: number; lng: number; speed: number };
    alerts?: number;
}> = [
    { plate: "K-AB 123", driver: "Max Mustermann", fuel: 82, status: "DRIVING", telemetry: { lat: 50.9375, lng: 6.9603, speed: 64 } },
    { plate: "K-CD 456", driver: "Erika Musterfrau", fuel: 31, status: "IDLE", telemetry: { lat: 50.9412, lng: 6.9501, speed: 0 }, alerts: 2 },
    { plate: "K-EF 789", driver: "John Doe", fuel: 7, status: "OFFLINE", alerts: 1 },
    { plate: "K-GH 234", driver: "Anna Schneider", fuel: 58, status: "DRIVING", telemetry: { lat: 50.9289, lng: 6.9712, speed: 88 } },
    { plate: "K-IJ 567", driver: "Tobias Weber", fuel: 12, status: "STOPPED", telemetry: { lat: 50.9155, lng: 6.9388, speed: 0 }, alerts: 3 },
    { plate: "D-KL 890", driver: "Sarah Krüger", fuel: 94, status: "DRIVING", telemetry: { lat: 51.2277, lng: 6.7735, speed: 52 } },
    { plate: "D-MN 112", driver: "Peter Lang", fuel: 45, status: "IDLE", telemetry: { lat: 51.2311, lng: 6.7802, speed: 0 } },
    { plate: "D-OP 345", driver: "Nina Hoffmann", fuel: 3, status: "OFFLINE", alerts: 2 },
    { plate: "M-QR 678", driver: "Lukas Bauer", fuel: 67, status: "DRIVING", telemetry: { lat: 48.1351, lng: 11.582, speed: 105 }, alerts: 1 },
    { plate: "M-ST 901", driver: "Clara Vogel", fuel: 19, status: "STOPPED", telemetry: { lat: 48.1402, lng: 11.5601, speed: 0 } },
    { plate: "M-UV 223", driver: "Jonas Richter", fuel: 76, status: "DRIVING", telemetry: { lat: 48.1489, lng: 11.5677, speed: 71 } },
    { plate: "B-WX 556", driver: "Melanie Fuchs", fuel: 88, status: "IDLE", telemetry: { lat: 52.52, lng: 13.405, speed: 0 } },
    { plate: "B-YZ 889", driver: "Sven Kaiser", fuel: 15, status: "OFFLINE", alerts: 4 },
    { plate: "B-AC 101", driver: "Laura Böhm", fuel: 51, status: "DRIVING", telemetry: { lat: 52.5065, lng: 13.3846, speed: 46 } },
];

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
const COMPANY_COUNT = 3;

function companyIdAt(index: number) {
    return (index % COMPANY_COUNT) + 1;
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

function seedSample() {
    insertUser.run("Cihan Kurt", "cihan@example.com", "development-only-password");

    for (const [index, vehicle] of sampleVehicles.entries()) {
        insertVehicle.run(
            vehicle.plate,
            vehicle.driver,
            vehicle.fuel,
            vehicle.status,
            companyIdAt(index),
        );

        const row = db
            .prepare("SELECT id FROM vehicles WHERE license_plate = ?")
            .get(vehicle.plate) as { id: number } | undefined;

        if (!row) {
            continue;
        }

        if (vehicle.telemetry) {
            insertTelemetry.run(
                row.id,
                vehicle.telemetry.lat,
                vehicle.telemetry.lng,
                vehicle.telemetry.speed,
            );
        }

        for (let i = 0; i < (vehicle.alerts ?? 0); i += 1) {
            insertAlert.run(
                "SPEEDING",
                "HIGH",
                "Vehicle exceeded the configured speed limit.",
                row.id,
            );
        }
    }
}

function seedLarge() {
    const vehicleCount = 50_000;
    const telemetryPerVehicle = 10;
    const lastTelemetryId = new Map<number, number>();
    const insertVehicleStrict = db.prepare(`
        INSERT INTO vehicles (
            license_plate,
            driver_name,
            fuel_level,
            status,
            company_id
        )
        VALUES (?, ?, ?, ?, ?)
    `);

    dropMaintenanceTriggers(db);

    db.exec("BEGIN");
    try {
        insertUser.run("Cihan Kurt", "cihan@example.com", "development-only-password");

        // Vorherige Teilläufe (FK-Fehler nach COMMIT alle 1000 Zeilen)
        // würden sonst verwaiste lastInsertRowid=0 und doppelte Kennzeichen erzeugen.
        db.exec("DELETE FROM vehicles");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts')",
        );

        for (let i = 0; i < vehicleCount; i += 1) {
            const prefix = PREFIXES[i % PREFIXES.length];
            const plate = `${prefix}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))} ${String(i).padStart(5, "0")}`;
            const driver = driverNameAt(i);
            const fuel = randomInt(3, 100);
            const status = STATUSES[randomInt(0, STATUSES.length - 1)];

            const result = insertVehicleStrict.run(
                plate,
                driver,
                fuel,
                status,
                companyIdAt(i),
            );
            const vehicleId = Number(result.lastInsertRowid);

            if (!Number.isInteger(vehicleId) || vehicleId < 1) {
                throw new Error(`Invalid vehicle id after insert for ${plate}.`);
            }

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
                insertAlert.run(
                    "SPEEDING",
                    "HIGH",
                    "Vehicle exceeded the configured speed limit.",
                    vehicleId,
                );
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
    } else {
        db.exec("BEGIN");
        seedSample();
        db.exec("COMMIT");
    }
} catch (error) {
    try {
        db.exec("ROLLBACK");
    } catch {
        // already rolled back inside seedLarge
    }
    throw error;
}

console.log(
    largeMode
        ? "Database seeded with ~50k vehicles and ~500k telemetry rows."
        : "Database seeded successfully.",
);
