import "./env";
import assert from "node:assert/strict";
import { TODAY_KINDS } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { DriverModel } from "../models/driver.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

/** One task of every kind in company 1, plus noise in company 2. */
function seedTasks() {
    const overdue = VehicleModel.create({
        license_plate: "K-HU 1",
        company_id: 1,
        hu_due_on: "2020-01-01",
        uvv_due_on: "2099-01-01",
    });
    VehicleModel.create({
        license_plate: "K-OHNE 1",
        company_id: 1,
        status: "DRIVING",
        hu_due_on: "2099-01-01",
        uvv_due_on: "2099-01-01",
    });
    const silent = VehicleModel.create({
        license_plate: "K-FUNK 1",
        company_id: 1,
        status: "OFFLINE",
        hu_due_on: "2099-01-01",
        uvv_due_on: "2099-01-01",
    });
    insertAlert(silent.id, { type: "OFFLINE", severity: "MEDIUM", message: "kein Signal" });
    VehicleModel.create({
        license_plate: "K-TANK 1",
        company_id: 1,
        fuel_level: 5,
        hu_due_on: "2099-01-01",
        uvv_due_on: "2099-01-01",
    });
    const fast = DriverModel.create(1, "Tina Tempo");
    for (let i = 0; i < 5; i += 1) {
        // Ended but not resolved: still an open warning for the driver.
        insertAlert(overdue.id, {
            type: "SPEEDING",
            driver_id: fast.id,
            ended_at: "2026-01-01 00:00:00",
        });
    }

    // Another company: must not show up.
    VehicleModel.create({
        license_plate: "B-FREMD 1",
        company_id: 2,
        status: "DRIVING",
        fuel_level: 3,
        hu_due_on: "2020-01-01",
    });
}

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/today", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/today");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("rejects a limit outside 1–50", async () => {
        const response = await api.get("/api/today?limit=0");

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });

    it("counts exactly what each destination list shows", async () => {
        seedTasks();

        const today = await api.get("/api/today");
        assert.equal(today.status, 200);
        const { counts, total } = today.body.meta;

        const [overdue, soon, unassigned, talk, offline, lowFuel] =
            await Promise.all([
                api.get("/api/due?state=overdue"),
                api.get("/api/due?state=soon"),
                api.get("/api/vehicles?filter=driving_unassigned"),
                api.get("/api/drivers?min_open_warnings=5"),
                api.get("/api/alerts?filter=open&type=OFFLINE"),
                api.get("/api/vehicles?filter=low_fuel"),
            ]);

        assert.equal(counts.deadline_overdue, overdue.body.meta.total);
        assert.equal(counts.deadline_soon, soon.body.meta.total);
        assert.equal(counts.driving_unassigned, unassigned.body.meta.total);
        assert.equal(counts.driving_unassigned, 1);
        assert.equal(counts.driver_talk, talk.body.meta.total);
        assert.equal(counts.driver_talk, 1);
        assert.equal(counts.offline, offline.body.meta.total);
        assert.equal(counts.offline, 1);
        assert.equal(counts.low_fuel, lowFuel.body.meta.total);
        assert.equal(counts.low_fuel, 1);
        assert.equal(
            total,
            TODAY_KINDS.reduce(
                (sum: number, kind: string) => sum + counts[kind],
                0,
            ),
        );
        assert.equal(
            unassigned.body.meta.counts.driving_unassigned,
            counts.driving_unassigned,
        );
    });

    it("lists the most urgent kind first and leaves other companies out", async () => {
        seedTasks();

        const response = await api.get("/api/today");
        const kinds: string[] = response.body.data.map(
            (item: { kind: string }) => item.kind,
        );
        const order = kinds.map((kind) =>
            (TODAY_KINDS as readonly string[]).indexOf(kind),
        );

        assert.deepEqual([...order].sort((a, b) => a - b), order);
        assert.equal(kinds[0], "deadline_overdue");
        for (const kind of [
            "driving_unassigned",
            "driver_talk",
            "offline",
            "low_fuel",
        ]) {
            assert.ok(kinds.includes(kind), kind);
        }
        const subjects = response.body.data.map(
            (item: { subject: string }) => item.subject,
        );
        assert.equal(subjects.includes("B-FREMD 1"), false);

        const offline = response.body.data.find(
            (item: { kind: string }) => item.kind === "offline",
        );
        assert.equal(typeof offline.alert_id, "number");
        assert.equal(offline.subject, "K-FUNK 1");
    });

    it("gives every kind a slot when one kind has many rows", async () => {
        seedTasks();
        for (let i = 2; i <= 9; i += 1) {
            VehicleModel.create({
                license_plate: `K-HU ${i}`,
                company_id: 1,
                hu_due_on: "2020-01-01",
                uvv_due_on: "2099-01-01",
            });
        }

        const response = await api.get("/api/today?limit=5");
        const kinds = new Set(
            response.body.data.map((item: { kind: string }) => item.kind),
        );

        assert.equal(response.body.data.length, 5);
        assert.equal(kinds.size, 5);
    });
});
