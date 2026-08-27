import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { VehicleStatus } from "@fleet-live/shared";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { TelemetryModel } from "../models/telemetry.model";
import { VehicleModel } from "../models/vehicle.model";

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

afterEach(() => {
    VehicleModel.resetForTests();
});

describe("GET /api/vehicles", () => {
    it("paginates and returns facet counts", async () => {
        seedFleet(12);

        const response = await request(app)
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

        const response = await request(app)
            .get("/api/vehicles")
            .query({ page: 9, limit: 10 });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.meta.total, 3);
        assert.equal(response.body.meta.pageCount, 1);
    });

    it("rejects a limit outside the allowlist", async () => {
        const response = await request(app)
            .get("/api/vehicles")
            .query({ limit: 7 });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });

    it("rejects sort injection attempts", async () => {
        const response = await request(app)
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

        const filtered = await request(app)
            .get("/api/vehicles")
            .query({ search: "clara", filter: "low_fuel" });

        assert.equal(filtered.status, 200);
        assert.equal(filtered.body.data.length, 1);
        assert.equal(filtered.body.data[0].driver_name, "Clara Conrad");
        assert.equal(filtered.body.meta.counts.all, 1);
        assert.equal(filtered.body.meta.counts.low_fuel, 1);

        const sorted = await request(app)
            .get("/api/vehicles")
            .query({ sort: "active_alerts", dir: "desc" });

        assert.equal(sorted.status, 200);
    });

    it("responds 304 when If-None-Match matches the ETag", async () => {
        seedFleet(3);

        const first = await request(app)
            .get("/api/vehicles")
            .set("Accept-Encoding", "identity");

        assert.equal(first.status, 200);
        const etag = first.headers.etag;
        assert.ok(etag);

        const second = await request(app)
            .get("/api/vehicles")
            .set("Accept-Encoding", "identity")
            .set("If-None-Match", etag);

        assert.equal(second.status, 304);
    });
});

describe("vehicle mutations", () => {
    it("creates a vehicle with Location and rejects a duplicate plate with 409", async () => {
        const created = await request(app).post("/api/vehicles").send({
            license_plate: "K-NEU 1",
            driver_name: "Neu Fahrer",
            fuel_level: 50,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.license_plate, "K-NEU 1");
        assert.equal(created.body.active_alerts, 0);
        assert.ok(created.body.created_at);
        assert.equal(
            created.headers.location,
            `/api/vehicles/${created.body.id}`,
        );

        const duplicate = await request(app).post("/api/vehicles").send({
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
        const missing = await request(app).post("/api/vehicles").send({
            fuel_level: 40,
        });

        assert.equal(missing.status, 400);
        assert.equal(missing.body.fields.license_plate, "Kennzeichen ist erforderlich.");
        assert.equal(missing.body.fields.driver_name, "Fahrer ist erforderlich.");

        const tooLong = await request(app).post("/api/vehicles").send({
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
        const response = await request(app).get("/api/vehicles/abc");
        assert.equal(response.status, 400);
        assert.equal(response.body.error, "Ungültige Fahrzeug-ID.");
    });

    it("returns 404 for a missing vehicle", async () => {
        const response = await request(app).get("/api/vehicles/999");
        assert.equal(response.status, 404);
        assert.equal(response.body.error, "Fahrzeug nicht gefunden.");
    });

    it("replaces, patches and deletes a vehicle", async () => {
        const created = await request(app).post("/api/vehicles").send({
            license_plate: "K-ED 1",
            driver_name: "Edit Fahrer",
            fuel_level: 40,
            status: "IDLE",
        });

        const id = created.body.id;

        const replaced = await request(app).put(`/api/vehicles/${id}`).send({
            license_plate: "K-ED 2",
            driver_name: "Neuer Fahrer",
            fuel_level: 70,
            status: "DRIVING",
        });

        assert.equal(replaced.status, 200);
        assert.equal(replaced.body.license_plate, "K-ED 2");
        assert.equal(replaced.body.status, "DRIVING");

        const emptyPatch = await request(app)
            .patch(`/api/vehicles/${id}`)
            .send({});

        assert.equal(emptyPatch.status, 400);
        assert.equal(
            emptyPatch.body.error,
            "Mindestens ein Feld ist erforderlich.",
        );

        const patched = await request(app)
            .patch(`/api/vehicles/${id}`)
            .send({ fuel_level: 12 });

        assert.equal(patched.status, 200);
        assert.equal(patched.body.fuel_level, 12);
        assert.equal(patched.body.license_plate, "K-ED 2");

        const deleted = await request(app).delete(`/api/vehicles/${id}`);
        assert.equal(deleted.status, 204);

        const missing = await request(app).get(`/api/vehicles/${id}`);
        assert.equal(missing.status, 404);
    });
});

describe("GET /api/vehicles/:id/telemetry", () => {
    it("returns 404 for a missing vehicle", async () => {
        const response = await request(app).get("/api/vehicles/999/telemetry");
        assert.equal(response.status, 404);
    });

    it("returns an empty list when a vehicle has no points", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TM 1",
            driver_name: "Ohne Punkte",
        });

        const response = await request(app).get(
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

        const response = await request(app)
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
            const response = await fetch(`http://127.0.0.1:${port}/api/stream`);

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

            const focused = await request(app)
                .post("/api/stream/focus")
                .send({ connection_id: payload.connection_id, ids: [1] });

            assert.equal(focused.status, 200);
            assert.equal(focused.body.ok, true);
            assert.equal(focused.body.count, 1);

            const unknown = await request(app)
                .post("/api/stream/focus")
                .send({
                    connection_id: "00000000-0000-4000-8000-000000000001",
                    ids: [1],
                });

            assert.equal(unknown.status, 400);
            assert.equal(unknown.body.error, "Unbekannte Verbindung.");

            const invalid = await request(app)
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
});
