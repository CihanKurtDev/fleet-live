import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    LOW_FUEL_THRESHOLD_PERCENT,
    OFFLINE_AFTER_MS,
} from "@fleet-live/shared";
import { app } from "../app";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { setCompanySimRunning, resetSimControlForTests } from "../lib/simControl";

const TEST_PASSWORD = "secret-pass";

async function loginAs(companyId: number) {
    const email = `dispatcher-${companyId}@example.com`;

    if (!UserModel.findByEmail(email)) {
        UserModel.create({
            name: `dispatcher ${companyId}`,
            email,
            password: TEST_PASSWORD,
            company_id: companyId,
            role: "dispatcher",
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

function drivingPatch(
    vehicleId: number,
    companyId: number,
    fuelLevel: number,
    nowMs: number,
) {
    return ExceptionEventModel.applyPatches(
        [
            {
                id: vehicleId,
                company_id: companyId,
                speed: 40,
                speed_limit_kmh: 50,
                latitude: 50.9,
                longitude: 6.9,
                recorded_at: "2026-01-01 00:00:00",
                fuel_level: fuelLevel,
            },
        ],
        nowMs,
    );
}

function openInbox(api: ReturnType<typeof request.agent>, type: string) {
    return api.get("/api/alerts").query({ type });
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    ExceptionEventModel.resetForTests();
    resetSimControlForTests();
    api = await loginAs(1);
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
    resetSimControlForTests();
});

describe("live LOW_FUEL", () => {
    it("opens one row under the threshold and ends it after a refill", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-FU 1",
            driver_name: "Tank",
            company_id: 1,
            status: "DRIVING",
            fuel_level: 40,
        });
        const start = 1_000_000;

        const first = drivingPatch(
            vehicle.id,
            1,
            LOW_FUEL_THRESHOLD_PERCENT - 1,
            start,
        );
        assert.deepEqual(first, [1]);

        drivingPatch(vehicle.id, 1, 8, start + 400);
        const stillOpen = await openInbox(api, "LOW_FUEL");
        assert.equal(stillOpen.body.data.length, 1);
        assert.equal(stillOpen.body.data[0].type, "LOW_FUEL");
        assert.equal(stillOpen.body.data[0].ended_at, null);
        assert.equal(stillOpen.body.data[0].details.fuel_level, 8);
        assert.equal(stillOpen.body.data[0].message, "Tankstand 8 %");

        drivingPatch(vehicle.id, 1, LOW_FUEL_THRESHOLD_PERCENT, start + 800);
        const after = await openInbox(api, "LOW_FUEL");
        assert.equal(after.body.data.length, 1);
        assert.equal(typeof after.body.data[0].ended_at, "string");
        assert.equal(after.body.data[0].resolved_at, null);
    });

    it("does not leak another company's LOW_FUEL", async () => {
        const other = VehicleModel.create({
            license_plate: "K-FU 2",
            driver_name: "Fremd",
            company_id: 2,
            status: "DRIVING",
            fuel_level: 10,
        });
        drivingPatch(other.id, 2, 10, 1_000_000);

        const response = await openInbox(api, "LOW_FUEL");
        assert.equal(response.body.data.length, 0);
    });

    it("opens LOW_FUEL when a driving vehicle is created below the threshold", async () => {
        const response = await api.post("/api/vehicles").send({
            license_plate: "K-FU 3",
            driver_name: "Neu",
            fuel_level: 10,
            status: "DRIVING",
        });

        assert.equal(response.status, 201);
        assert.equal(response.body.active_alerts, 1);

        const inbox = await openInbox(api, "LOW_FUEL");
        assert.equal(inbox.body.data.length, 1);
        assert.equal(inbox.body.data[0].vehicle_id, response.body.id);
    });
});

describe("live OFFLINE", () => {
    it("opens after a paused company stops reporting, then ends when ticks resume", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-OF 1",
            driver_name: "Funk",
            company_id: 1,
            status: "DRIVING",
            fuel_level: 80,
        });
        const start = 2_000_000;
        drivingPatch(vehicle.id, 1, 80, start);

        setCompanySimRunning(1, false);
        assert.deepEqual(ExceptionEventModel.applySilence(start + 1_000), []);

        const opened = ExceptionEventModel.applySilence(
            start + OFFLINE_AFTER_MS,
        );
        assert.deepEqual(opened, [1]);

        const inbox = await openInbox(api, "OFFLINE");
        assert.equal(inbox.body.data.length, 1);
        assert.equal(inbox.body.data[0].ended_at, null);
        assert.equal(inbox.body.data[0].message, "Fahrzeug sendet kein Signal.");

        setCompanySimRunning(1, true);
        drivingPatch(vehicle.id, 1, 80, start + OFFLINE_AFTER_MS + 400);

        const after = await openInbox(api, "OFFLINE");
        assert.equal(after.body.data.length, 1);
        assert.equal(typeof after.body.data[0].ended_at, "string");
        assert.equal(after.body.data[0].resolved_at, null);
    });

    it("does not treat a running sim gap as lost signal", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-OF 2",
            driver_name: "Batch",
            company_id: 1,
            status: "DRIVING",
            fuel_level: 80,
        });
        const start = 3_000_000;
        drivingPatch(vehicle.id, 1, 80, start);

        const silent = ExceptionEventModel.applySilence(
            start + OFFLINE_AFTER_MS * 2,
        );
        assert.deepEqual(silent, []);

        const inbox = await openInbox(api, "OFFLINE");
        assert.equal(inbox.body.data.length, 0);
    });

    it("opens OFFLINE when status is set to OFFLINE", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-OF 3",
            driver_name: "Status",
            company_id: 1,
            status: "IDLE",
            fuel_level: 50,
        });

        const patched = await api.patch(`/api/vehicles/${vehicle.id}`).send({
            status: "OFFLINE",
        });
        assert.equal(patched.status, 200);
        assert.equal(patched.body.active_alerts, 1);

        const inbox = await openInbox(api, "OFFLINE");
        assert.equal(inbox.body.data.length, 1);
        assert.equal(inbox.body.data[0].ended_at, null);
    });
});
