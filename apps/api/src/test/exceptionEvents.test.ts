import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    LOW_FUEL_THRESHOLD_PERCENT,
    OFFLINE_AFTER_MS,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { setCompanySimRunning, resetSimControlForTests } from "../lib/simControl";
import { db } from "../db/database";
import { syncLowFuelAlerts } from "../db/lowFuelAlerts";
import { giveCurrentDriver, insertAlert, loginAs } from "./helpers";

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
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
    resetSimControlForTests();
});

const lowFuelRows = (vehicleId: number) =>
    db
        .prepare(
            `SELECT id, severity, details, ended_at, resolved_at FROM alerts
             WHERE vehicle_id = ? AND type = 'LOW_FUEL' ORDER BY id`,
        )
        .all(vehicleId) as Array<{
        id: number;
        severity: string;
        details: string | null;
        ended_at: string | null;
        resolved_at: string | null;
    }>;

describe("LOW_FUEL follows the tank", () => {
    it("opens when a vehicle is saved under the threshold and goes away when it is filled", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-FU 3",
            fuel_level: 10,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.active_alerts, 1);
        assert.deepEqual(created.body.open_alert_types, ["LOW_FUEL"]);

        const open = await openInbox(api, "LOW_FUEL");
        assert.equal(open.body.data.length, 1);
        assert.equal(open.body.data[0].license_plate, "K-FU 3");
        assert.deepEqual(open.body.data[0].details, { fuel_level: 10 });

        // Lower, still low: the same row, with the new reading.
        const lower = await api
            .patch(`/api/vehicles/${created.body.id}`)
            .send({ fuel_level: 4 });
        assert.equal(lower.body.active_alerts, 1);
        const rows = lowFuelRows(created.body.id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].severity, "HIGH");
        assert.deepEqual(JSON.parse(rows[0].details ?? "{}"), { fuel_level: 4 });

        // Filled: the warning is gone, not waiting for a click.
        const filled = await api
            .patch(`/api/vehicles/${created.body.id}`)
            .send({ fuel_level: 80 });
        assert.equal(filled.body.active_alerts, 0);
        assert.deepEqual(filled.body.open_alert_types, []);
        assert.equal((await openInbox(api, "LOW_FUEL")).body.data.length, 0);
        const [closed] = lowFuelRows(created.body.id);
        assert.notEqual(closed.resolved_at, null);
        assert.notEqual(closed.ended_at, null);

        // Under the threshold again: a new warning.
        const again = await api
            .patch(`/api/vehicles/${created.body.id}`)
            .send({ fuel_level: LOW_FUEL_THRESHOLD_PERCENT - 1 });
        assert.equal(again.body.active_alerts, 1);
        assert.equal(lowFuelRows(created.body.id).length, 2);
    });

    it("is not closed by hand: the vehicle is still low", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-FU 4",
            fuel_level: 9,
            status: "IDLE",
        });
        const [row] = lowFuelRows(created.body.id);

        const single = await api
            .patch(`/api/alerts/${row.id}`)
            .send({ resolved: true });
        assert.equal(single.status, 200);
        assert.equal(single.body.resolved_at, null);

        const bulk = await api
            .patch("/api/alerts")
            .send({ ids: [row.id], resolved: true });
        assert.equal(bulk.status, 200);
        assert.equal(bulk.body.data.resolved, 0);
        assert.equal(lowFuelRows(created.body.id)[0].resolved_at, null);
    });

    it("sets old rows right: one open warning per low vehicle, none for a full tank", () => {
        const make = (plate: string, fuel: number) =>
            VehicleModel.create({
                license_plate: plate,
                company_id: 1,
                status: "IDLE",
                fuel_level: fuel,
            });
        const clickedAway = make("K-FU 10", 8);
        const stale = make("K-FU 11", 9);
        const filledUp = make("K-FU 12", 70);
        const fine = make("K-FU 13", 60);
        // Resolved by a click while the tank was still low (the old behaviour).
        insertAlert(clickedAway.id, {
            type: "LOW_FUEL",
            resolved_at: "2026-01-02 00:00:00",
        });
        // Ended, never resolved.
        insertAlert(stale.id, {
            type: "LOW_FUEL",
            ended_at: "2026-01-03 00:00:00",
        });
        // Still open, but the tank was filled since.
        insertAlert(filledUp.id, { type: "LOW_FUEL" });

        syncLowFuelAlerts(db);

        const openOf = (id: number) =>
            lowFuelRows(id).filter((row) => row.resolved_at === null);

        assert.equal(openOf(clickedAway.id).length, 1);
        assert.equal(openOf(stale.id).length, 1);
        assert.equal(openOf(filledUp.id).length, 0);
        assert.equal(lowFuelRows(fine.id).length, 0);
        assert.equal(VehicleModel.getById(clickedAway.id, 1)?.active_alerts, 1);
        assert.equal(VehicleModel.getById(stale.id, 1)?.active_alerts, 1);
        assert.equal(VehicleModel.getById(filledUp.id, 1)?.active_alerts, 0);

        // A second run changes nothing.
        const before = db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as {
            n: number;
        };
        syncLowFuelAlerts(db);
        const after = db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as {
            n: number;
        };
        assert.equal(after.n, before.n);
    });
});

describe("the ticker does not touch LOW_FUEL", () => {
    it("does not open LOW_FUEL from telemetry patches", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-FU 1",
            driver_name: "Tank",
            company_id: 1,
            status: "DRIVING",
            fuel_level: 40,
        });
        const start = 1_000_000;

        assert.deepEqual(
            drivingPatch(
                vehicle.id,
                1,
                LOW_FUEL_THRESHOLD_PERCENT - 1,
                start,
            ),
            [],
        );

        const inbox = await openInbox(api, "LOW_FUEL");
        assert.equal(inbox.body.data.length, 0);

        const detail = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.deepEqual(detail.body.open_alert_types, []);
    });

    it("does not open a second LOW_FUEL when a low vehicle starts driving", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-FU 5",
            fuel_level: 10,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        await giveCurrentDriver(api, created.body.id, "Neu");

        const response = await api
            .patch(`/api/vehicles/${created.body.id}`)
            .send({ status: "DRIVING" });

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "DRIVING");
        assert.equal(response.body.active_alerts, 1);
        assert.equal(lowFuelRows(created.body.id).length, 1);
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

    it("ends OFFLINE only for the vehicles that report in one tick", async () => {
        const [first, second, silent] = ["K-OF 7", "K-OF 8", "K-OF 9"].map(
            (plate) =>
                VehicleModel.create({
                    license_plate: plate,
                    driver_name: "Funk",
                    company_id: 1,
                    status: "DRIVING",
                    fuel_level: 80,
                }),
        );
        const start = 3_000_000;

        for (const vehicle of [first!, second!, silent!]) {
            drivingPatch(vehicle.id, 1, 80, start);
        }

        setCompanySimRunning(1, false);
        ExceptionEventModel.applySilence(start + OFFLINE_AFTER_MS);
        setCompanySimRunning(1, true);

        ExceptionEventModel.applyPatches(
            [first!, second!].map((vehicle) => ({
                id: vehicle.id,
                company_id: 1,
                speed: 40,
                speed_limit_kmh: 50,
                latitude: 50.9,
                longitude: 6.9,
                recorded_at: "2026-01-01 00:00:00",
                fuel_level: 80,
            })),
            start + OFFLINE_AFTER_MS + 400,
        );

        const rows = await openInbox(api, "OFFLINE");
        const endedByPlate = new Map<string, unknown>(
            rows.body.data.map((row: { license_plate: string; ended_at: unknown }) => [
                row.license_plate,
                row.ended_at,
            ]),
        );

        assert.equal(typeof endedByPlate.get("K-OF 7"), "string");
        assert.equal(typeof endedByPlate.get("K-OF 8"), "string");
        assert.equal(endedByPlate.get("K-OF 9"), null);
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
