import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";

const TEST_PASSWORD = "secret-pass";

async function loginAs(
    companyId: number,
    role: "dispatcher" | "viewer" = "dispatcher",
) {
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
    return agent;
}

function insertAlert(
    vehicleId: number,
    input: {
        type?: string;
        severity?: string;
        message?: string;
        resolved_at?: string | null;
        ended_at?: string | null;
    } = {},
) {
    db.prepare(
        `
            INSERT INTO alerts (vehicle_id, type, severity, message, resolved_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
    ).run(
        vehicleId,
        input.type ?? "SPEEDING",
        input.severity ?? "HIGH",
        input.message ?? "zu schnell",
        input.resolved_at ?? null,
        input.ended_at ?? null,
    );
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = await loginAs(1);
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/drivers", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/drivers");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lists only this company's drivers with incident counts", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-OWN 1",
            driver_name: "Anna",
            company_id: 1,
        });
        VehicleModel.create({
            license_plate: "K-OWN 2",
            driver_name: "Anna",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-OTH 1",
            driver_name: "Anna",
            company_id: 2,
        });

        insertAlert(mine.id, { type: "SPEEDING" });
        insertAlert(mine.id, {
            type: "LOW_FUEL",
            resolved_at: "2026-01-01 00:00:00",
        });
        insertAlert(other.id, { type: "OFFLINE" });

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 1);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].name, "Anna");
        assert.equal(response.body.data[0].vehicle_count, 2);
        assert.equal(response.body.data[0].vehicle_plate, null);
        assert.equal(response.body.data[0].open_warnings, 1);
        assert.equal(response.body.data[0].counts.all, 2);
        assert.equal(response.body.data[0].counts.SPEEDING, 1);
        assert.equal(response.body.data[0].counts.LOW_FUEL, 1);
        assert.equal(response.body.data[0].counts.OFFLINE, 0);
    });

    it("counts zero open warnings when a driver has a vehicle but no alerts", async () => {
        VehicleModel.create({
            license_plate: "K-NONE 1",
            driver_name: "Ben",
            company_id: 1,
        });

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.data[0].open_warnings, 0);
        assert.equal(response.body.data[0].counts.all, 0);
        assert.equal(response.body.data[0].vehicle_count, 1);
        assert.equal(response.body.data[0].vehicle_plate, "K-NONE 1");
    });

    it("upserts the same name in one company and isolates names across companies", async () => {
        const first = VehicleModel.create({
            license_plate: "K-A 1",
            driver_name: "Clara",
            company_id: 1,
        });
        const second = VehicleModel.create({
            license_plate: "K-A 2",
            driver_name: "Clara",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-B 1",
            driver_name: "Clara",
            company_id: 2,
        });

        assert.equal(first.driver_id, second.driver_id);
        assert.notEqual(first.driver_id, other.driver_id);

        const otherApi = await loginAs(2);
        const mine = await api.get("/api/drivers");
        const theirs = await otherApi.get("/api/drivers");

        assert.equal(mine.body.data.length, 1);
        assert.equal(theirs.body.data.length, 1);
        assert.notEqual(mine.body.data[0].id, theirs.body.data[0].id);
    });

    it("lets a viewer read drivers", async () => {
        VehicleModel.create({
            license_plate: "K-VW 1",
            driver_name: "Viewer",
            company_id: 1,
        });

        const viewer = await loginAs(1, "viewer");
        const response = await viewer.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
    });
});

describe("GET /api/drivers/:id", () => {
    it("returns vehicles and type counts including resolved rows", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-D 1",
            driver_name: "Dana",
            company_id: 1,
        });
        insertAlert(vehicle.id, { type: "SPEEDING" });
        insertAlert(vehicle.id, {
            type: "SPEEDING",
            resolved_at: "2026-01-02 00:00:00",
            ended_at: "2026-01-02 00:00:00",
        });
        insertAlert(vehicle.id, { type: "OFFLINE" });

        const response = await api.get(`/api/drivers/${vehicle.driver_id}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.name, "Dana");
        assert.equal(response.body.data.counts.SPEEDING, 2);
        assert.equal(response.body.data.counts.OFFLINE, 1);
        assert.equal(response.body.data.counts.all, 3);
        assert.equal(response.body.data.open_warnings, 2);
        assert.equal(response.body.data.vehicles.length, 1);
        assert.equal(response.body.data.vehicles[0].license_plate, "K-D 1");
    });

    it("returns 404 for another company's driver", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 9",
            driver_name: "Fremde",
            company_id: 2,
        });

        const response = await api.get(`/api/drivers/${other.driver_id}`);

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
    });
});

describe("vehicle write upserts drivers", () => {
    it("creates a new driver row when the name changes", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-UP 1",
            driver_name: "Alt",
            fuel_level: 50,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        const originalId = created.body.driver_id as number;

        const updated = await api.patch(`/api/vehicles/${created.body.id}`).send({
            driver_name: "Neu",
        });

        assert.equal(updated.status, 200);
        assert.notEqual(updated.body.driver_id, originalId);
        assert.equal(updated.body.driver_name, "Neu");

        const old = DriverModel.getById(originalId, 1);
        assert.equal(old?.name, "Alt");
    });
});
