import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    OFFLINE_AFTER_MS,
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
} from "@fleet-live/shared";
import { db } from "../db/database";
import { backfillTripHistory } from "../db/tripEvents";
import { resetSimControlForTests, setCompanySimRunning } from "../lib/simControl";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { TripModel } from "../models/trip.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

const LIMIT = 50;

let api: ReturnType<typeof request.agent>;
/** Each step drives about 1.1 km north. */
let lat = 50.9;

function drive(vehicleId: number) {
    lat += 0.01;
    TripModel.appendPoints(vehicleId, [{ lat, lng: 6.9 }], 60);
}

function tick(vehicleId: number, speed: number, nowMs: number) {
    const patch = {
        id: vehicleId,
        company_id: 1,
        speed,
        speed_limit_kmh: LIMIT,
        latitude: lat,
        longitude: 6.9,
        recorded_at: "2026-01-01 00:00:00",
        fuel_level: 80,
    };
    SpeedingEventModel.applyPatches([patch], nowMs);
    ExceptionEventModel.applyPatches([patch], nowMs);
}

function drivingVehicle(plate: string) {
    const vehicle = VehicleModel.create({
        license_plate: plate,
        driver_name: "Erika Muster",
        status: "DRIVING",
        company_id: 1,
    });
    lat = 50.9;
    TripModel.appendPoints(vehicle.id, [{ lat, lng: 6.9 }], 0);
    return vehicle;
}

const openTrip = (vehicleId: number) =>
    db
        .prepare(`SELECT id, distance_m FROM trips WHERE vehicle_id = ? AND ended_at IS NULL`)
        .get(vehicleId) as { id: number; distance_m: number };

beforeEach(async () => {
    SpeedingEventModel.resetForTests();
    ExceptionEventModel.resetForTests();
    resetSimControlForTests();
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
    resetSimControlForTests();
});

describe("trip events", () => {
    it("records where a speeding run starts and ends on the trip", async () => {
        const vehicle = drivingVehicle("K-TE 1");
        const start = 9_000_000;

        drive(vehicle.id);
        const before = openTrip(vehicle.id).distance_m;
        // First tick over the limit: the run starts here, 8 s before the warning.
        tick(vehicle.id, 70, start);
        drive(vehicle.id);
        tick(vehicle.id, 92, start + SPEEDING_OPEN_AFTER_MS);
        drive(vehicle.id);
        tick(vehicle.id, 80, start + SPEEDING_OPEN_AFTER_MS + 1_000);
        drive(vehicle.id);
        const atEnd = openTrip(vehicle.id).distance_m;
        tick(vehicle.id, 40, start + SPEEDING_OPEN_AFTER_MS + 2_000);
        tick(
            vehicle.id,
            40,
            start + SPEEDING_OPEN_AFTER_MS + 2_000 + SPEEDING_HYSTERESIS_MS,
        );

        const trip = openTrip(vehicle.id);
        const detail = await api.get(`/api/vehicles/${vehicle.id}/trips/${trip.id}`);

        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.events.length, 1);
        const [event] = detail.body.data.events;
        assert.equal(event.type, "SPEEDING");
        assert.ok(Math.abs(event.from_m - before) < 1);
        assert.ok(Math.abs(event.to_m - atEnd) < 1);
        assert.equal(event.max_speed_kmh, 92);
        assert.equal(event.limit_kmh, LIMIT);
        assert.equal(event.estimated, false);
        assert.equal(event.alert_open, true);
        assert.equal(typeof event.ended_at, "string");
        assert.equal(detail.body.data.driver_name, "Erika Muster");
        assert.equal(detail.body.data.speeding_count, 1);
    });

    it("counts each run of one trip and lists the trip's driver", async () => {
        const vehicle = drivingVehicle("K-TE 2");
        let now = 10_000_000;

        for (let run = 0; run < 2; run += 1) {
            drive(vehicle.id);
            tick(vehicle.id, 80, now);
            tick(vehicle.id, 80, (now += SPEEDING_OPEN_AFTER_MS));
            drive(vehicle.id);
            tick(vehicle.id, 40, (now += 1_000));
            tick(vehicle.id, 40, (now += SPEEDING_HYSTERESIS_MS));
            now += 5_000;
        }

        const list = await api.get(`/api/vehicles/${vehicle.id}/trips`);

        assert.equal(list.status, 200);
        assert.equal(list.body.data[0].speeding_count, 2);
        assert.equal(list.body.data[0].offline_count, 0);
        assert.equal(list.body.data[0].driver_name, "Erika Muster");

        const detail = await api.get(
            `/api/vehicles/${vehicle.id}/trips/${list.body.data[0].id}`,
        );
        const events = detail.body.data.events as Array<{ from_m: number }>;

        assert.equal(events.length, 2);
        assert.ok(events[0]!.from_m < events[1]!.from_m);
    });

    it("ends a running run where the trip closes", async () => {
        const vehicle = drivingVehicle("K-TE 3");
        const start = 11_000_000;

        drive(vehicle.id);
        tick(vehicle.id, 80, start);
        tick(vehicle.id, 80, start + SPEEDING_OPEN_AFTER_MS);
        drive(vehicle.id);
        const { id, distance_m } = openTrip(vehicle.id);
        TripModel.close(vehicle.id);

        const detail = await api.get(`/api/vehicles/${vehicle.id}/trips/${id}`);
        const [event] = detail.body.data.events;

        assert.equal(typeof event.ended_at, "string");
        assert.ok(Math.abs(event.to_m - distance_m) < 1);
    });

    it("marks where the signal was lost during the trip", async () => {
        const vehicle = drivingVehicle("K-TE 4");
        const start = 12_000_000;

        drive(vehicle.id);
        tick(vehicle.id, 40, start);
        const at = openTrip(vehicle.id).distance_m;

        setCompanySimRunning(1, false);
        ExceptionEventModel.applySilence(start + OFFLINE_AFTER_MS);
        setCompanySimRunning(1, true);
        drive(vehicle.id);
        tick(vehicle.id, 40, start + OFFLINE_AFTER_MS + 5_000);

        const trip = openTrip(vehicle.id);
        const detail = await api.get(`/api/vehicles/${vehicle.id}/trips/${trip.id}`);
        const [event] = detail.body.data.events;

        assert.equal(event.type, "OFFLINE");
        assert.ok(Math.abs(event.from_m - at) < 1);
        assert.equal(event.to_m, event.from_m);
        assert.equal(typeof event.ended_at, "string");
        assert.equal(detail.body.data.offline_count, 1);
    });

    it("places the warnings of older trips by their time, marked as estimated", async () => {
        const vehicle = drivingVehicle("K-TE 5");
        const trip = db
            .prepare(
                `INSERT INTO trips (vehicle_id, started_at, ended_at, distance_m)
                 VALUES (?, '2026-10-20 08:00:00', '2026-10-20 09:00:00', 40000)`,
            )
            .run(vehicle.id);
        const tripId = Number(trip.lastInsertRowid);
        insertAlert(vehicle.id, {
            created_at: "2026-10-20 08:15:00",
            ended_at: "2026-10-20 08:20:00",
            resolved_at: "2026-10-20 10:00:00",
        });

        backfillTripHistory(db);
        backfillTripHistory(db);

        const detail = await api.get(`/api/vehicles/${vehicle.id}/trips/${tripId}`);
        const events = detail.body.data.events as Array<{
            from_m: number;
            to_m: number | null;
            estimated: boolean;
            alert_open: boolean;
        }>;

        assert.equal(events.length, 1);
        assert.equal(events[0]!.estimated, true);
        assert.equal(Math.round(events[0]!.from_m), 10000);
        assert.equal(events[0]!.to_m, null);
        assert.equal(events[0]!.alert_open, false);
        assert.equal(detail.body.data.driver_name, "Erika Muster");
    });

    it("gives a run that went on across a turnaround to the next trip too", async () => {
        const vehicle = drivingVehicle("K-TE 6");
        const insertTrip = (startedAt: string, endedAt: string) =>
            Number(
                db
                    .prepare(
                        `INSERT INTO trips (vehicle_id, started_at, ended_at, distance_m)
                         VALUES (?, ?, ?, 30000)`,
                    )
                    .run(vehicle.id, startedAt, endedAt).lastInsertRowid,
            );
        const first = insertTrip("2026-10-21 08:00:00", "2026-10-21 08:30:00");
        const second = insertTrip("2026-10-21 08:30:05", "2026-10-21 09:00:00");
        const later = insertTrip("2026-10-21 10:00:00", "2026-10-21 10:30:00");
        db.prepare(
            `INSERT INTO alerts (vehicle_id, driver_id, type, severity, message, details, created_at, ended_at, resolved_at)
             VALUES (?, ?, 'SPEEDING', 'HIGH', 'zu schnell', ?, '2026-10-21 08:20:00', '2026-10-21 08:45:00', '2026-10-21 12:00:00')`,
        ).run(
            vehicle.id,
            vehicle.current_driver_id,
            JSON.stringify({ limit_kmh: 50, max_speed_kmh: 90, duration_s: 900, event_count: 3 }),
        );

        backfillTripHistory(db);

        const events = async (tripId: number) =>
            (await api.get(`/api/vehicles/${vehicle.id}/trips/${tripId}`)).body.data;
        const [a, b, c] = await Promise.all([first, second, later].map(events));

        // Began on the first trip: the whole warning, about two thirds in.
        assert.equal(a.events.length, 1);
        assert.equal(a.events[0].count, 3);
        assert.equal(Math.round(a.events[0].from_m), 20000);
        // Carried on into the second: one run from its start.
        assert.equal(b.events.length, 1);
        assert.equal(b.events[0].count, 1);
        assert.equal(b.events[0].from_m, 0);
        assert.equal(b.speeding_count, 1);
        assert.equal(b.driver_name, "Erika Muster");
        assert.equal(c.events.length, 0);
    });
});
