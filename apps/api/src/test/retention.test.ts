import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { formatAuditEvent, type AuditEvent } from "@fleet-live/shared";
import { app } from "../app";
import { config } from "../config";
import { db } from "../db/database";
import { sqliteDaysAgo } from "../lib/sqlTime";
import { AuditModel } from "../models/audit.model";
import { TripModel } from "../models/trip.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

const vehicle = (plate: string, companyId: number) =>
    VehicleModel.create({ license_plate: plate, driver_name: "Test", company_id: companyId });

function closedTrip(vehicleId: number, daysAgo: number) {
    const at = sqliteDaysAgo(daysAgo);
    db.prepare("INSERT INTO trips (vehicle_id, started_at, ended_at, path) VALUES (?, ?, ?, '')").run(
        vehicleId,
        at,
        at,
    );
}

const count = (sql: string, ...params: number[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;

describe("retention per company", () => {
    it("starts at the defaults", async () => {
        const { agent } = await loginAs(1);
        const { body } = await agent.get("/api/auth/retention").expect(200);

        assert.deepEqual(body.data, {
            trips_days: null,
            alerts_days: null,
            audit_days: null,
            trips: config.tripRetentionDays,
            alerts: 90,
            audit: 365,
            defaults: { trips: config.tripRetentionDays, alerts: 90, audit: 365 },
        });
    });

    it("deletes closed trips past the company's days at once, and only there", async () => {
        const { agent } = await loginAs(1);
        const mine = vehicle("K-AUF 1", 1);
        const theirs = vehicle("K-AUF 2", 2);
        closedTrip(mine.id, 40);
        closedTrip(mine.id, 10);
        closedTrip(theirs.id, 40);
        TripModel.open(mine.id);

        const saved = await agent.patch("/api/auth/retention").send({ trips_days: 30 }).expect(200);
        assert.equal(saved.body.data.trips, 30);
        assert.deepEqual(saved.body.deleted, { trips: 1, alerts: 0, audit: 0 });
        assert.equal(count("SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?", mine.id), 2);
        assert.equal(count("SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ? AND ended_at IS NULL", mine.id), 1);
        assert.equal(count("SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?", theirs.id), 1);
    });

    it("deletes resolved warnings past the company's days and keeps the month sums", async () => {
        const { agent } = await loginAs(1);
        const mine = vehicle("K-AUF 3", 1);
        const theirs = vehicle("K-AUF 4", 2);
        const old = insertAlert(mine.id, { resolved_at: sqliteDaysAgo(45), ended_at: sqliteDaysAgo(45), created_at: sqliteDaysAgo(46) });
        const recent = insertAlert(mine.id, { resolved_at: sqliteDaysAgo(5), ended_at: sqliteDaysAgo(5) });
        const open = insertAlert(mine.id, { created_at: sqliteDaysAgo(100) });
        const theirsOld = insertAlert(theirs.id, { resolved_at: sqliteDaysAgo(45), ended_at: sqliteDaysAgo(45) });

        await agent.patch("/api/auth/retention").send({ alerts_days: 30 }).expect(200);

        const exists = (id: number) => count("SELECT COUNT(*) AS n FROM alerts WHERE id = ?", id) === 1;
        assert.equal(exists(old), false);
        assert.equal(exists(recent), true);
        assert.equal(exists(open), true);
        assert.equal(exists(theirsOld), true);
        assert.ok(count("SELECT COUNT(*) AS n FROM alert_month_stats WHERE company_id = 1") >= 1);
    });

    it("deletes log entries past the company's days", async () => {
        const { agent } = await loginAs(1);
        const actor = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(actor);
        AuditModel.record({ companyId: 1, action: "company_created", actorId: actor.id });
        AuditModel.record({ companyId: 2, action: "company_created", actorId: actor.id });
        db.prepare("UPDATE audit_events SET created_at = ?").run(sqliteDaysAgo(200));

        await agent.patch("/api/auth/retention").send({ audit_days: 180 }).expect(200);

        assert.equal(count("SELECT COUNT(*) AS n FROM audit_events WHERE company_id = 2"), 1);
        const { body } = await agent.get("/api/auth/audit").expect(200);
        // The old entry is gone; the change itself is the one entry left.
        assert.deepEqual(
            body.data.map((row: AuditEvent) => formatAuditEvent(row)),
            ["Aufbewahrung geändert: Protokoll 180 Tage"],
        );
    });

    it("goes back to the default with null and checks the limits", async () => {
        const { agent } = await loginAs(1);
        await agent.patch("/api/auth/retention").send({ trips_days: 60, audit_days: 400 }).expect(200);
        const back = await agent.patch("/api/auth/retention").send({ trips_days: null }).expect(200);
        assert.equal(back.body.data.trips_days, null);
        assert.equal(back.body.data.audit_days, 400);

        const short = await agent.patch("/api/auth/retention").send({ trips_days: 6 });
        assert.equal(short.status, 400);
        assert.equal(short.body.fields.trips_days, "Mindestens 7 Tage.");
        const long = await agent.patch("/api/auth/retention").send({ audit_days: 5000 });
        assert.equal(long.status, 400);
        assert.equal(long.body.fields.audit_days, "Höchstens 1825 Tage.");

        const { body } = await agent.get("/api/auth/audit").expect(200);
        assert.deepEqual(
            body.data.map((row: AuditEvent) => formatAuditEvent(row)),
            [
                "Aufbewahrung geändert: Fahrten Standard",
                "Aufbewahrung geändert: Fahrten 60 Tage, Protokoll 400 Tage",
            ],
        );
    });

    it("is for dispatchers", async () => {
        await request(app).get("/api/auth/retention").expect(401);
        const { agent } = await loginAs(1, "viewer");
        await agent.get("/api/auth/retention").expect(403);
        await agent.patch("/api/auth/retention").send({ trips_days: 30 }).expect(403);
    });
});
