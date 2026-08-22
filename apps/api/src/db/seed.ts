import { db } from "./database";

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
        status
    )
    VALUES (?, ?, ?, ?)
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
        vehicle_id,
        type,
        severity,
        message
    )
    VALUES (?, ?, ?, ?)
`);

db.exec("BEGIN");

try {
    insertUser.run(
        "Cihan Kurt",
        "cihan@example.com",
        "development-only-password"
    );

    insertVehicle.run(
        "K-AB 123",
        "Max Müller",
        82,
        "DRIVING"
    );

    insertVehicle.run(
        "K-CD 456",
        "Anna Weber",
        67,
        "DRIVING"
    );

    insertVehicle.run(
        "K-EF 789",
        "Tim Schmidt",
        91,
        "IDLE"
    );

    insertVehicle.run(
        "K-GH 321",
        "Lisa Meier",
        64,
        "ALERT"
    );

    const vehicle = db
        .prepare(`
            SELECT id
            FROM vehicles
            WHERE license_plate = ?
        `)
        .get("K-GH 321") as { id: number } | undefined;

    if (!vehicle) {
        throw new Error("Seed vehicle K-GH 321 was not found.");
    }

    insertTelemetry.run(
        vehicle.id,
        50.9375,
        6.9603,
        132
    );

    insertAlert.run(
        vehicle.id,
        "SPEEDING",
        "HIGH",
        "Vehicle exceeded the configured speed limit."
    );

    db.exec("COMMIT");
} catch (error) {
    db.exec("ROLLBACK");
    throw error;
}

console.log("Database seeded successfully.");