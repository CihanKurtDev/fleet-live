import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { formatAuditEvent, type AuditEvent } from "@fleet-live/shared";
import { app } from "../app";
import { config } from "../config";
import { db } from "../db/database";
import { pruneClosedDamages } from "../db/damageRetention";
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
        const { body } = await agent.get("/api/auth/privacy").expect(200);

        assert.deepEqual(body.data, {
            viewer_driver_names: true,
            trips_days: null,
            alerts_days: null,
            damages_days: null,
            audit_days: null,
            trips: config.tripRetentionDays,
            alerts: 90,
            damages: 365,
            audit: 365,
            defaults: { trips: config.tripRetentionDays, alerts: 90, damages: 365, audit: 365 },
        });
    });

    it("takes photos, place and driver off a damage closed long enough ago, and only there", async () => {
        const { agent } = await loginAs(1);
        const mine = vehicle("K-AUF 5", 1);
        const add = (vehicleId: number, state: string, closedOn: string | null) => {
            const { lastInsertRowid } = db
                .prepare(
                    `INSERT INTO vehicle_damages
                     (vehicle_id, occurred_on, description, severity, state, closed_on, latitude, longitude, driver_name)
                     VALUES (?, '2026-01-01', 'Delle', 'MINOR', ?, ?, 50.9, 6.9, 'Eda Yilmaz')`,
                )
                .run(vehicleId, state, closedOn);
            const id = Number(lastInsertRowid);
            db.prepare("INSERT INTO damage_photos (damage_id, content_type, data) VALUES (?, 'image/png', ?)").run(
                id,
                new Uint8Array([1, 2, 3]),
            );
            return id;
        };
        const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        const old = add(mine.id, "REPAIRED", daysAgo(40));
        const recent = add(mine.id, "CLOSED", daysAgo(10));
        const open = add(mine.id, "OPEN", null);
        const theirs = add(vehicle("K-AUF 6", 2).id, "REPAIRED", daysAgo(40));

        // Nothing is due at the default of 365 days.
        assert.equal(pruneClosedDamages(db), 0);

        const saved = await agent.patch("/api/auth/privacy").send({ damages_days: 30 }).expect(200);
        assert.deepEqual(saved.body.deleted, { trips: 0, alerts: 0, damages: 1, audit: 0 });
        assert.equal(saved.body.data.damages, 30);

        const row = (id: number) =>
            db
                .prepare(
                    `SELECT d.description, d.latitude, d.driver_name,
                            (SELECT COUNT(*) FROM damage_photos p WHERE p.damage_id = d.id) AS photos
                     FROM vehicle_damages d WHERE d.id = ?`,
                )
                .get(id) as { description: string; latitude: number | null; driver_name: string | null; photos: number };

        assert.deepEqual({ ...row(old) }, { description: "Delle", latitude: null, driver_name: null, photos: 0 });
        for (const kept of [recent, open, theirs]) {
            assert.deepEqual({ ...row(kept) }, { description: "Delle", latitude: 50.9, driver_name: "Eda Yilmaz", photos: 1 });
        }
    });

    it("deletes closed trips past the company's days at once, and only there", async () => {
        const { agent } = await loginAs(1);
        const mine = vehicle("K-AUF 1", 1);
        const theirs = vehicle("K-AUF 2", 2);
        closedTrip(mine.id, 40);
        closedTrip(mine.id, 10);
        closedTrip(theirs.id, 40);
        TripModel.open(mine.id);

        const saved = await agent.patch("/api/auth/privacy").send({ trips_days: 30 }).expect(200);
        assert.equal(saved.body.data.trips, 30);
        assert.deepEqual(saved.body.deleted, { trips: 1, alerts: 0, damages: 0, audit: 0 });
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
        // The inbox says how long a resolved warning stays.
        assert.equal((await agent.get("/api/alerts").expect(200)).body.meta.resolved_kept_days, 90);

        await agent.patch("/api/auth/privacy").send({ alerts_days: 30 }).expect(200);
        assert.equal((await agent.get("/api/alerts").expect(200)).body.meta.resolved_kept_days, 30);

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

        await agent.patch("/api/auth/privacy").send({ audit_days: 180 }).expect(200);

        assert.equal(count("SELECT COUNT(*) AS n FROM audit_events WHERE company_id = 2"), 1);
        const { body } = await agent.get("/api/auth/audit").expect(200);
        // The old entry is gone; the change itself is the one entry left.
        assert.deepEqual(
            body.data.map((row: AuditEvent) => formatAuditEvent(row)),
            ["Datenschutz geändert: Protokoll 180 Tage"],
        );
    });

    it("goes back to the default with null and checks the limits", async () => {
        const { agent } = await loginAs(1);
        await agent.patch("/api/auth/privacy").send({ trips_days: 60, audit_days: 400 }).expect(200);
        const back = await agent.patch("/api/auth/privacy").send({ trips_days: null }).expect(200);
        assert.equal(back.body.data.trips_days, null);
        assert.equal(back.body.data.audit_days, 400);

        const short = await agent.patch("/api/auth/privacy").send({ trips_days: 6 });
        assert.equal(short.status, 400);
        assert.equal(short.body.fields.trips_days, "Mindestens 7 Tage.");
        const long = await agent.patch("/api/auth/privacy").send({ audit_days: 5000 });
        assert.equal(long.status, 400);
        assert.equal(long.body.fields.audit_days, "Höchstens 1825 Tage.");

        const { body } = await agent.get("/api/auth/audit").expect(200);
        assert.deepEqual(
            body.data.map((row: AuditEvent) => formatAuditEvent(row)),
            [
                "Datenschutz geändert: Fahrten Standard",
                "Datenschutz geändert: Fahrten 60 Tage, Protokoll 400 Tage",
            ],
        );
    });

    it("is for dispatchers", async () => {
        await request(app).get("/api/auth/privacy").expect(401);
        const { agent } = await loginAs(1, "viewer");
        await agent.get("/api/auth/privacy").expect(403);
        await agent.patch("/api/auth/privacy").send({ trips_days: 30 }).expect(403);
    });
});

describe("driver names for viewers", () => {
    async function setup() {
        const { agent: dispatcher } = await loginAs(1);
        const ada = Number(
            db.prepare("INSERT INTO drivers (company_id, name) VALUES (1, 'Ada')").run().lastInsertRowid,
        );
        const van = vehicle("K-NAM 1", 1);
        db.prepare(
            "INSERT INTO trips (vehicle_id, driver_id, started_at, ended_at, path) VALUES (?, ?, '2026-10-20 08:00:00', '2026-10-20 09:00:00', '')",
        ).run(van.id, ada);
        insertAlert(van.id, { driver_id: ada });
        return { dispatcher, ada, van };
    }

    it("are kept from viewers once the company says so", async () => {
        const { dispatcher, ada, van } = await setup();
        const { agent: viewer } = await loginAs(1, "viewer");
        assert.equal((await viewer.get("/api/auth/me")).body.driver_names_hidden, false);
        assert.equal((await viewer.get("/api/alerts")).body.data[0].driver_name, "Ada");

        const saved = await dispatcher.patch("/api/auth/privacy").send({ viewer_driver_names: false }).expect(200);
        assert.equal(saved.body.data.viewer_driver_names, false);

        assert.equal((await viewer.get("/api/auth/me")).body.driver_names_hidden, true);
        const alerts = await viewer.get("/api/alerts").expect(200);
        assert.equal(alerts.body.data[0].driver_name, null);
        assert.equal(alerts.body.data[0].driver_id, null);
        const filtered = await viewer.get(`/api/alerts?driver_id=${ada}`);
        assert.equal(filtered.status, 403);
        assert.equal(filtered.body.code, "DRIVER_NAMES_HIDDEN");

        const trips = await viewer.get(`/api/vehicles/${van.id}/trips`).expect(200);
        assert.equal(trips.body.data[0].driver_name, null);
        const latest = await viewer.get(`/api/vehicles/${van.id}/trips/latest`).expect(200);
        assert.equal(latest.body.data.driver_name, null);

        await viewer.get("/api/drivers").expect(403);
        await viewer.get(`/api/drivers/${ada}`).expect(403);

        // Dispatchers keep everything.
        assert.equal((await dispatcher.get("/api/alerts")).body.data[0].driver_name, "Ada");
        await dispatcher.get(`/api/drivers/${ada}`).expect(200);
        assert.equal((await dispatcher.get("/api/auth/me")).body.driver_names_hidden, false);
    });

    it("leave the drivers' licence checks out of the viewer's day list", async () => {
        const { dispatcher, ada, van } = await setup();
        // Ada drives the van and was never checked.
        db.prepare("UPDATE drivers SET licence_expires_on = '2099-01-01', licence_checked_on = NULL WHERE id = ?").run(ada);
        db.prepare("INSERT OR IGNORE INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)").run(ada, van.id);
        db.prepare("UPDATE vehicles SET current_driver_id = ?, driver_name = 'Ada' WHERE id = ?").run(ada, van.id);
        const { agent: viewer } = await loginAs(1, "viewer");
        const before = await viewer.get("/api/today").expect(200);
        assert.ok(before.body.meta.counts.check_overdue >= 1);

        await dispatcher.patch("/api/auth/privacy").send({ viewer_driver_names: false }).expect(200);
        const after = await viewer.get("/api/today").expect(200);
        assert.equal(after.body.meta.counts.check_overdue, 0);
        assert.equal(after.body.data.groups.some((group: { kind: string }) => group.kind === "check_overdue"), false);
    });

    it("are kept out of damages, workshop stays and the licence row too", async () => {
        const { dispatcher, ada, van } = await setup();
        db.prepare("UPDATE drivers SET licence_expires_on = '2020-01-01' WHERE id = ?").run(ada);
        db.prepare("INSERT OR IGNORE INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)").run(ada, van.id);
        db.prepare("UPDATE vehicles SET current_driver_id = ?, driver_name = 'Ada' WHERE id = ?").run(ada, van.id);
        db.prepare(
            "INSERT INTO vehicle_damages (vehicle_id, occurred_on, description, severity, drivable, driver_id, driver_name) VALUES (?, '2026-10-20', 'Delle', 'MINOR', 1, ?, 'Ada')",
        ).run(van.id, ada);
        db.prepare(
            "INSERT INTO workshop_visits (vehicle_id, reasons, state, place, planned_on, expected_on, bring_driver_id) VALUES (?, json_array('HU'), 'PLANNED', 'Weber', '2099-01-01', '2099-01-01', ?)",
        ).run(van.id, ada);
        const { agent: viewer } = await loginAs(1, "viewer");

        const shown = await viewer.get(`/api/vehicles/${van.id}/damages`).expect(200);
        assert.equal(shown.body.data[0].driver_name, "Ada");
        assert.equal((await viewer.get(`/api/vehicles/${van.id}/workshop`)).body.data.open.bring_driver_name, "Ada");
        assert.ok((await viewer.get("/api/today")).body.meta.counts.licence_driving >= 1);

        await dispatcher.patch("/api/auth/privacy").send({ viewer_driver_names: false }).expect(200);

        const damage = (await viewer.get(`/api/vehicles/${van.id}/damages`)).body.data[0];
        assert.equal(damage.driver_name, null);
        assert.equal(damage.driver_id, null);
        const stay = (await viewer.get(`/api/vehicles/${van.id}/workshop`)).body.data.open;
        assert.equal(stay.bring_driver_name, null);
        assert.equal(stay.bring_driver_id, null);
        const today = (await viewer.get("/api/today")).body;
        assert.equal(today.meta.counts.licence_driving, 0);
        assert.equal(today.data.groups.some((group: { kind: string }) => group.kind === "licence_driving"), false);

        // Who may bring a vehicle is a dispatcher's list, whatever the setting.
        await viewer.get(`/api/vehicles/${van.id}/workshop/bringers`).expect(403);

        assert.equal((await dispatcher.get(`/api/vehicles/${van.id}/damages`)).body.data[0].driver_name, "Ada");
        assert.equal((await dispatcher.get(`/api/vehicles/${van.id}/workshop`)).body.data.open.bring_driver_name, "Ada");
    });

    it("is a logged change", async () => {
        const { agent } = await loginAs(1);
        await agent.patch("/api/auth/privacy").send({ viewer_driver_names: false }).expect(200);
        const { body } = await agent.get("/api/auth/audit").expect(200);
        assert.equal(formatAuditEvent(body.data[0]), "Datenschutz geändert: Fahrernamen nur für Dispatcher");
        const bad = await agent.patch("/api/auth/privacy").send({ viewer_driver_names: "nein" });
        assert.equal(bad.status, 400);
    });
});
