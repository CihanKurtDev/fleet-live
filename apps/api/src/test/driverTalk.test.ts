import "./env";
import assert from "node:assert/strict";
import { DRIVER_TALK_NOTE_MAX } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { TripModel } from "../models/trip.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { giveCurrentDriver, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

function speeding(vehicleId: number, driverId: number, resolved = false) {
    const result = db
        .prepare(
            // Ended runs (only one may be running per vehicle), still open in the inbox.
            `INSERT INTO alerts (vehicle_id, driver_id, type, severity, message, ended_at, resolved_at)
             VALUES (?, ?, 'SPEEDING', 'HIGH', '70 km/h bei Limit 50', '2026-11-01 08:20:00', ?)`,
        )
        .run(vehicleId, driverId, resolved ? "2026-10-01 10:00:00" : null);
    return Number(result.lastInsertRowid);
}

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("POST /api/drivers/:id/talk", () => {
    it("resolves every open Tempo warning of the driver with a note, nothing else", async () => {
        const car = VehicleModel.create({ license_plate: "K-GS 1", company_id: 1 });
        const other = VehicleModel.create({ license_plate: "K-GS 2", company_id: 1 });
        const driverId = await giveCurrentDriver(api, car.id, "Gesa Gespräch");
        const otherDriver = await giveCurrentDriver(api, other.id, "Otto Andere");
        const open = [speeding(car.id, driverId), speeding(car.id, driverId)];
        speeding(car.id, driverId, true);
        const foreign = speeding(other.id, otherDriver);

        const talked = await api
            .post(`/api/drivers/${driverId}/talk`)
            .send({ note: "Strecke Ring besprochen" });
        assert.equal(talked.status, 200);
        assert.equal(talked.body.data.resolved, 2);

        const rows = (await api.get("/api/alerts").query({ filter: "all", driver_id: driverId })).body.data as {
            id: number;
            resolved_at: string | null;
            resolution_note: string | null;
        }[];
        for (const id of open) {
            const row = rows.find((alert) => alert.id === id);
            assert.ok(row?.resolved_at);
            assert.match(row?.resolution_note ?? "", /^Gespräch geführt am \d{2}\.\d{2}\.\d{4}: Strecke Ring besprochen$/);
        }
        const untouched = (await api.get("/api/alerts").query({ filter: "open", driver_id: otherDriver })).body.data;
        assert.deepEqual(
            untouched.map((alert: { id: number }) => alert.id),
            [foreign],
        );

        const again = await api.post(`/api/drivers/${driverId}/talk`).send({});
        assert.equal(again.body.data.resolved, 0);
    });

    it("validates the note and keeps viewers and other companies out", async () => {
        const car = VehicleModel.create({ license_plate: "K-GS 3", company_id: 1 });
        const driverId = await giveCurrentDriver(api, car.id, "Gesa Grenze");

        const long = await api.post(`/api/drivers/${driverId}/talk`).send({ note: "x".repeat(DRIVER_TALK_NOTE_MAX + 1) });
        assert.equal(long.status, 400);

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.post(`/api/drivers/${driverId}/talk`).send({})).status, 403);
        const other = (await loginAs(2)).agent;
        assert.equal((await other.post(`/api/drivers/${driverId}/talk`).send({})).status, 404);
        assert.equal((await request(app).post(`/api/drivers/${driverId}/talk`).send({})).status, 401);
    });
});

describe("an alert names its trip", () => {
    it("carries trip_id from the trip event, null without one", async () => {
        const car = VehicleModel.create({ license_plate: "K-GS 4", company_id: 1 });
        const driverId = await giveCurrentDriver(api, car.id, "Tara Trip");
        const trip = TripModel.open(car.id, "2026-11-01 08:00:00");
        const withTrip = speeding(car.id, driverId);
        const withoutTrip = speeding(car.id, driverId);
        db.prepare(
            `INSERT INTO trip_events (trip_id, type, alert_id, started_at, from_m)
             VALUES (?, 'SPEEDING', ?, '2026-11-01 08:10:00', 1200)`,
        ).run(Number(trip.id), withTrip);

        const rows = (await api.get("/api/alerts").query({ filter: "all", vehicle_id: car.id })).body.data as {
            id: number;
            trip_id: number | null;
        }[];
        assert.equal(rows.find((row) => row.id === withTrip)?.trip_id, Number(trip.id));
        assert.equal(rows.find((row) => row.id === withoutTrip)?.trip_id, null);
    });
});
