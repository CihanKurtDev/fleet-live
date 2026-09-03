import type { DatabaseSync } from "node:sqlite";
import {
    briefingMonthKeys,
    encodePoints,
    SPEED_CRITICAL_OVER_LIMIT_KMH,
} from "@fleet-live/shared";
import { config } from "../config";
import { sqliteDaysAgo } from "../lib/sqlTime";
import { TripModel } from "../models/trip.model";
import {
    applyMaintenanceTriggers,
    dropMaintenanceTriggers,
} from "./migrate";
import { upsertDevAccounts } from "./devAccounts";

const COMPANY_MAIN = 1;
const VEHICLES_MAIN = 180;
const VEHICLES_OTHER = 4;

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
const CITIES = [
    { lat: 50.9375, lng: 6.9603 },
    { lat: 51.2277, lng: 6.7735 },
    { lat: 48.1351, lng: 11.582 },
    { lat: 52.52, lng: 13.405 },
    { lat: 53.5511, lng: 9.9937 },
];
const STATUSES = ["DRIVING", "DRIVING", "IDLE", "STOPPED", "OFFLINE"] as const;
const DRIVER_NAME_CYCLE = FIRST_NAMES.length * LAST_NAMES.length;

type Rng = () => number;

function mulberry32(seed: number): Rng {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function pickInt(rng: Rng, min: number, max: number) {
    return min + Math.floor(rng() * (max - min + 1));
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const left = copy[i];
        const right = copy[j];
        if (left === undefined || right === undefined) {
            continue;
        }
        copy[i] = right;
        copy[j] = left;
    }
    return copy;
}

function take<T>(items: T[], count: number): T[] {
    return items.slice(0, Math.max(0, Math.min(count, items.length)));
}

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

function plateAt(index: number) {
    const prefix = PREFIXES[index % PREFIXES.length];
    const a = String.fromCharCode(65 + (index % 26));
    const b = String.fromCharCode(65 + ((index * 3) % 26));
    return `${prefix}-${a}${b} ${String(index).padStart(4, "0")}`;
}

function stampInMonth(month: string, rng: Rng, dayMax = 27) {
    const day = String(pickInt(rng, 1, dayMax)).padStart(2, "0");
    const hour = String(pickInt(rng, 5, 21)).padStart(2, "0");
    const minute = String(pickInt(rng, 0, 59)).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}:00`;
}

function laterStamp(created: string, rng: Rng) {
    const base = Date.parse(`${created.replace(" ", "T")}Z`);
    const ended = new Date(base + pickInt(rng, 20, 1800) * 1000);
    return ended.toISOString().slice(0, 19).replace("T", " ");
}

/** Mix: oft 1 Fahrzeug, regelmäßig 2–3, selten 4. */
function fleetSizes(rng: Rng, vehicleCount: number): number[] {
    const sizes: number[] = [];
    let left = vehicleCount;

    while (left > 0) {
        const roll = rng();
        let size = 1;
        if (roll > 0.42 && roll <= 0.68) {
            size = 2;
        } else if (roll > 0.68 && roll <= 0.9) {
            size = 3;
        } else if (roll > 0.9) {
            size = 4;
        }
        size = Math.min(size, left);
        sizes.push(size);
        left -= size;
    }

    return sizes;
}

type SeededVehicle = {
    id: number;
    companyId: number;
    driverId: number;
    status: (typeof STATUSES)[number];
    fuel: number;
    lat: number;
    lng: number;
};

export function seedLivedIn(database: DatabaseSync) {
    const rng = mulberry32(20260902);
    const months = briefingMonthKeys();
    const retentionStart =
        config.tripRetentionDays > 0
            ? sqliteDaysAgo(config.tripRetentionDays)
            : "1970-01-01 00:00:00";

    const insertDriver = database.prepare(`
        INSERT INTO drivers (company_id, name)
        VALUES (?, ?)
    `);
    const insertVehicle = database.prepare(`
        INSERT INTO vehicles (
            license_plate, driver_name, current_driver_id, fuel_level, status, company_id
        )
        VALUES (?, NULL, NULL, ?, ?, ?)
    `);
    const insertAssignment = database.prepare(`
        INSERT INTO driver_vehicles (driver_id, vehicle_id)
        VALUES (?, ?)
    `);
    const setCurrent = database.prepare(`
        UPDATE vehicles
        SET current_driver_id = ?, driver_name = ?
        WHERE id = ?
    `);
    const insertTelemetry = database.prepare(`
        INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
        VALUES (?, ?, ?, ?)
    `);
    const insertAlert = database.prepare(`
        INSERT INTO alerts (
            vehicle_id, driver_id, type, severity, message, details,
            created_at, ended_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTrip = database.prepare(`
        INSERT INTO trips (
            vehicle_id, started_at, ended_at, path, point_count,
            distance_m, max_speed, last_latitude, last_longitude
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateLast = database.prepare(
        "UPDATE vehicles SET last_telemetry_id = ? WHERE id = ?",
    );
    const demoteStatus = database.prepare(
        "UPDATE vehicles SET status = 'IDLE' WHERE id = ?",
    );
    const zeroLastSpeed = database.prepare(`
        UPDATE telemetry
        SET speed = 0
        WHERE id = (SELECT last_telemetry_id FROM vehicles WHERE id = ?)
    `);
    const updateAlerts = database.prepare(`
        UPDATE vehicles
        SET active_alerts = (
            SELECT COUNT(*) FROM alerts a
            WHERE a.vehicle_id = vehicles.id AND a.resolved_at IS NULL
        )
    `);

    dropMaintenanceTriggers(database);
    database.exec("BEGIN");

    try {
        upsertDevAccounts(database);
        database.exec("DELETE FROM trips");
        database.exec("DELETE FROM trip_month_km");
        database.exec("DELETE FROM driver_vehicles");
        database.exec("DELETE FROM alerts");
        database.exec("DELETE FROM telemetry");
        database.exec("DELETE FROM vehicles");
        database.exec("DELETE FROM drivers");
        database.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('vehicles', 'telemetry', 'alerts', 'trips', 'drivers')",
        );

        const vehicles: SeededVehicle[] = [];
        let plateIndex = 0;
        let driverIndex = 0;

        const addCompany = (companyId: number, vehicleCount: number) => {
            const sizes = fleetSizes(rng, vehicleCount);

            for (const size of sizes) {
                const name = driverNameAt(driverIndex);
                driverIndex += 1;
                const driver = insertDriver.run(companyId, name);
                const driverId = Number(driver.lastInsertRowid);

                const owned: SeededVehicle[] = [];

                for (let n = 0; n < size; n += 1) {
                    const status =
                        STATUSES[pickInt(rng, 0, STATUSES.length - 1)] ?? "IDLE";
                    const fuel =
                        rng() < 0.08 ? pickInt(rng, 3, 14) : pickInt(rng, 22, 98);
                    const city = CITIES[plateIndex % CITIES.length] ?? CITIES[0]!;
                    const lat =
                        city.lat + ((((plateIndex * 17) % 401) - 200) * 0.00045);
                    const lng =
                        city.lng + ((((plateIndex * 29) % 401) - 200) * 0.0006);
                    const result = insertVehicle.run(
                        plateAt(plateIndex),
                        fuel,
                        status,
                        companyId,
                    );
                    plateIndex += 1;
                    const row: SeededVehicle = {
                        id: Number(result.lastInsertRowid),
                        companyId,
                        driverId,
                        status,
                        fuel,
                        lat,
                        lng,
                    };
                    owned.push(row);
                    vehicles.push(row);
                    insertAssignment.run(driverId, row.id);

                    if (status !== "OFFLINE") {
                        const telemetry = insertTelemetry.run(
                            row.id,
                            lat,
                            lng,
                            status === "DRIVING" ? pickInt(rng, 28, 118) : 0,
                        );
                        updateLast.run(Number(telemetry.lastInsertRowid), row.id);
                    }
                }

                const current =
                    owned.find((row) => row.status === "DRIVING") ?? owned[0];
                if (current) {
                    setCurrent.run(driverId, name, current.id);

                    for (const row of owned) {
                        if (row.id === current.id || row.status !== "DRIVING") {
                            continue;
                        }

                        demoteStatus.run(row.id);
                        zeroLastSpeed.run(row.id);
                        row.status = "IDLE";
                    }
                }
            }
        };

        addCompany(COMPANY_MAIN, VEHICLES_MAIN);
        addCompany(2, VEHICLES_OTHER);
        addCompany(3, VEHICLES_OTHER);

        const mainVehicles = vehicles.filter((row) => row.companyId === COMPANY_MAIN);
        const mainByDriver = new Map<number, SeededVehicle[]>();
        for (const row of mainVehicles) {
            const owned = mainByDriver.get(row.driverId) ?? [];
            owned.push(row);
            mainByDriver.set(row.driverId, owned);
        }

        const mainDriverIds = [...mainByDriver.keys()];
        const lastMonth = months[months.length - 1] ?? "2026-09";

        const vehicleForDriver = (driverId: number, salt: number) => {
            const owned = mainByDriver.get(driverId);
            if (!owned || owned.length === 0) {
                return undefined;
            }
            return owned[salt % owned.length] ?? owned[0];
        };

        const insertSpeeding = (
            vehicleId: number,
            created: string,
            high: boolean,
            open: boolean,
        ) => {
            const limit = rng() < 0.45 ? 50 : 120;
            const over = high
                ? SPEED_CRITICAL_OVER_LIMIT_KMH + pickInt(rng, 2, 18)
                : pickInt(rng, 4, SPEED_CRITICAL_OVER_LIMIT_KMH - 1);
            const maxSpeed = limit + over;
            const duration = pickInt(rng, 9, 42);
            const ended = open ? null : laterStamp(created, rng);
            const resolved = open || rng() < 0.12 ? null : laterStamp(ended ?? created, rng);
            insertAlert.run(
                vehicleId,
                vehicles.find((row) => row.id === vehicleId)?.driverId ?? null,
                "SPEEDING",
                high ? "HIGH" : "MEDIUM",
                "Geschwindigkeit über Streckenlimit.",
                JSON.stringify({
                    limit_kmh: limit,
                    max_speed_kmh: maxSpeed,
                    duration_s: duration,
                }),
                created,
                ended,
                resolved,
            );
        };

        const insertTyped = (
            vehicleId: number,
            type: "LOW_FUEL" | "OFFLINE",
            created: string,
            open: boolean,
            fuel?: number,
        ) => {
            const ended = open ? null : laterStamp(created, rng);
            const resolved = open || rng() < 0.2 ? null : laterStamp(ended ?? created, rng);
            const details =
                type === "LOW_FUEL"
                    ? JSON.stringify({ fuel_level: fuel ?? pickInt(rng, 3, 14) })
                    : null;
            insertAlert.run(
                vehicleId,
                vehicles.find((row) => row.id === vehicleId)?.driverId ?? null,
                type,
                type === "OFFLINE" ? "HIGH" : fuel !== undefined && fuel < 5 ? "HIGH" : "MEDIUM",
                type === "OFFLINE"
                    ? "Fahrzeug sendet kein Signal."
                    : "Tankstand ist niedrig.",
                details,
                created,
                ended,
                resolved,
            );
        };

        for (const [index, month] of months.entries()) {
            const isAug = month.endsWith("-08");
            const isSep = month === lastMonth;
            const driverShare = isAug ? 0.32 : isSep ? 0.12 : 0.08 + index * 0.004;
            const eventsEach = isSep ? 3 : 1;
            const highShare = isAug ? 0.1 : isSep ? 0.72 : 0.18;
            const picked = take(
                shuffle(rng, mainDriverIds),
                Math.max(2, Math.round(mainDriverIds.length * driverShare)),
            );

            for (const [driverOffset, driverId] of picked.entries()) {
                for (let event = 0; event < eventsEach; event += 1) {
                    const vehicle = vehicleForDriver(driverId, driverOffset + event);
                    if (!vehicle) {
                        continue;
                    }
                    insertSpeeding(
                        vehicle.id,
                        stampInMonth(month, rng),
                        rng() < highShare,
                        false,
                    );
                }
            }

            const fuelShare = 0.06 + (index % 3) * 0.008;
            const offlineShare = 0.045 + (index % 4) * 0.006;
            const fuelVehicles = take(
                shuffle(rng, mainVehicles),
                Math.max(2, Math.round(mainVehicles.length * fuelShare)),
            );
            const offlineVehicles = take(
                shuffle(rng, mainVehicles),
                Math.max(2, Math.round(mainVehicles.length * offlineShare)),
            );

            for (const vehicle of fuelVehicles) {
                insertTyped(
                    vehicle.id,
                    "LOW_FUEL",
                    stampInMonth(month, rng),
                    false,
                    pickInt(rng, 3, 14),
                );
            }
            for (const vehicle of offlineVehicles) {
                insertTyped(vehicle.id, "OFFLINE", stampInMonth(month, rng), false);
            }
        }

        const openSpeeding = take(
            shuffle(rng, mainVehicles.filter((row) => row.status === "DRIVING")),
            10,
        );
        for (const vehicle of openSpeeding) {
            insertSpeeding(vehicle.id, stampInMonth(lastMonth, rng, 2), rng() < 0.4, true);
        }

        const openFuel = mainVehicles.filter((row) => row.fuel < 15).slice(0, 12);
        for (const vehicle of openFuel) {
            insertTyped(
                vehicle.id,
                "LOW_FUEL",
                stampInMonth(lastMonth, rng, 2),
                true,
                vehicle.fuel,
            );
        }

        const openOffline = mainVehicles.filter((row) => row.status === "OFFLINE");
        for (const vehicle of take(openOffline, Math.min(18, openOffline.length))) {
            insertTyped(vehicle.id, "OFFLINE", stampInMonth(lastMonth, rng, 2), true);
        }

        for (const vehicle of mainVehicles) {
            if (vehicle.status === "OFFLINE") {
                continue;
            }

            for (const month of months) {
                const keepTripRow = `${month}-01 00:00:00` >= retentionStart;
                const trips =
                    vehicle.status === "DRIVING"
                        ? pickInt(rng, 2, 4)
                        : pickInt(rng, 0, 2);

                for (let t = 0; t < trips; t += 1) {
                    const started = stampInMonth(month, rng);
                    const ended = laterStamp(started, rng);
                    const distance = pickInt(rng, 40_000, 280_000);
                    TripModel.addClosedDistance(
                        COMPANY_MAIN,
                        started,
                        distance,
                    );

                    if (!keepTripRow) {
                        continue;
                    }

                    const endLat = vehicle.lat + 0.04 + t * 0.01;
                    const endLng = vehicle.lng + 0.03 + t * 0.01;
                    const path = encodePoints([
                        { lat: vehicle.lat, lng: vehicle.lng },
                        { lat: endLat, lng: endLng },
                    ]);
                    insertTrip.run(
                        vehicle.id,
                        started,
                        ended,
                        path,
                        2,
                        distance,
                        pickInt(rng, 72, 128),
                        endLat,
                        endLng,
                    );
                }
            }
        }

        updateAlerts.run();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    applyMaintenanceTriggers(database);
    database.exec("ANALYZE");
    database.exec("VACUUM");

    const mix = database
        .prepare(
            `
            SELECT vehicle_count, COUNT(*) AS drivers
            FROM (
                SELECT COUNT(*) AS vehicle_count
            FROM driver_vehicles dv
            INNER JOIN vehicles v ON v.id = dv.vehicle_id
            WHERE v.company_id = ?
            GROUP BY dv.driver_id
            )
            GROUP BY vehicle_count
            ORDER BY vehicle_count
            `,
        )
        .all(COMPANY_MAIN) as Array<{ vehicle_count: number; drivers: number }>;

    const mixLabel = mix
        .map((row) => `${row.drivers} Fahrer mit ${row.vehicle_count} Fahrzeug(en)`)
        .join(", ");

    return {
        vehicles: VEHICLES_MAIN + VEHICLES_OTHER * 2,
        mixLabel,
    };
}
