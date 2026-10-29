import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import {
    SPEEDING_STALE_MS,
    SpeedingEventModel,
} from "../models/speedingEvent.model";
import { stepSpeeding } from "../lib/speeding";
import { TripModel } from "../models/trip.model";
import { loginAs } from "./helpers";

const TICK_MS = 400;
const CITY_LIMIT = 50;
const OVER_CITY = 61;
const HIGH_OVER_CITY = 75;

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
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("stepSpeeding", () => {
    it("opens after 8s over the class limit and ends after hysteresis", () => {
        const start = 1_000_000;
        const state = stepSpeeding(undefined, {
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

    it("reports the place furthest over its limit, not the top speed", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 31",
            driver_name: "Ortsdurchfahrt",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");
        const start = 6_600_000;

        // Just over on the motorway, then 20 over in town: town is worse.
        patchAt(vehicle.id, 1, 121, start, 120);
        patchAt(vehicle.id, 1, 121, start + SPEEDING_OPEN_AFTER_MS, 120);
        patchAt(vehicle.id, 1, 70, start + SPEEDING_OPEN_AFTER_MS + 3_000, 50);
        patchAt(vehicle.id, 1, 65, start + SPEEDING_OPEN_AFTER_MS + 6_000, 50);

        const open = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(open.body.data[0].details.max_speed_kmh, 70);
        assert.equal(open.body.data[0].details.limit_kmh, 50);
        assert.match(open.body.data[0].message, /70 km\/h bei Limit 50/);

        const trip = await api.get(`/api/vehicles/${vehicle.id}/trips/latest`);
        assert.equal(trip.body.data.events[0].max_speed_kmh, 70);
        assert.equal(trip.body.data.events[0].limit_kmh, 50);
    });

    it("reports the limit of the worst place, not the limit of now", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 3",
            driver_name: "Ausfahrt",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");
        const start = 6_500_000;

        // Too fast on the motorway, still too fast on the exit into town.
        patchAt(vehicle.id, 1, 135, start, 120);
        patchAt(vehicle.id, 1, 144, start + SPEEDING_OPEN_AFTER_MS, 120);
        patchAt(vehicle.id, 1, 70, start + SPEEDING_OPEN_AFTER_MS + 3_000, 50);

        const open = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(open.body.data[0].details.max_speed_kmh, 144);
        assert.equal(open.body.data[0].details.limit_kmh, 120);
        assert.match(open.body.data[0].message, /144 km\/h bei Limit 120/);

        const trip = await api.get(`/api/vehicles/${vehicle.id}/trips/latest`);
        assert.equal(trip.body.data.events[0].max_speed_kmh, 144);
        assert.equal(trip.body.data.events[0].limit_kmh, 120);
    });

    it("ends an open event that gets no tick for a minute, not before", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 9",
            driver_name: "Stumm",
            status: "DRIVING",
            company_id: 1,
        });
        const start = 7_000_000;

        patchAt(vehicle.id, 1, OVER_CITY, start);
        patchAt(vehicle.id, 1, OVER_CITY, start + SPEEDING_OPEN_AFTER_MS);
        const lastTick = start + SPEEDING_OPEN_AFTER_MS;

        assert.deepEqual(
            SpeedingEventModel.endStale(lastTick + SPEEDING_STALE_MS - 1),
            [],
        );
        let rows = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(rows.body.data[0].ended_at, null);

        assert.deepEqual(
            SpeedingEventModel.endStale(lastTick + SPEEDING_STALE_MS),
            [1],
        );
        rows = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(typeof rows.body.data[0].ended_at, "string");
        assert.equal(rows.body.data[0].resolved_at, null);

        const car = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(car.body.speeding_open, false);
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

describe("one SPEEDING warning per trip", () => {
    const episode = (
        vehicleId: number,
        start: number,
        speed: number,
        seconds: number,
        limitKmh = CITY_LIMIT,
    ) => {
        patchAt(vehicleId, 1, speed, start, limitKmh);
        patchAt(vehicleId, 1, speed, start + SPEEDING_OPEN_AFTER_MS, limitKmh);
        patchAt(vehicleId, 1, speed, start + seconds * 1000, limitKmh);
        const below = start + seconds * 1000 + TICK_MS;
        patchAt(vehicleId, 1, limitKmh, below, limitKmh);
        patchAt(vehicleId, 1, limitKmh, below + SPEEDING_HYSTERESIS_MS, limitKmh);

        return below + SPEEDING_HYSTERESIS_MS;
    };

    it("keeps the place furthest over its limit when overshoots join", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 24",
            driver_name: "Autobahn und Stadt",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");

        // +10 on the motorway, +20 in town, +5 on the motorway: town is worst,
        // though 130 and 125 are the higher speeds.
        const afterMotorway = episode(vehicle.id, 6_000_000, 130, 10, 120);
        const afterCity = episode(vehicle.id, afterMotorway + 120_000, 70, 12);
        episode(vehicle.id, afterCity + 120_000, 125, 10, 120);

        const all = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(all.body.data.length, 1);
        assert.equal(all.body.data[0].details.event_count, 3);
        assert.equal(all.body.data[0].details.max_speed_kmh, 70);
        assert.equal(all.body.data[0].details.limit_kmh, 50);
        assert.match(all.body.data[0].message, /70 km\/h bei Limit 50/);
    });

    it("keeps the motorway overshoot when it is the worst", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 23",
            driver_name: "Stadt und Autobahn",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");

        const afterCity = episode(vehicle.id, 6_000_000, OVER_CITY, 10);
        const afterMotorway = episode(vehicle.id, afterCity + 120_000, 150, 12, 120);
        episode(vehicle.id, afterMotorway + 120_000, OVER_CITY, 10);

        const all = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(all.body.data.length, 1);
        assert.equal(all.body.data[0].details.max_speed_kmh, 150);
        assert.equal(all.body.data[0].details.limit_kmh, 120);
        assert.match(all.body.data[0].message, /150 km\/h bei Limit 120/);
    });

    it("joins later overshoots of the same trip into the one warning", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 20",
            driver_name: "Dauerfahrt",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");

        const afterFirst = episode(vehicle.id, 6_000_000, OVER_CITY, 10);
        const afterSecond = episode(vehicle.id, afterFirst + 120_000, HIGH_OVER_CITY, 20);
        episode(vehicle.id, afterSecond + 120_000, OVER_CITY, 12);

        const all = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(all.body.data.length, 1, "one row for the whole trip");

        const alert = all.body.data[0];
        assert.equal(alert.details.event_count, 3);
        assert.equal(alert.details.max_speed_kmh, HIGH_OVER_CITY);
        assert.equal(alert.severity, "HIGH");
        assert.ok(alert.details.duration_s >= 10 + 20 + 12, `duration ${alert.details.duration_s}`);
        assert.match(alert.message, /3-mal/);
        assert.equal(typeof alert.ended_at, "string");
        assert.equal(alert.resolved_at, null);
    });

    it("starts a new warning on the next trip", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 21",
            driver_name: "Zwei Fahrten",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");
        const end = episode(vehicle.id, 6_000_000, OVER_CITY, 10);

        TripModel.close(vehicle.id, "1970-01-02 00:00:00");
        TripModel.open(vehicle.id, "1970-01-03 00:00:00");
        episode(vehicle.id, end + 120_000, OVER_CITY, 10);

        const all = await api.get("/api/alerts").query({ filter: "all" });
        // The second episode lies before the new trip began in clock time, so it
        // cannot join the first warning: two rows.
        assert.equal(all.body.data.length, 2);
    });

    it("does not join an overshoot that was already resolved", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SP 22",
            driver_name: "Erledigt",
            status: "DRIVING",
            company_id: 1,
        });
        TripModel.open(vehicle.id, "1970-01-01 00:00:00");
        const end = episode(vehicle.id, 6_000_000, OVER_CITY, 10);

        const first = await api.get("/api/alerts").query({ filter: "all" });
        const resolved = await api
            .patch(`/api/alerts/${first.body.data[0].id}`)
            .send({ resolved: true });
        assert.equal(resolved.status, 200);

        episode(vehicle.id, end + 120_000, OVER_CITY, 10);

        const all = await api.get("/api/alerts").query({ filter: "all" });
        assert.equal(all.body.data.length, 2);
    });
});
