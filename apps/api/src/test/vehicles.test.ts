import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { VehicleStatus } from "@fleet-live/shared";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
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
        assert.ok(response.body.meta.counts.lowFuel >= 1);
        assert.ok(response.body.meta.counts.driving >= 1);
        assert.ok(response.body.meta.counts.offline >= 1);
        assert.equal(response.body.meta.counts.alerts, 2);
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
    });

    it("rejects sort injection attempts", async () => {
        const response = await request(app)
            .get("/api/vehicles")
            .query({ sort: "id;DROP TABLE vehicles" });

        assert.equal(response.status, 400);
    });

    it("filters by search and active filter", async () => {
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

        const response = await request(app)
            .get("/api/vehicles")
            .query({ search: "clara", filter: "lowFuel" });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].driver_name, "Clara Conrad");
        assert.equal(response.body.meta.counts.all, 1);
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
    it("creates a vehicle and rejects a duplicate plate with 409", async () => {
        const created = await request(app).post("/api/vehicles").send({
            license_plate: "K-NEU 1",
            driver_name: "Neu Fahrer",
            fuel_level: 50,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.license_plate, "K-NEU 1");

        const duplicate = await request(app).post("/api/vehicles").send({
            license_plate: "K-NEU 1",
            driver_name: "Anderer Fahrer",
            fuel_level: 40,
            status: "IDLE",
        });

        assert.equal(duplicate.status, 409);
        assert.equal(
            duplicate.body.fields.license_plate,
            "Kennzeichen ist bereits vergeben.",
        );
    });

    it("returns 404 for a missing vehicle", async () => {
        const response = await request(app).get("/api/vehicles/999");
        assert.equal(response.status, 404);
    });
});

describe("GET /api/stream", () => {
    it("sends event-stream headers and a connected event", async () => {
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
            await reader.cancel();
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
});
