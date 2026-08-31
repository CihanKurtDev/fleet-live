import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { VehicleStatus } from "@fleet-live/shared";
import { decodePolyline, encodePolyline, FLEET_POSITIONS_MAX } from "@fleet-live/shared";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { simplifyPath } from "../lib/geo";
import { TelemetryModel } from "../models/telemetry.model";
import { TripModel } from "../models/trip.model";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import {
    CITY_LIMIT_KMH,
    HIGHWAY_LIMIT_KMH,
    SIM_ROUTES,
    haversineMeters,
    resetSimProgress,
    seedSimProgress,
    speedLimitKmh,
    verticesBetween,
} from "../sim/routes";
import { broadcast, closeAllSseClients } from "../sse/hub";
import { resetSimControlForTests, setCompanySimRunning } from "../lib/simControl";
import { sqliteDaysAgo, nowSqlite } from "../lib/sqlTime";
import { config } from "../config";

const TEST_PASSWORD = "secret-pass";
let api: ReturnType<typeof request.agent>;
let sessionCookie = "";

async function loginAs(companyId: number, role: "dispatcher" | "viewer" = "dispatcher") {
    const email = `${role}-${companyId}@example.com`;

    if (!UserModel.findByEmail(email)) {
        UserModel.create({
            name: `${role} ${companyId}`,
            email,
            password: TEST_PASSWORD,
            company_id: companyId,
            role,
        });
    }

    const agent = request.agent(app);
    const response = await agent.post("/api/auth/login").send({
        email,
        password: TEST_PASSWORD,
    });

    assert.equal(response.status, 200);

    const raw = response.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    assert.ok(header);

    return { agent, cookie: String(header).split(";")[0] };
}

function seedFleet(count = 3) {
    const created = [];

    for (let i = 0; i < count; i += 1) {
        const status: VehicleStatus =
            i % 5 === 0 ? "OFFLINE" : i % 3 === 0 ? "DRIVING" : "IDLE";
        const fuel = i % 4 === 0 ? 10 : 80;

        created.push(
            VehicleModel.create({
                license_plate: `K-T ${String(i).padStart(3, "0")}`,
                driver_name: `Driver ${i}`,
                fuel_level: fuel,
                status,
            }),
        );
    }

    const [first, second] = created;
    if (second) {
        db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, ?, ?, ?)
            `,
        ).run(second.id, 50.9, 6.9, 70);
    }

    if (first) {
        db.prepare(
            `
                INSERT INTO alerts (vehicle_id, type, severity, message)
                VALUES (?, 'SPEEDING', 'HIGH', 'too fast')
            `,
        ).run(first.id);
    }

    const third = created[2];
    if (third) {
        db.prepare(
            `
                INSERT INTO alerts (vehicle_id, type, severity, message)
                VALUES (?, 'SPEEDING', 'HIGH', 'too fast')
            `,
        ).run(third.id);
    }

    return created;
}

function parseSseEvents(
    text: string,
): Array<{ event: string; data: unknown }> {
    const events: Array<{ event: string; data: unknown }> = [];

    for (const block of text.split("\n\n")) {
        let eventName = "message";
        let dataLine: string | undefined;

        for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) {
                eventName = line.slice(7);
            } else if (line.startsWith("data: ")) {
                dataLine = line.slice(6);
            }
        }

        if (dataLine) {
            events.push({ event: eventName, data: JSON.parse(dataLine) });
        }
    }

    return events;
}

async function openSseStream(port: number, cookie = sessionCookie) {
    const response = await fetch(`http://127.0.0.1:${port}/api/stream`, {
        headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);

    const reader = response.body?.getReader();
    assert.ok(reader);

    const decoder = new TextDecoder();
    let buffer = "";

    const waitUntil = async (
        predicate: (text: string) => boolean,
        timeoutMs = 2000,
    ) => {
        const deadline = Date.now() + timeoutMs;

        while (!predicate(buffer)) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error(`timeout waiting for SSE, got: ${buffer}`);
            }

            const result = await Promise.race([
                reader.read(),
                new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), remaining),
                ),
            ]);

            if (result === null) {
                throw new Error(`timeout waiting for SSE, got: ${buffer}`);
            }

            if (result.done) {
                throw new Error(`stream closed, got: ${buffer}`);
            }

            buffer += decoder.decode(result.value, { stream: true });
        }

        return buffer;
    };

    return {
        reader,
        waitUntil,
        events: () => parseSseEvents(buffer),
    };
}

beforeEach(async () => {
    const session = await loginAs(1);
    api = session.agent;
    sessionCookie = session.cookie;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
    resetSimProgress();
    resetSimControlForTests();
    closeAllSseClients();
});

describe("GET /api/vehicles", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/vehicles");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("hides vehicles of other companies", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-OWN 1",
            driver_name: "Eigene",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-OTH 1",
            driver_name: "Fremde",
            company_id: 2,
        });

        const list = await api.get("/api/vehicles");
        assert.equal(list.status, 200);
        assert.equal(list.body.meta.total, 1);
        assert.equal(list.body.data[0].id, mine.id);

        const hidden = await api.get(`/api/vehicles/${other.id}`);
        assert.equal(hidden.status, 404);

        db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, ?, ?, ?)
            `,
        ).run(other.id, 50.9, 6.9, 40);

        const positions = await api.get("/api/vehicles/positions");
        assert.equal(positions.status, 200);
        assert.equal(
            positions.body.data.some((row: { id: number }) => row.id === other.id),
            false,
        );

        const otherSession = await loginAs(2);
        const visible = await otherSession.agent.get(
            `/api/vehicles/${other.id}`,
        );
        assert.equal(visible.status, 200);
        assert.equal(visible.body.id, other.id);
    });

    it("ignores company_id from the client and assigns the session company", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-CLI 1",
            driver_name: "Client",
            company_id: 2,
        });

        assert.equal(created.status, 201);
        const assigned = db
            .prepare("SELECT company_id FROM vehicles WHERE id = ?")
            .get(created.body.id) as { company_id: number };
        assert.equal(assigned.company_id, 1);
    });

    it("paginates and returns facet counts", async () => {
        seedFleet(12);

        const response = await api
            .get("/api/vehicles")
            .query({ page: 1, limit: 10 });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 10);
        assert.equal(response.body.meta.total, 12);
        assert.equal(response.body.meta.pageCount, 2);
        assert.equal(response.body.meta.counts.all, 12);
        assert.ok(response.body.meta.counts.low_fuel >= 1);
        assert.ok(response.body.meta.counts.driving >= 1);
        assert.ok(response.body.meta.counts.offline >= 1);
        assert.equal(response.body.meta.counts.alerts, 2);
        assert.equal(typeof response.body.data[0].active_alerts, "number");
        assert.equal(typeof response.body.data[0].created_at, "string");
        assert.equal(response.body.data[0].activeAlerts, undefined);
    });

    it("returns an empty page past the end and keeps the total", async () => {
        seedFleet(3);

        const response = await api
            .get("/api/vehicles")
            .query({ page: 9, limit: 10 });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.meta.total, 3);
        assert.equal(response.body.meta.pageCount, 1);
    });

    it("rejects a limit outside the allowlist", async () => {
        const response = await api
            .get("/api/vehicles")
            .query({ limit: 7 });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });

    it("rejects sort injection attempts", async () => {
        const response = await api
            .get("/api/vehicles")
            .query({ sort: "id;DROP TABLE vehicles" });

        assert.equal(response.status, 400);
    });

    it("sorts by active_alerts and filters by low_fuel", async () => {
        VehicleModel.create({
            license_plate: "K-CL 001",
            driver_name: "Clara Conrad",
            fuel_level: 15,
            status: "IDLE",
        });
        VehicleModel.create({
            license_plate: "K-MX 002",
            driver_name: "Max Müller",
            fuel_level: 10,
            status: "IDLE",
        });

        const filtered = await api
            .get("/api/vehicles")
            .query({ search: "clara", filter: "low_fuel" });

        assert.equal(filtered.status, 200);
        assert.equal(filtered.body.data.length, 1);
        assert.equal(filtered.body.data[0].driver_name, "Clara Conrad");
        assert.equal(filtered.body.meta.counts.all, 1);
        assert.equal(filtered.body.meta.counts.low_fuel, 1);

        const sorted = await api
            .get("/api/vehicles")
            .query({ sort: "active_alerts", dir: "desc" });

        assert.equal(sorted.status, 200);
    });

    it("responds 304 when If-None-Match matches the ETag", async () => {
        seedFleet(3);

        const first = await api
            .get("/api/vehicles")
            .set("Accept-Encoding", "identity");

        assert.equal(first.status, 200);
        const etag = first.headers.etag;
        assert.ok(etag);

        const second = await api
            .get("/api/vehicles")
            .set("Accept-Encoding", "identity")
            .set("If-None-Match", etag);

        assert.equal(second.status, 304);
    });
});

describe("GET /api/vehicles/positions", () => {
    function putTelemetry(
        vehicleId: number,
        lat: number,
        lng: number,
        speed = 40,
    ) {
        db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, ?, ?, ?)
            `,
        ).run(vehicleId, lat, lng, speed);
    }

    it("returns an empty list when nobody has a position", async () => {
        VehicleModel.create({
            license_plate: "K-NO 1",
            driver_name: "Ohne Fix",
            status: "OFFLINE",
        });

        const response = await api.get("/api/vehicles/positions");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.meta.truncated, false);
    });

    it("omits vehicles without telemetry and keeps the slim shape", async () => {
        const withFix = VehicleModel.create({
            license_plate: "K-POS 1",
            driver_name: "Mit Fix",
            status: "IDLE",
        });
        VehicleModel.create({
            license_plate: "K-POS 2",
            driver_name: "Ohne Fix",
            status: "IDLE",
        });
        putTelemetry(withFix.id, 50.9375, 6.9603, 12);

        const response = await api.get("/api/vehicles/positions");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].license_plate, "K-POS 1");
        assert.equal(response.body.data[0].driver_name, "Mit Fix");
        assert.equal(response.body.data[0].latitude, 50.9375);
        assert.equal(response.body.data[0].longitude, 6.9603);
        assert.equal(response.body.data[0].speed, 12);
        assert.equal(response.body.data[0].fuel_level, undefined);
        assert.equal(response.body.data[0].active_alerts, undefined);
        assert.equal(response.body.data[0].created_at, undefined);
    });

    it("filters by bbox and by driving", async () => {
        const cologne = VehicleModel.create({
            license_plate: "K-BB 1",
            driver_name: "Köln",
            status: "DRIVING",
        });
        const munich = VehicleModel.create({
            license_plate: "M-BB 1",
            driver_name: "München",
            status: "DRIVING",
        });
        const parked = VehicleModel.create({
            license_plate: "K-BB 2",
            driver_name: "Standby",
            status: "IDLE",
        });
        putTelemetry(cologne.id, 50.9375, 6.9603);
        putTelemetry(munich.id, 48.1351, 11.582);
        putTelemetry(parked.id, 50.94, 6.97);

        const boxed = await api
            .get("/api/vehicles/positions")
            .query({ bbox: "6.8,50.8,7.2,51.1" });

        assert.equal(boxed.status, 200);
        assert.deepEqual(
            boxed.body.data.map((row: { license_plate: string }) => row.license_plate),
            ["K-BB 1", "K-BB 2"],
        );

        const driving = await api
            .get("/api/vehicles/positions")
            .query({ bbox: "6.8,50.8,7.2,51.1", filter: "driving" });

        assert.equal(driving.status, 200);
        assert.equal(driving.body.data.length, 1);
        assert.equal(driving.body.data[0].license_plate, "K-BB 1");
    });

    it("rejects an invalid bbox and an unknown filter", async () => {
        const malformed = await api
            .get("/api/vehicles/positions")
            .query({ bbox: "1,2,3" });
        assert.equal(malformed.status, 400);

        const inverted = await api
            .get("/api/vehicles/positions")
            .query({ bbox: "7.2,50.8,6.8,51.1" });
        assert.equal(inverted.status, 400);

        const filter = await api
            .get("/api/vehicles/positions")
            .query({ filter: "nope" });
        assert.equal(filter.status, 400);
    });

    it("filters by driver or plate search", async () => {
        const clara = VehicleModel.create({
            license_plate: "K-CL 1",
            driver_name: "Clara Conrad",
            status: "IDLE",
        });
        const max = VehicleModel.create({
            license_plate: "K-MX 1",
            driver_name: "Max Müller",
            status: "IDLE",
        });
        putTelemetry(clara.id, 50.9375, 6.9603);
        putTelemetry(max.id, 50.94, 6.97);

        const byDriver = await api
            .get("/api/vehicles/positions")
            .query({ search: "clara" });

        assert.equal(byDriver.status, 200);
        assert.equal(byDriver.body.data.length, 1);
        assert.equal(byDriver.body.data[0].driver_name, "Clara Conrad");

        const byPlate = await api
            .get("/api/vehicles/positions")
            .query({ search: "K-MX" });

        assert.equal(byPlate.status, 200);
        assert.equal(byPlate.body.data.length, 1);
        assert.equal(byPlate.body.data[0].license_plate, "K-MX 1");
    });

    it("filters by one or more driver names", async () => {
        const clara = VehicleModel.create({
            license_plate: "K-CL 2",
            driver_name: "Clara Conrad",
            status: "IDLE",
        });
        const max = VehicleModel.create({
            license_plate: "K-MX 2",
            driver_name: "Max Müller",
            status: "IDLE",
        });
        const anna = VehicleModel.create({
            license_plate: "K-AN 1",
            driver_name: "Anna Schneider",
            status: "IDLE",
        });
        putTelemetry(clara.id, 50.9375, 6.9603);
        putTelemetry(max.id, 50.94, 6.97);
        putTelemetry(anna.id, 50.941, 6.971);

        const twoParams = new URLSearchParams();
        twoParams.append("drivers", "Clara Conrad");
        twoParams.append("drivers", "Max Müller");
        const two = await api.get(
            `/api/vehicles/positions?${twoParams}`,
        );

        assert.equal(two.status, 200);
        assert.deepEqual(
            two.body.data.map((row: { driver_name: string }) => row.driver_name),
            ["Clara Conrad", "Max Müller"],
        );

        const comma = await api
            .get("/api/vehicles/positions")
            .query({ drivers: "Clara Conrad,Anna Schneider" });

        assert.equal(comma.status, 200);
        assert.equal(comma.body.data.length, 2);

        const tooMany = new URLSearchParams();
        for (let index = 1; index <= 51; index += 1) {
            tooMany.append("drivers", `Fahrer ${index}`);
        }
        const rejected = await api.get(
            `/api/vehicles/positions?${tooMany}`,
        );

        assert.equal(rejected.status, 400);
    });

    it("returns truncated with empty data past FLEET_POSITIONS_MAX", async () => {
        const insertVehicle = db.prepare(
            `
                INSERT INTO vehicles (
                    license_plate,
                    driver_name,
                    fuel_level,
                    status,
                    company_id
                )
                VALUES (?, ?, 80, 'IDLE', 1)
            `,
        );
        const insertTelemetry = db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, 50.9, 6.9, 0)
            `,
        );
        const overLimit = FLEET_POSITIONS_MAX + 1;

        db.exec("BEGIN");
        for (let index = 0; index < overLimit; index += 1) {
            const result = insertVehicle.run(
                `K-T ${String(index).padStart(4, "0")}`,
                `Driver ${index}`,
            );
            insertTelemetry.run(Number(result.lastInsertRowid));
        }
        db.exec("COMMIT");

        const response = await api.get("/api/vehicles/positions");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.meta.truncated, true);
    });
});

describe("GET /api/vehicles/drivers", () => {
    it("does not dump the roster without a search", async () => {
        VehicleModel.create({
            license_plate: "K-A 1",
            driver_name: "Anna Schneider",
            status: "IDLE",
        });
        VehicleModel.create({
            license_plate: "K-B 1",
            driver_name: "Max Müller",
            status: "IDLE",
        });

        const response = await api.get("/api/vehicles/drivers");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.meta.total, 2);
        assert.equal(response.body.meta.page, 1);
        assert.equal(response.body.meta.pageCount, 0);
    });

    it("searches by name or plate and hydrates selected names", async () => {
        VehicleModel.create({
            license_plate: "K-A 1",
            driver_name: "Anna Schneider",
            status: "IDLE",
        });
        VehicleModel.create({
            license_plate: "K-B 1",
            driver_name: "Max Müller",
            status: "IDLE",
        });

        const byName = await api
            .get("/api/vehicles/drivers")
            .query({ search: "anna" });

        assert.equal(byName.status, 200);
        assert.deepEqual(byName.body.data, [
            { name: "Anna Schneider", license_plate: "K-A 1" },
        ]);
        assert.equal(byName.body.meta.total, 1);
        assert.equal(byName.body.meta.pageCount, 1);

        const byPlate = await api
            .get("/api/vehicles/drivers")
            .query({ search: "K-B" });

        assert.equal(byPlate.status, 200);
        assert.deepEqual(byPlate.body.data, [
            { name: "Max Müller", license_plate: "K-B 1" },
        ]);

        const selected = await api
            .get("/api/vehicles/drivers")
            .query({ names: "Max Müller" });

        assert.equal(selected.status, 200);
        assert.deepEqual(selected.body.data, [
            { name: "Max Müller", license_plate: "K-B 1" },
        ]);
    });

    it("paginates search hits instead of capping the total at the page size", async () => {
        for (let i = 0; i < 51; i += 1) {
            VehicleModel.create({
                license_plate: `K-P ${String(i).padStart(3, "0")}`,
                driver_name: `Pat ${String(i).padStart(2, "0")}`,
                status: "IDLE",
            });
        }

        const first = await api
            .get("/api/vehicles/drivers")
            .query({ search: "Pat" });

        assert.equal(first.status, 200);
        assert.equal(first.body.meta.total, 51);
        assert.equal(first.body.meta.limit, 50);
        assert.equal(first.body.meta.page, 1);
        assert.equal(first.body.meta.pageCount, 2);
        assert.equal(first.body.data.length, 50);

        const second = await api
            .get("/api/vehicles/drivers")
            .query({ search: "Pat", page: 2 });

        assert.equal(second.status, 200);
        assert.equal(second.body.meta.page, 2);
        assert.equal(second.body.data.length, 1);
        assert.equal(second.body.data[0].name, "Pat 50");

        const rejected = await api
            .get("/api/vehicles/drivers")
            .query({ search: "Pat", page: 0 });

        assert.equal(rejected.status, 400);
    });
});

describe("vehicle mutations", () => {
    it("creates a vehicle with Location and rejects a duplicate plate with 409", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-NEU 1",
            driver_name: "Neu Fahrer",
            fuel_level: 50,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.license_plate, "K-NEU 1");
        assert.equal(created.body.active_alerts, 0);
        assert.ok(created.body.created_at);
        const assigned = db
            .prepare("SELECT company_id FROM vehicles WHERE id = ?")
            .get(created.body.id) as { company_id: number };
        assert.equal(assigned.company_id, 1);
        assert.equal(
            created.headers.location,
            `/api/vehicles/${created.body.id}`,
        );

        const duplicate = await api.post("/api/vehicles").send({
            license_plate: "K-NEU 1",
            driver_name: "Anderer Fahrer",
            fuel_level: 40,
            status: "IDLE",
        });

        assert.equal(duplicate.status, 409);
        assert.equal(
            duplicate.body.error,
            "Kennzeichen ist bereits vergeben.",
        );
        assert.equal(
            duplicate.body.fields.license_plate,
            "Kennzeichen ist bereits vergeben.",
        );
    });

    it("rejects missing required fields and oversized strings", async () => {
        const missing = await api.post("/api/vehicles").send({
            fuel_level: 40,
        });

        assert.equal(missing.status, 400);
        assert.equal(missing.body.fields.license_plate, "Kennzeichen ist erforderlich.");
        assert.equal(missing.body.fields.driver_name, "Fahrer ist erforderlich.");

        const tooLong = await api.post("/api/vehicles").send({
            license_plate: "K".repeat(33),
            driver_name: "A".repeat(81),
            fuel_level: 40,
            status: "IDLE",
        });

        assert.equal(tooLong.status, 400);
        assert.match(tooLong.body.fields.license_plate, /höchstens 32/);
        assert.match(tooLong.body.fields.driver_name, /höchstens 80/);
    });

    it("rejects an invalid id", async () => {
        const response = await api.get("/api/vehicles/abc");
        assert.equal(response.status, 400);
        assert.equal(response.body.error, "Ungültige Fahrzeug-ID.");
    });

    it("returns 404 for a missing vehicle", async () => {
        const response = await api.get("/api/vehicles/999");
        assert.equal(response.status, 404);
        assert.equal(response.body.error, "Fahrzeug nicht gefunden.");
    });

    it("replaces, patches and deletes a vehicle", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-ED 1",
            driver_name: "Edit Fahrer",
            fuel_level: 40,
            status: "IDLE",
        });

        const id = created.body.id;

        const replaced = await api.put(`/api/vehicles/${id}`).send({
            license_plate: "K-ED 2",
            driver_name: "Neuer Fahrer",
            fuel_level: 70,
            status: "DRIVING",
        });

        assert.equal(replaced.status, 200);
        assert.equal(replaced.body.license_plate, "K-ED 2");
        assert.equal(replaced.body.status, "DRIVING");

        const emptyPatch = await api
            .patch(`/api/vehicles/${id}`)
            .send({});

        assert.equal(emptyPatch.status, 400);
        assert.equal(
            emptyPatch.body.error,
            "Mindestens ein Feld ist erforderlich.",
        );

        const patched = await api
            .patch(`/api/vehicles/${id}`)
            .send({ fuel_level: 12 });

        assert.equal(patched.status, 200);
        assert.equal(patched.body.fuel_level, 12);
        assert.equal(patched.body.license_plate, "K-ED 2");

        const deleted = await api.delete(`/api/vehicles/${id}`);
        assert.equal(deleted.status, 204);

        const missing = await api.get(`/api/vehicles/${id}`);
        assert.equal(missing.status, 404);
    });
});

describe("tenant isolation", () => {
    async function otherCompanyVehicle() {
        return VehicleModel.create({
            license_plate: "K-FRD 1",
            driver_name: "Fremd",
            fuel_level: 40,
            status: "DRIVING",
            company_id: 2,
        });
    }

    it("allows the same plate at another company and rejects it in the same company", async () => {
        const mine = await api.post("/api/vehicles").send({
            license_plate: "K-DUP 1",
            driver_name: "Eins",
        });
        assert.equal(mine.status, 201);

        const other = await loginAs(2);
        const theirs = await other.agent.post("/api/vehicles").send({
            license_plate: "K-DUP 1",
            driver_name: "Zwei",
        });
        assert.equal(theirs.status, 201);
        assert.notEqual(theirs.body.id, mine.body.id);

        const again = await api.post("/api/vehicles").send({
            license_plate: "K-DUP 1",
            driver_name: "Noch Eins",
        });
        assert.equal(again.status, 409);
    });

    it("returns 404 for another company's vehicle on mutate, telemetry and trip", async () => {
        const other = await otherCompanyVehicle();
        TripModel.open(other.id);
        db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, ?, ?, ?)
            `,
        ).run(other.id, 50.9, 6.9, 40);

        const patched = await api
            .patch(`/api/vehicles/${other.id}`)
            .send({ driver_name: "Gehackt" });
        assert.equal(patched.status, 404);

        const replaced = await api.put(`/api/vehicles/${other.id}`).send({
            license_plate: "K-HCK 1",
            driver_name: "Gehackt",
            fuel_level: 10,
            status: "IDLE",
        });
        assert.equal(replaced.status, 404);

        const deleted = await api.delete(`/api/vehicles/${other.id}`);
        assert.equal(deleted.status, 404);

        const telemetry = await api.get(`/api/vehicles/${other.id}/telemetry`);
        assert.equal(telemetry.status, 404);

        const trip = await api.get(`/api/vehicles/${other.id}/trips/latest`);
        assert.equal(trip.status, 404);

        const stillThere = db
            .prepare("SELECT driver_name FROM vehicles WHERE id = ?")
            .get(other.id) as { driver_name: string };
        assert.equal(stillThere.driver_name, "Fremd");
    });

    it("does not tick a paused company's vehicles", () => {
        const mine = VehicleModel.create({
            license_plate: "K-SIM A",
            driver_name: "A",
            status: "DRIVING",
            company_id: 1,
        });
        const theirs = VehicleModel.create({
            license_plate: "K-SIM B",
            driver_name: "B",
            status: "DRIVING",
            company_id: 2,
        });
        seedSimProgress(mine.id, "koeln-duesseldorf", 0.2);
        seedSimProgress(theirs.id, "koeln-duesseldorf", 0.2);

        setCompanySimRunning(2, false);
        const patches = TelemetryModel.tickDrivingVehicles([
            mine.id,
            theirs.id,
        ]);

        assert.equal(patches.length, 1);
        assert.equal(patches[0]?.id, mine.id);
    });

    it("does not send another company's vehicles-changed or telemetry over SSE", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-SSE A",
            driver_name: "A",
            company_id: 1,
        });
        const theirs = VehicleModel.create({
            license_plate: "K-SSE B",
            driver_name: "B",
            company_id: 2,
        });
        const other = await loginAs(2);
        const server = app.listen(0);

        await new Promise<void>((resolve, reject) => {
            server.once("listening", () => resolve());
            server.once("error", reject);
        });

        try {
            const { port } = server.address() as AddressInfo;
            const streamMine = await openSseStream(port, sessionCookie);
            const streamTheirs = await openSseStream(port, other.cookie);

            await streamMine.waitUntil((text) => /event: connected/.test(text));
            await streamTheirs.waitUntil((text) =>
                /event: connected/.test(text),
            );

            const connectionMine = streamMine.events().find(
                (event) => event.event === "connected",
            )?.data as { connection_id: string };
            const connectionTheirs = streamTheirs.events().find(
                (event) => event.event === "connected",
            )?.data as { connection_id: string };

            await api.post("/api/stream/focus").send({
                connection_id: connectionMine.connection_id,
                ids: [mine.id, theirs.id],
            });
            await other.agent.post("/api/stream/focus").send({
                connection_id: connectionTheirs.connection_id,
                ids: [mine.id, theirs.id],
            });

            const stolen = await other.agent.post("/api/stream/focus").send({
                connection_id: connectionMine.connection_id,
                ids: [theirs.id],
            });
            assert.equal(stolen.status, 400);

            broadcast(
                "telemetry",
                [
                    {
                        id: mine.id,
                        speed: 11,
                        latitude: 50.1,
                        longitude: 6.1,
                        recorded_at: "2026-01-01T00:00:00.000Z",
                    },
                ],
                1,
            );
            broadcast(
                "telemetry",
                [
                    {
                        id: theirs.id,
                        speed: 22,
                        latitude: 51.2,
                        longitude: 7.2,
                        recorded_at: "2026-01-01T00:00:00.000Z",
                    },
                ],
                2,
            );
            broadcast("vehicles-changed", { at: 1 }, 1);

            await streamMine.waitUntil(
                (text) =>
                    /event: telemetry/.test(text) &&
                    /event: vehicles-changed/.test(text),
            );
            await streamTheirs.waitUntil((text) =>
                /event: telemetry/.test(text),
            );

            const telemetryMine = streamMine
                .events()
                .filter((event) => event.event === "telemetry")
                .flatMap((event) => event.data as Array<{ id: number }>);
            const telemetryTheirs = streamTheirs
                .events()
                .filter((event) => event.event === "telemetry")
                .flatMap((event) => event.data as Array<{ id: number }>);

            assert.deepEqual(
                telemetryMine.map((patch) => patch.id),
                [mine.id],
            );
            assert.deepEqual(
                telemetryTheirs.map((patch) => patch.id),
                [theirs.id],
            );
            assert.ok(
                streamMine
                    .events()
                    .some((event) => event.event === "vehicles-changed"),
            );
            assert.equal(
                streamTheirs
                    .events()
                    .some((event) => event.event === "vehicles-changed"),
                false,
            );

            await streamMine.reader.cancel();
            await streamTheirs.reader.cancel();
        } finally {
            closeAllSseClients();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
});

describe("roles", () => {
    it("lets a viewer read but not mutate vehicles or the sim", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-VW 1",
            driver_name: "Sichtbar",
            company_id: 1,
        });
        const foreign = VehicleModel.create({
            license_plate: "K-VW 2",
            driver_name: "Fremd",
            company_id: 2,
        });

        const viewer = await loginAs(1, "viewer");

        const list = await viewer.agent.get("/api/vehicles");
        assert.equal(list.status, 200);
        assert.equal(list.body.meta.total, 1);
        assert.equal(list.body.data[0].id, mine.id);

        const detail = await viewer.agent.get(`/api/vehicles/${mine.id}`);
        assert.equal(detail.status, 200);

        const hidden = await viewer.agent.get(`/api/vehicles/${foreign.id}`);
        assert.equal(hidden.status, 404);

        const created = await viewer.agent.post("/api/vehicles").send({
            license_plate: "K-VW 3",
            driver_name: "Neu",
        });
        assert.equal(created.status, 403);
        assert.equal(created.body.code, "FORBIDDEN");

        const patched = await viewer.agent
            .patch(`/api/vehicles/${mine.id}`)
            .send({ driver_name: "Geändert" });
        assert.equal(patched.status, 403);

        const replaced = await viewer.agent.put(`/api/vehicles/${mine.id}`).send({
            license_plate: "K-VW 1",
            driver_name: "Geändert",
            fuel_level: 40,
            status: "IDLE",
        });
        assert.equal(replaced.status, 403);

        const deleted = await viewer.agent.delete(`/api/vehicles/${mine.id}`);
        assert.equal(deleted.status, 403);

        const sim = await viewer.agent.get("/api/sim");
        assert.equal(sim.status, 200);

        const paused = await viewer.agent.patch("/api/sim").send({ running: false });
        assert.equal(paused.status, 403);

        const stillThere = db
            .prepare("SELECT driver_name FROM vehicles WHERE id = ?")
            .get(mine.id) as { driver_name: string };
        assert.equal(stillThere.driver_name, "Sichtbar");
    });
});

describe("GET /api/sim", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/sim");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("reports that the ticker is off in tests", async () => {
        const response = await api.get("/api/sim");

        assert.equal(response.status, 200);
        assert.equal(response.body.running, false);
        assert.equal(response.body.available, false);
    });

    it("rejects enabling the ticker when TELEMETRY_TICK_MS is 0", async () => {
        const response = await api
            .patch("/api/sim")
            .send({ running: true });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "BAD_REQUEST");
    });
});

describe("GET /api/vehicles/:id/telemetry", () => {
    it("returns 404 for a missing vehicle", async () => {
        const response = await api.get("/api/vehicles/999/telemetry");
        assert.equal(response.status, 404);
    });

    it("returns an empty list when a vehicle has no points", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TM 1",
            driver_name: "Ohne Punkte",
        });

        const response = await api.get(
            `/api/vehicles/${vehicle.id}/telemetry`,
        );

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
    });

    it("returns points in chronological order and caps the window", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TM 2",
            driver_name: "Mit Punkten",
            status: "DRIVING",
        });

        for (let index = 0; index < 5; index += 1) {
            TelemetryModel.tickDrivingVehicles([vehicle.id]);
        }

        assert.ok(TelemetryModel.countForVehicle(vehicle.id) <= 3);

        const response = await api
            .get(`/api/vehicles/${vehicle.id}/telemetry`)
            .query({ limit: 10 });

        assert.equal(response.status, 200);
        assert.ok(response.body.data.length >= 1);
        assert.ok(response.body.data.length <= 3);

        const ids = response.body.data.map(
            (point: { id: number }) => point.id,
        );
        const sorted = [...ids].sort((left: number, right: number) => left - right);
        assert.deepEqual(ids, sorted);
        assert.equal(response.body.data[0].vehicle_id, vehicle.id);
    });
});

describe("GET /api/stream", () => {
    it("sends event-stream headers, a connection_id and rejects unknown focus", async () => {
        const server = app.listen(0);

        await new Promise<void>((resolve, reject) => {
            server.once("listening", () => resolve());
            server.once("error", reject);
        });

        try {
            const { port } = server.address() as AddressInfo;
            const anonymous = await fetch(
                `http://127.0.0.1:${port}/api/stream`,
            );
            assert.equal(anonymous.status, 401);

            const vehicle = VehicleModel.create({
                license_plate: "K-SSE 1",
                driver_name: "Streamer",
            });
            const response = await fetch(
                `http://127.0.0.1:${port}/api/stream`,
                { headers: { Cookie: sessionCookie } },
            );

            assert.equal(response.status, 200);
            assert.match(
                response.headers.get("content-type") ?? "",
                /text\/event-stream/,
            );
            assert.equal(response.headers.get("cache-control"), "no-store");

            const reader = response.body?.getReader();
            assert.ok(reader);

            const { value } = await reader.read();
            const text = new TextDecoder().decode(value);
            assert.match(text, /event: connected/);

            const payloadMatch = text.match(/data: ({.*})/);
            assert.ok(payloadMatch?.[1]);
            const payload = JSON.parse(payloadMatch[1]) as {
                connection_id: string;
            };
            assert.equal(typeof payload.connection_id, "string");

            const focused = await api
                .post("/api/stream/focus")
                .send({
                    connection_id: payload.connection_id,
                    ids: [vehicle.id],
                });

            assert.equal(focused.status, 200);
            assert.equal(focused.body.ok, true);
            assert.equal(focused.body.count, 1);

            const unknown = await api
                .post("/api/stream/focus")
                .send({
                    connection_id: "00000000-0000-4000-8000-000000000001",
                    ids: [1],
                });

            assert.equal(unknown.status, 400);
            assert.equal(unknown.body.error, "Unbekannte Verbindung.");

            const invalid = await api
                .post("/api/stream/focus")
                .send({ ids: [1] });

            assert.equal(invalid.status, 400);

            await reader.cancel();
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });

    it("delivers telemetry only to connections that focused the vehicle", async () => {
        const [first, second] = seedFleet(2);
        assert.ok(first);
        assert.ok(second);

        const server = app.listen(0);

        await new Promise<void>((resolve, reject) => {
            server.once("listening", () => resolve());
            server.once("error", reject);
        });

        try {
            const { port } = server.address() as AddressInfo;
            const streamA = await openSseStream(port);
            const streamB = await openSseStream(port);

            await streamA.waitUntil((text) => /event: connected/.test(text));
            await streamB.waitUntil((text) => /event: connected/.test(text));

            const connectionA = streamA.events().find(
                (event) => event.event === "connected",
            )?.data as { connection_id: string };
            const connectionB = streamB.events().find(
                (event) => event.event === "connected",
            )?.data as { connection_id: string };

            assert.equal(typeof connectionA.connection_id, "string");
            assert.equal(typeof connectionB.connection_id, "string");

            const focusedA = await api
                .post("/api/stream/focus")
                .send({
                    connection_id: connectionA.connection_id,
                    ids: [first.id],
                });
            const focusedB = await api
                .post("/api/stream/focus")
                .send({
                    connection_id: connectionB.connection_id,
                    ids: [second.id],
                });

            assert.equal(focusedA.status, 200);
            assert.equal(focusedB.status, 200);

            broadcast(
                "telemetry",
                [
                    {
                        id: first.id,
                        speed: 11,
                        latitude: 50.1,
                        longitude: 6.1,
                        recorded_at: "2026-01-01T00:00:00.000Z",
                    },
                    {
                        id: second.id,
                        speed: 22,
                        latitude: 51.2,
                        longitude: 7.2,
                        recorded_at: "2026-01-01T00:00:00.000Z",
                    },
                ],
                1,
            );
            broadcast("vehicles-changed", { at: 1 }, 1);

            await streamA.waitUntil((text) => /event: vehicles-changed/.test(text));
            await streamB.waitUntil((text) => /event: vehicles-changed/.test(text));

            const telemetryA = streamA
                .events()
                .filter((event) => event.event === "telemetry")
                .flatMap((event) => event.data as Array<{ id: number }>);
            const telemetryB = streamB
                .events()
                .filter((event) => event.event === "telemetry")
                .flatMap((event) => event.data as Array<{ id: number }>);

            assert.deepEqual(
                telemetryA.map((patch) => patch.id),
                [first.id],
            );
            assert.deepEqual(
                telemetryB.map((patch) => patch.id),
                [second.id],
            );
            assert.ok(
                streamA
                    .events()
                    .some((event) => event.event === "vehicles-changed"),
            );
            assert.ok(
                streamB
                    .events()
                    .some((event) => event.event === "vehicles-changed"),
            );

            await streamA.reader.cancel();
            await streamB.reader.cancel();
        } finally {
            closeAllSseClients();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
});

describe("telemetry route simulation", () => {
    it("moves along a corridor instead of jittering in place", () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SIM 1",
            driver_name: "Route",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.2);
        const start = { lat: 50.9375, lng: 6.9603 };
        const points: Array<{ lat: number; lng: number }> = [];

        for (let index = 0; index < 20; index += 1) {
            const [patch] = TelemetryModel.tickDrivingVehicles([vehicle.id]);
            assert.ok(patch);
            points.push({ lat: patch.latitude, lng: patch.longitude });
        }

        const last = points[points.length - 1];
        assert.ok(last);
        assert.ok(haversineMeters(start, last) > 2_000);

        const mid = points[9];
        assert.ok(mid);
        assert.ok(
            haversineMeters(start, last) > haversineMeters(start, mid),
        );
    });

    it("reverses direction after reaching the end of the route", () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SIM 2",
            driver_name: "Pendel",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.97);
        const origin = { lat: 50.9375, lng: 6.9603 };
        let farthest = 0;
        let lastDistance = 0;

        for (let index = 0; index < 80; index += 1) {
            const [patch] = TelemetryModel.tickDrivingVehicles([vehicle.id]);
            assert.ok(patch);
            lastDistance = haversineMeters(origin, {
                lat: patch.latitude,
                lng: patch.longitude,
            });
            farthest = Math.max(farthest, lastDistance);
        }

        assert.ok(farthest > 20_000);
        assert.ok(lastDistance < farthest - 1_000);
    });

    it("starts a new trip when the route reverses", () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SIM 2b",
            driver_name: "Neue Fahrt",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.97);

        let resets = 0;

        for (let index = 0; index < 80; index += 1) {
            const [patch] = TelemetryModel.tickDrivingVehicles([vehicle.id]);
            assert.ok(patch);

            if (patch.path_reset) {
                resets += 1;
            }
        }

        assert.ok(resets >= 2);

        const latest = TripModel.latestForVehicle(vehicle.id, 1);
        assert.ok(latest);
        assert.equal(latest.ended_at, null);

        const counts = db
            .prepare(
                `SELECT
                    COALESCE(SUM(ended_at IS NOT NULL), 0) AS closed,
                    COALESCE(SUM(ended_at IS NULL), 0) AS open
                 FROM trips WHERE vehicle_id = ?`,
            )
            .get(vehicle.id) as { closed: number; open: number };

        assert.equal(counts.open, 1);
        assert.ok(counts.closed >= 1);
        assert.ok(latest.distance_m < 15_000);
    });

    it("keeps displayed speed within the local limit", () => {
        assert.equal(speedLimitKmh(0), CITY_LIMIT_KMH);
        assert.equal(speedLimitKmh(0.5), HIGHWAY_LIMIT_KMH);
        assert.equal(speedLimitKmh(1), CITY_LIMIT_KMH);

        const cityVehicle = VehicleModel.create({
            license_plate: "K-SIM 3",
            driver_name: "Stadt",
            status: "DRIVING",
        });
        seedSimProgress(cityVehicle.id, "koeln-duesseldorf", 0.02);

        const [city] = TelemetryModel.tickDrivingVehicles([
            cityVehicle.id,
        ]);
        assert.ok(city);
        assert.ok(city.speed <= CITY_LIMIT_KMH);
        assert.ok(city.speed >= 30);

        const highwayVehicle = VehicleModel.create({
            license_plate: "K-SIM 4",
            driver_name: "Autobahn",
            status: "DRIVING",
        });
        seedSimProgress(highwayVehicle.id, "koeln-duesseldorf", 0.5);

        const [highway] = TelemetryModel.tickDrivingVehicles([
            highwayVehicle.id,
        ]);
        assert.ok(highway);
        assert.ok(highway.speed <= HIGHWAY_LIMIT_KMH);
        assert.ok(highway.speed >= HIGHWAY_LIMIT_KMH - 15);
    });

    it("uses fuel while driving", () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SIM 5",
            driver_name: "Verbrauch",
            fuel_level: 80,
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.5);

        const [patch] = TelemetryModel.tickDrivingVehicles([vehicle.id]);

        assert.ok(patch);
        assert.ok(patch.fuel_level < 80);
        assert.equal(
            VehicleModel.getById(vehicle.id, 1)?.fuel_level,
            patch.fuel_level,
        );
    });
});

describe("trip lifecycle", () => {
    it("reports standstill when a trip ends", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRIP 1",
            driver_name: "Feierabend",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.5);
        TelemetryModel.tickDrivingVehicles([vehicle.id]);

        assert.ok((VehicleModel.getById(vehicle.id, 1)?.speed ?? 0) > 0);

        const response = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "STOPPED" });

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "STOPPED");
        assert.equal(response.body.speed, 0);
    });

    it("keeps the last position when a trip ends", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRIP 2",
            driver_name: "Position",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.5);
        const [patch] = TelemetryModel.tickDrivingVehicles([vehicle.id]);
        assert.ok(patch);

        const response = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "IDLE" });

        assert.equal(response.status, 200);
        assert.equal(response.body.latitude, patch.latitude);
        assert.equal(response.body.longitude, patch.longitude);
    });

    it("does not invent telemetry for a vehicle that never reported", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRIP 3",
            driver_name: "Ohne Signal",
            status: "DRIVING",
        });

        const response = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "STOPPED" });

        assert.equal(response.status, 200);
        assert.equal(response.body.speed, null);
        assert.equal(response.body.recorded_at, null);
        assert.equal(TelemetryModel.countForVehicle(vehicle.id), 0);
    });

    it("opens one trip per drive and closes it on stop", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRIP 4",
            driver_name: "Zwei Fahrten",
            status: "IDLE",
        });

        const countTrips = (openOnly: boolean) =>
            (
                db
                    .prepare(
                        `SELECT COUNT(*) AS total FROM trips
                         WHERE vehicle_id = ?
                           ${openOnly ? "AND ended_at IS NULL" : ""}`,
                    )
                    .get(vehicle.id) as { total: number }
            ).total;

        await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "DRIVING" });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.3);
        TelemetryModel.tickDrivingVehicles([vehicle.id]);

        assert.equal(countTrips(true), 1);

        // Ein zweiter DRIVING-Patch ist kein Fahrtbeginn.
        await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "DRIVING" });

        assert.equal(countTrips(true), 1);

        await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "STOPPED" });

        assert.equal(countTrips(true), 0);
        assert.equal(countTrips(false), 1);

        await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "DRIVING" });

        assert.equal(countTrips(true), 1);
        assert.equal(countTrips(false), 2);
    });
});

function insertClosedTrip(vehicleId: number, endedAt: string) {
    db.prepare(
        `
            INSERT INTO trips (vehicle_id, started_at, ended_at, path)
            VALUES (?, ?, ?, '')
        `,
    ).run(vehicleId, endedAt, endedAt);
}

function countTripsFor(vehicleId: number) {
    return (
        db
            .prepare("SELECT COUNT(*) AS total FROM trips WHERE vehicle_id = ?")
            .get(vehicleId) as { total: number }
    ).total;
}

describe("trip retention", () => {
    it("deletes old closed trips for one company and leaves the other company and open trips", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-RET A",
            driver_name: "A",
            company_id: 1,
        });
        const theirs = VehicleModel.create({
            license_plate: "K-RET B",
            driver_name: "B",
            company_id: 2,
        });

        const stale = sqliteDaysAgo(config.tripRetentionDays + 1);
        insertClosedTrip(mine.id, stale);
        insertClosedTrip(theirs.id, stale);
        TripModel.open(mine.id);

        assert.equal(TripModel.pruneClosedForCompany(1), 1);
        assert.equal(countTripsFor(mine.id), 1);
        assert.equal(countTripsFor(theirs.id), 1);

        const other = await loginAs(2);
        const theirsLatest = await other.agent.get(
            `/api/vehicles/${theirs.id}/trips/latest`,
        );
        assert.equal(theirsLatest.status, 200);
        assert.equal(theirsLatest.body.data.ended_at, stale);

        const mineLatest = await api.get(
            `/api/vehicles/${mine.id}/trips/latest`,
        );
        assert.equal(mineLatest.status, 200);
        assert.equal(mineLatest.body.data.ended_at, null);
    });

    it("does not delete a recently closed trip and prunes stale ones on stop", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-RET C",
            driver_name: "C",
            status: "IDLE",
            company_id: 1,
        });
        const stale = sqliteDaysAgo(config.tripRetentionDays + 2);
        insertClosedTrip(vehicle.id, stale);

        const driving = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "DRIVING" });
        assert.equal(driving.status, 200);

        const stopped = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "IDLE" });

        assert.equal(stopped.status, 200);
        assert.equal(countTripsFor(vehicle.id), 1);

        const latest = await api.get(
            `/api/vehicles/${vehicle.id}/trips/latest`,
        );
        assert.equal(latest.status, 200);
        assert.ok(latest.body.data.ended_at);
        assert.notEqual(latest.body.data.ended_at, stale);
        assert.equal(
            latest.body.data.ended_at.slice(0, 10),
            nowSqlite().slice(0, 10),
        );
    });

    it("does not prune another company when a tick writes", () => {
        const mine = VehicleModel.create({
            license_plate: "K-RET D",
            driver_name: "D",
            status: "DRIVING",
            company_id: 1,
        });
        const theirs = VehicleModel.create({
            license_plate: "K-RET E",
            driver_name: "E",
            status: "DRIVING",
            company_id: 2,
        });
        const stale = sqliteDaysAgo(config.tripRetentionDays + 1);
        insertClosedTrip(mine.id, stale);
        insertClosedTrip(theirs.id, stale);
        seedSimProgress(mine.id, "koeln-duesseldorf", 0.2);

        TelemetryModel.tickDrivingVehicles([mine.id]);

        const staleLeft = db
            .prepare(
                `SELECT COUNT(*) AS total FROM trips
                 WHERE vehicle_id = ? AND ended_at = ?`,
            )
            .get(mine.id, stale) as { total: number };
        assert.equal(staleLeft.total, 0);
        assert.equal(countTripsFor(theirs.id), 1);
        assert.equal(TripModel.latestForVehicle(theirs.id, 2)?.ended_at, stale);
    });
});

describe("GET /api/vehicles/:id/trips/latest", () => {
    it("returns 404 for a missing vehicle", async () => {
        const response = await api.get(
            "/api/vehicles/999/trips/latest",
        );

        assert.equal(response.status, 404);
    });

    it("returns null for a vehicle that never drove", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRP 1",
            driver_name: "Nie gefahren",
        });

        const response = await api.get(
            `/api/vehicles/${vehicle.id}/trips/latest`,
        );

        assert.equal(response.status, 200);
        assert.equal(response.body.data, null);
    });

    /**
     * Der Kern der Fahrten-Ebene: der Verlauf hängt an der Fahrt, nicht am
     * Rohfenster. Die Tests laufen mit TELEMETRY_KEEP_PER_VEHICLE = 3.
     */
    it("keeps the full trip while the raw window rolls over", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRP 2",
            driver_name: "Lange Strecke",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.2);

        const ticks = 60;
        for (let index = 0; index < ticks; index += 1) {
            TelemetryModel.tickDrivingVehicles([vehicle.id]);
        }

        assert.ok(TelemetryModel.countForVehicle(vehicle.id) <= 3);

        const response = await api.get(
            `/api/vehicles/${vehicle.id}/trips/latest`,
        );

        assert.equal(response.status, 200);
        assert.equal(response.body.data.ended_at, null);

        const path = decodePolyline(response.body.data.path);
        assert.ok(
            path.length > ticks,
            `road vertices should outnumber ticks: ${path.length} vs ${ticks}`,
        );
        assert.ok(response.body.data.distance_m > 10_000);
        assert.ok(response.body.data.max_speed > 50);
    });

    it("simplifies the path on stop without moving the route", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TRP 3",
            driver_name: "Eingedickt",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.2);

        for (let index = 0; index < 60; index += 1) {
            TelemetryModel.tickDrivingVehicles([vehicle.id]);
        }

        const running = await api.get(
            `/api/vehicles/${vehicle.id}/trips/latest`,
        );
        const before = decodePolyline(running.body.data.path);
        const drivenMeters = running.body.data.distance_m;

        await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "STOPPED" });

        const stopped = await api.get(
            `/api/vehicles/${vehicle.id}/trips/latest`,
        );
        const after = decodePolyline(stopped.body.data.path);

        assert.ok(stopped.body.data.ended_at);
        assert.ok(after.length >= 2);
        assert.ok(after.length < before.length);
        assert.equal(stopped.body.data.point_count, after.length);

        // Die gefahrene Strecke bleibt die gefahrene Strecke.
        assert.equal(stopped.body.data.distance_m, drivenMeters);

        // Anfang und Ende der Linie verschieben sich nicht.
        const first = before[0];
        const last = before[before.length - 1];
        assert.ok(first && last);
        assert.ok(haversineMeters(first, after[0]!) < 1);
        assert.ok(haversineMeters(last, after[after.length - 1]!) < 1);
    });
});

describe("polyline geometry", () => {
    it("round-trips coordinates within a metre", () => {
        const points = [
            { lat: 50.9375, lng: 6.9603 },
            { lat: 51.2277, lng: 6.7735 },
            { lat: 52.52, lng: 13.405 },
            { lat: 48.1351, lng: 11.582 },
        ];

        const decoded = decodePolyline(encodePolyline(points));

        assert.equal(decoded.length, points.length);
        for (let index = 0; index < points.length; index += 1) {
            assert.ok(haversineMeters(decoded[index]!, points[index]!) < 1);
        }
    });

    it("encodes a long route far below the size of a point list", () => {
        const points = Array.from({ length: 2_000 }, (_, index) => ({
            lat: 50 + index * 0.0002,
            lng: 7 + index * 0.0003,
        }));

        const encoded = encodePolyline(points);
        const asJson = JSON.stringify(points);

        assert.ok(
            encoded.length * 5 < asJson.length,
            `encoded ${encoded.length} vs json ${asJson.length}`,
        );
    });

    it("drops points on a straight line and keeps corners", () => {
        const straight = Array.from({ length: 50 }, (_, index) => ({
            lat: 50 + index * 0.001,
            lng: 7,
        }));

        assert.deepEqual(simplifyPath(straight, 12), [
            straight[0],
            straight[straight.length - 1],
        ]);

        const corner = [
            { lat: 50, lng: 7 },
            { lat: 50.02, lng: 7 },
            { lat: 50.02, lng: 7.02 },
        ];

        assert.equal(simplifyPath(corner, 12).length, 3);
    });
});

describe("route vertices", () => {
    it("returns the road shape between two fractions, not a chord", () => {
        const route = SIM_ROUTES.find(
            (entry) => entry.id === "koeln-duesseldorf",
        );
        assert.ok(route);

        const slice = verticesBetween(route.points, 0, 0.03);
        assert.ok(
            slice.length > 5,
            `expected a curve, got ${slice.length} points`,
        );
    });
});
