import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
} from "@fleet-live/shared";
import { app } from "../app";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { stepSpeeding } from "../lib/speeding";

const TEST_PASSWORD = "secret-pass";
const TICK_MS = 400;
const CITY_LIMIT = 50;
const OVER_CITY = 61;
const HIGH_OVER_CITY = 75;

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

function patchAt(
    vehicleId: number,
    companyId: number,
    speed: number,
    nowMs: number,
    limitKmh = CITY_LIMIT,
) {
    return SpeedingEventModel.applyPatches(
        [
            {
                id: vehicleId,
                company_id: companyId,
                speed,
                speed_limit_kmh: limitKmh,
                latitude: 50.9,
                longitude: 6.9,
                recorded_at: "2026-01-01 00:00:00",
                fuel_level: 80,
            },
        ],
        nowMs,
    );
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    SpeedingEventModel.resetForTests();
    api = await loginAs(1);
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("stepSpeeding", () => {
    it("opens after 8s over the class limit and ends after hysteresis", () => {
        const start = 1_000_000;
        let state = stepSpeeding(undefined, {
            speed: OVER_CITY,
            status: "DRIVING",
            nowMs: start,
            limit_kmh: CITY_LIMIT,
        }).state;

        const beforeOpen = stepSpeeding(state, {
            speed: OVER_CITY,
            status: "DRIVING",
            nowMs: start + SPEEDING_OPEN_AFTER_MS - 1,
            limit_kmh: CITY_LIMIT,
        });
        assert.equal(beforeOpen.action, "none");
        assert.equal(beforeOpen.state?.phase, "candidate");

        const opened = stepSpeeding(beforeOpen.state, {
            speed: HIGH_OVER_CITY,
            status: "DRIVING",
            nowMs: start + SPEEDING_OPEN_AFTER_MS,
            limit_kmh: CITY_LIMIT,
        });
        assert.equal(opened.action, "open");
        assert.equal(opened.state?.phase, "open");
        assert.equal(opened.state?.maxSpeed, HIGH_OVER_CITY);

        const below = stepSpeeding(opened.state, {
            speed: CITY_LIMIT,
            status: "DRIVING",
            nowMs: start + SPEEDING_OPEN_AFTER_MS + TICK_MS,
            limit_kmh: CITY_LIMIT,
        });
        assert.equal(below.action, "none");
        assert.equal(below.state?.phase, "open");

        const ended = stepSpeeding(below.state, {
            speed: CITY_LIMIT,
            status: "DRIVING",
            nowMs:
                start +
                SPEEDING_OPEN_AFTER_MS +
                TICK_MS +
                SPEEDING_HYSTERESIS_MS,
            limit_kmh: CITY_LIMIT,
        });
        assert.equal(ended.action, "end");
        assert.equal(ended.state, undefined);
    });

    it("drops a candidate that falls below the threshold before 8s", () => {
        const start = 1_000_000;
        const candidate = stepSpeeding(undefined, {
            speed: OVER_CITY,
            status: "DRIVING",
            nowMs: start,
            limit_kmh: CITY_LIMIT,
        }).state;
        const dropped = stepSpeeding(candidate, {
            speed: CITY_LIMIT,
            status: "DRIVING",
            nowMs: start + 2_000,
            limit_kmh: CITY_LIMIT,
        });
        assert.equal(dropped.action, "none");
        assert.equal(dropped.state, undefined);
    });

    it("does not treat highway speed as speeding against a highway limit", () => {
        const start = 1_000_000;
        const step = stepSpeeding(undefined, {
            speed: 120,
            status: "DRIVING",
            nowMs: start,
            limit_kmh: 120,
        });
        assert.equal(step.action, "none");
        assert.equal(step.state, undefined);
    });

    it("ends immediately when the vehicle is not driving", () => {
        const opened = stepSpeeding(
            {
                phase: "open",
                startedAtMs: 0,
                maxSpeed: 100,
                alertId: 1,
            },
            {
                speed: 100,
                status: "IDLE",
                nowMs: 10_000,
                limit_kmh: CITY_LIMIT,
            },
        );
        assert.equal(opened.action, "end");
    });
});

describe("SPEEDING events", () => {
    it("does not create a row before 8s over the class limit", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 1",
            driver_name: "Tempo",
            status: "DRIVING",
            company_id: 1,
        });
        const start = 5_000_000;

        patchAt(vehicle.id, 1, OVER_CITY, start);
        patchAt(vehicle.id, 1, OVER_CITY, start + SPEEDING_OPEN_AFTER_MS - TICK_MS);

        const response = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 0);

        const detail = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(detail.body.speeding_open, false);
    });

    it("opens one row after 8s, updates max and duration, and ends without resolving", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 2",
            driver_name: "Tempo",
            status: "DRIVING",
            company_id: 1,
        });
        const start = 6_000_000;

        patchAt(vehicle.id, 1, OVER_CITY, start);
        patchAt(vehicle.id, 1, OVER_CITY, start + SPEEDING_OPEN_AFTER_MS);
        patchAt(vehicle.id, 1, HIGH_OVER_CITY, start + SPEEDING_OPEN_AFTER_MS + 3_000);

        const open = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(open.status, 200);
        assert.equal(open.body.data.length, 1);
        assert.equal(open.body.data[0].type, "SPEEDING");
        assert.equal(open.body.data[0].ended_at, null);
        assert.equal(open.body.data[0].resolved_at, null);
        assert.equal(open.body.data[0].severity, "HIGH");
        assert.equal(open.body.data[0].details.limit_kmh, CITY_LIMIT);
        assert.equal(open.body.data[0].details.max_speed_kmh, HIGH_OVER_CITY);
        assert.equal(open.body.data[0].details.duration_s, 11);
        assert.match(open.body.data[0].message, /75 km\/h bei Limit 50/);

        const whileOpen = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(whileOpen.body.speeding_open, true);
        assert.equal(whileOpen.body.active_alerts, 1);
        assert.deepEqual(whileOpen.body.open_alert_types, ["SPEEDING"]);

        const belowAt = start + SPEEDING_OPEN_AFTER_MS + 3_000 + TICK_MS;
        patchAt(vehicle.id, 1, CITY_LIMIT, belowAt);
        patchAt(vehicle.id, 1, CITY_LIMIT, belowAt + SPEEDING_HYSTERESIS_MS);

        const ended = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(ended.body.data.length, 1);
        assert.equal(typeof ended.body.data[0].ended_at, "string");
        assert.equal(ended.body.data[0].resolved_at, null);

        const inbox = await api.get("/api/alerts");
        assert.equal(inbox.body.data.length, 1);
        assert.equal(inbox.body.meta.counts.open, 1);

        const afterEnd = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(afterEnd.body.speeding_open, false);
        assert.equal(afterEnd.body.active_alerts, 1);
    });

    it("keeps a single open SPEEDING row per vehicle", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 3",
            driver_name: "Tempo",
            status: "DRIVING",
            company_id: 1,
        });
        const start = 7_000_000;

        for (let elapsed = 0; elapsed <= SPEEDING_OPEN_AFTER_MS + 4_000; elapsed += TICK_MS) {
            patchAt(vehicle.id, 1, OVER_CITY, start + elapsed);
        }

        const response = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(response.body.data.length, 1);
    });

    it("ends the event when the vehicle leaves DRIVING", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 4",
            driver_name: "Tempo",
            status: "DRIVING",
            company_id: 1,
        });
        const start = 8_000_000;
        patchAt(vehicle.id, 1, OVER_CITY, start);
        patchAt(vehicle.id, 1, OVER_CITY, start + SPEEDING_OPEN_AFTER_MS);

        SpeedingEventModel.endForVehicle(vehicle.id, start + SPEEDING_OPEN_AFTER_MS + 500);

        const response = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(response.body.data[0].ended_at !== null, true);
        assert.equal(response.body.data[0].resolved_at, null);
    });

    it("does not leak another company's event", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-SP 5",
            driver_name: "Tempo",
            status: "DRIVING",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-SP X",
            driver_name: "Fremde",
            status: "DRIVING",
            company_id: 2,
        });
        const start = 9_000_000;
        patchAt(other.id, 2, HIGH_OVER_CITY, start);
        patchAt(other.id, 2, HIGH_OVER_CITY, start + SPEEDING_OPEN_AFTER_MS);
        patchAt(mine.id, 1, OVER_CITY, start);
        patchAt(mine.id, 1, OVER_CITY, start + SPEEDING_OPEN_AFTER_MS);

        const response = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].vehicle_id, mine.id);
    });
});
