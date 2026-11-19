import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { insertAlert, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/alerts", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/alerts");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lists only open alerts of this company by default", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-OWN 1",
            driver_name: "Eigene",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-OTH 1",
            driver_name: "Fremde",
            company_id: 2,
        });

        insertAlert(mine.id, { message: "offen" });
        insertAlert(mine.id, {
            message: "erledigt",
            resolved_at: "2026-01-01 00:00:00",
            ended_at: "2026-01-01 00:00:00",
        });
        insertAlert(other.id, { message: "fremd" });

        const response = await api.get("/api/alerts");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].message, "offen");
        assert.equal(response.body.data[0].license_plate, "K-OWN 1");
        assert.equal(response.body.data[0].resolved_at, null);
        assert.equal(response.body.meta.counts.open, 1);
        assert.equal(response.body.meta.counts.resolved, 1);
        assert.equal(response.body.meta.counts.all, 2);
        assert.equal(response.body.meta.type_counts.SPEEDING, 1);
        assert.equal(response.body.meta.type_counts.LOW_FUEL, 0);
        assert.equal(response.body.meta.type_counts.OFFLINE, 0);
        assert.equal(response.body.meta.type_counts.all, 1);
        assert.equal(response.body.meta.total, 1);
    });

    it("filters by type and keeps status counts independent of type", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TP 1",
            driver_name: "Typ",
            company_id: 1,
        });

        insertAlert(vehicle.id, { type: "SPEEDING", message: "tempo" });
        insertAlert(vehicle.id, { type: "LOW_FUEL", message: "tank" });
        insertAlert(vehicle.id, {
            type: "SPEEDING",
            message: "tempo erledigt",
            resolved_at: "2026-01-01 00:00:00",
            ended_at: "2026-01-01 00:00:00",
        });

        const speeding = await api.get("/api/alerts").query({
            type: "SPEEDING",
        });

        assert.equal(speeding.status, 200);
        assert.equal(speeding.body.data.length, 1);
        assert.equal(speeding.body.data[0].type, "SPEEDING");
        assert.equal(speeding.body.data[0].message, "tempo");
        assert.equal(speeding.body.meta.total, 1);
        assert.equal(speeding.body.meta.counts.open, 2);
        assert.equal(speeding.body.meta.counts.resolved, 1);
        assert.equal(speeding.body.meta.counts.all, 3);
        assert.equal(speeding.body.meta.type_counts.SPEEDING, 1);
        assert.equal(speeding.body.meta.type_counts.LOW_FUEL, 1);
        assert.equal(speeding.body.meta.type_counts.all, 2);

        const allSpeeding = await api.get("/api/alerts").query({
            filter: "all",
            type: "SPEEDING",
        });

        assert.equal(allSpeeding.status, 200);
        assert.equal(allSpeeding.body.data.length, 2);
        assert.equal(allSpeeding.body.meta.type_counts.SPEEDING, 2);
        assert.equal(allSpeeding.body.meta.type_counts.LOW_FUEL, 1);
        assert.equal(allSpeeding.body.meta.type_counts.all, 3);
    });

    it("rejects an invalid type", async () => {
        const response = await api.get("/api/alerts").query({
            type: "NOPE",
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
        assert.equal(response.body.fields.type, "Ungültiger Warnungstyp.");
    });

    it("serves the page size the list measured", async () => {
        // One open alert per vehicle and type: twelve vehicles.
        for (let index = 0; index < 12; index += 1) {
            const vehicle = VehicleModel.create({
                license_plate: `K-LM ${index}`,
                driver_name: `Limit ${index}`,
                company_id: 1,
            });

            insertAlert(vehicle.id, { message: `warnung ${index}` });
        }

        const response = await api
            .get("/api/alerts")
            .query({ page: 2, limit: 7 });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 5);
        assert.equal(response.body.meta.limit, 7);
        assert.equal(response.body.meta.pageCount, 2);
    });

    it("rejects a limit outside 1 to 100", async () => {
        for (const limit of [0, 101, 2.5]) {
            const response = await api.get("/api/alerts").query({ limit });

            assert.equal(response.status, 400, `limit ${limit}`);
            assert.equal(response.body.code, "VALIDATION_ERROR");
        }
    });

    it("sorts by type and rejects injection", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SR 1",
            driver_name: "Sort",
            company_id: 1,
        });

        insertAlert(vehicle.id, { type: "OFFLINE", message: "funk" });
        insertAlert(vehicle.id, { type: "SPEEDING", message: "tempo" });
        insertAlert(vehicle.id, { type: "LOW_FUEL", message: "tank" });

        const ordered = await api.get("/api/alerts").query({
            sort: "type",
            dir: "asc",
        });

        assert.equal(ordered.status, 200);
        assert.deepEqual(
            ordered.body.data.map((row: { type: string }) => row.type),
            ["SPEEDING", "LOW_FUEL", "OFFLINE"],
        );

        const rejected = await api.get("/api/alerts").query({
            sort: "id;DROP TABLE alerts",
        });

        assert.equal(rejected.status, 400);
        assert.equal(rejected.body.code, "VALIDATION_ERROR");
    });

    it("keeps alerts without a driver after named drivers in both sort directions", async () => {
        const named = VehicleModel.create({
            license_plate: "K-AN 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const pool = VehicleModel.create({
            license_plate: "K-PL 1",
            company_id: 1,
        });

        insertAlert(named.id, { message: "anna" });
        insertAlert(pool.id, { message: "pool" });

        const names = (response: {
            body: { data: Array<{ driver_name: string | null }> };
        }) => response.body.data.map((row) => row.driver_name);

        const asc = await api.get("/api/alerts").query({
            sort: "driver_name",
            dir: "asc",
        });
        assert.equal(asc.status, 200);
        assert.deepEqual(names(asc), ["Anna", null]);

        const desc = await api.get("/api/alerts").query({
            sort: "driver_name",
            dir: "desc",
        });
        assert.equal(desc.status, 200);
        assert.deepEqual(names(desc), ["Anna", null]);
    });

    it("returns 404 for another company's vehicle_id", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 2",
            driver_name: "Fremde",
            company_id: 2,
        });
        insertAlert(other.id);

        const response = await api.get("/api/alerts").query({
            vehicle_id: other.id,
        });

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
    });

    it("filters a vehicle of this company", async () => {
        const first = VehicleModel.create({
            license_plate: "K-A 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const second = VehicleModel.create({
            license_plate: "K-B 2",
            driver_name: "Ben",
            company_id: 1,
        });
        insertAlert(first.id, { message: "eins" });
        insertAlert(second.id, { message: "zwei" });

        const response = await api.get("/api/alerts").query({
            vehicle_id: first.id,
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].vehicle_id, first.id);
        assert.equal(response.body.data[0].driver_id, first.current_driver_id);
        assert.equal(response.body.data[0].message, "eins");
    });

    it("returns 404 for another company's driver_id", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 4",
            driver_name: "Fremde",
            company_id: 2,
        });
        insertAlert(other.id);

        const response = await api.get("/api/alerts").query({
            driver_id: other.current_driver_id,
        });

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
    });

    it("filters alerts by driver of this company", async () => {
        const anna = VehicleModel.create({
            license_plate: "K-AN 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const ben = VehicleModel.create({
            license_plate: "K-BN 1",
            driver_name: "Ben",
            company_id: 1,
        });
        insertAlert(anna.id, { message: "anna" });
        insertAlert(ben.id, { message: "ben" });

        const response = await api.get("/api/alerts").query({
            driver_id: anna.current_driver_id,
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].message, "anna");
        assert.equal(response.body.data[0].driver_id, anna.current_driver_id);
    });

    it("lets a viewer read alerts", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-VW 1",
            driver_name: "Viewer",
            company_id: 1,
        });
        insertAlert(vehicle.id);

        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer.get("/api/alerts");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
    });
});

describe("PATCH /api/alerts/:id", () => {
    it("requires a session", async () => {
        const response = await request(app)
            .patch("/api/alerts/1")
            .send({ resolved: true });

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("resolves an open alert and decrements active_alerts", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-RS 1",
            driver_name: "Resolver",
            company_id: 1,
        });
        const id = insertAlert(vehicle.id);

        const before = VehicleModel.getById(vehicle.id, 1);
        assert.equal(before?.active_alerts, 1);

        const response = await api
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });

        assert.equal(response.status, 200);
        assert.equal(typeof response.body.resolved_at, "string");
        assert.notEqual(response.body.resolved_at, null);

        const after = VehicleModel.getById(vehicle.id, 1);
        assert.equal(after?.active_alerts, 0);
    });

    it("is idempotent on a second resolve", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-ID 1",
            driver_name: "Idem",
            company_id: 1,
        });
        const id = insertAlert(vehicle.id);

        const first = await api
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });
        const second = await api
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(second.body.resolved_at, first.body.resolved_at);

        const after = VehicleModel.getById(vehicle.id, 1);
        assert.equal(after?.active_alerts, 0);
    });

    it("returns 404 for another company's alert", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 3",
            driver_name: "Fremde",
            company_id: 2,
        });
        const id = insertAlert(other.id);

        const response = await api
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");

        const stillOpen = db
            .prepare("SELECT resolved_at FROM alerts WHERE id = ?")
            .get(id) as { resolved_at: string | null };
        assert.equal(stillOpen.resolved_at, null);
    });

    it("rejects resolve from a viewer", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-VW 2",
            driver_name: "Viewer",
            company_id: 1,
        });
        const id = insertAlert(vehicle.id);

        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });

        assert.equal(response.status, 403);
        assert.equal(response.body.code, "FORBIDDEN");

        const still = VehicleModel.getById(vehicle.id, 1);
        assert.equal(still?.active_alerts, 1);
    });
});

describe("PATCH /api/alerts (bulk)", () => {
    function resolvedAt(id: number): string | null {
        const row = db
            .prepare("SELECT resolved_at FROM alerts WHERE id = ?")
            .get(id) as { resolved_at: string | null };
        return row.resolved_at;
    }

    it("requires a session", async () => {
        const response = await request(app)
            .patch("/api/alerts")
            .send({ ids: [1], resolved: true });

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("resolves several open alerts and decrements active_alerts", async () => {
        const first = VehicleModel.create({
            license_plate: "K-BK 1",
            driver_name: "Bulk Eins",
            company_id: 1,
        });
        const second = VehicleModel.create({
            license_plate: "K-BK 2",
            driver_name: "Bulk Zwei",
            company_id: 1,
        });
        const a = insertAlert(first.id, {
            type: "SPEEDING",
            ended_at: "2026-01-01 00:00:00",
        });
        const b = insertAlert(first.id, { type: "SPEEDING" });
        const c = insertAlert(second.id, { type: "SPEEDING" });
        const untouched = insertAlert(second.id, {
            type: "SPEEDING",
            ended_at: "2026-01-01 00:00:00",
        });

        const response = await api
            .patch("/api/alerts")
            .send({ ids: [a, b, c], resolved: true });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { data: { resolved: 3 } });
        assert.notEqual(resolvedAt(a), null);
        assert.notEqual(resolvedAt(b), null);
        assert.notEqual(resolvedAt(c), null);
        assert.equal(resolvedAt(untouched), null);
        assert.equal(VehicleModel.getById(first.id, 1)?.active_alerts, 0);
        assert.equal(VehicleModel.getById(second.id, 1)?.active_alerts, 1);

        const open = await api.get("/api/alerts");
        assert.equal(open.body.meta.counts.open, 1);
        assert.equal(open.body.meta.counts.resolved, 3);
    });

    it("is idempotent for alerts that are already resolved", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-BK 3",
            driver_name: "Bulk Drei",
            company_id: 1,
        });
        const done = insertAlert(vehicle.id, {
            resolved_at: "2026-01-01 00:00:00",
            ended_at: "2026-01-01 00:00:00",
        });
        const open = insertAlert(vehicle.id, { type: "SPEEDING" });

        const first = await api
            .patch("/api/alerts")
            .send({ ids: [done, open], resolved: true });

        assert.equal(first.status, 200);
        assert.equal(first.body.data.resolved, 1);
        assert.equal(resolvedAt(done), "2026-01-01 00:00:00");

        const stamp = resolvedAt(open);
        const second = await api
            .patch("/api/alerts")
            .send({ ids: [done, open], resolved: true });

        assert.equal(second.status, 200);
        assert.equal(second.body.data.resolved, 0);
        assert.equal(resolvedAt(open), stamp);
        assert.equal(VehicleModel.getById(vehicle.id, 1)?.active_alerts, 0);
    });

    it("returns 404 and changes nothing when one id belongs to another company", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-BK 4",
            driver_name: "Eigene",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-OTH 4",
            driver_name: "Fremde",
            company_id: 2,
        });
        const own = insertAlert(mine.id);
        const foreign = insertAlert(other.id);

        const response = await api
            .patch("/api/alerts")
            .send({ ids: [own, foreign], resolved: true });

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
        assert.equal(resolvedAt(own), null);
        assert.equal(resolvedAt(foreign), null);
        assert.equal(VehicleModel.getById(mine.id, 1)?.active_alerts, 1);
    });

    it("returns 404 and changes nothing for an unknown id", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-BK 5",
            driver_name: "Unbekannt",
            company_id: 1,
        });
        const own = insertAlert(vehicle.id);

        const response = await api
            .patch("/api/alerts")
            .send({ ids: [own, 999_999], resolved: true });

        assert.equal(response.status, 404);
        assert.equal(resolvedAt(own), null);
    });

    it("rejects bulk resolve from a viewer", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-BK 6",
            driver_name: "Viewer",
            company_id: 1,
        });
        const id = insertAlert(vehicle.id);

        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer
            .patch("/api/alerts")
            .send({ ids: [id], resolved: true });

        assert.equal(response.status, 403);
        assert.equal(response.body.code, "FORBIDDEN");
        assert.equal(resolvedAt(id), null);
    });

    it("validates the body", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-BK 7",
            driver_name: "Validierung",
            company_id: 1,
        });
        const id = insertAlert(vehicle.id);
        const tooMany = Array.from({ length: 101 }, (_, index) => index + 1);
        const cases: Array<{ body: unknown; field: string }> = [
            { body: { ids: [], resolved: true }, field: "ids" },
            { body: { ids: tooMany, resolved: true }, field: "ids" },
            { body: { ids: [1.5], resolved: true }, field: "ids.0" },
            { body: { ids: ["1"], resolved: true }, field: "ids.0" },
            { body: { ids: [0], resolved: true }, field: "ids.0" },
            { body: { ids: [id, id], resolved: true }, field: "ids" },
            { body: { ids: "1", resolved: true }, field: "ids" },
            { body: { resolved: true }, field: "ids" },
            { body: { ids: [id], resolved: false }, field: "resolved" },
        ];

        for (const { body, field } of cases) {
            const response = await api.patch("/api/alerts").send(body as object);

            assert.equal(response.status, 400, JSON.stringify(body));
            assert.equal(response.body.code, "VALIDATION_ERROR");
            assert.equal(typeof response.body.fields[field], "string");
        }

        assert.equal(resolvedAt(id), null);
    });

    it("accepts 100 ids", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-BK 8",
            driver_name: "Hundert",
            company_id: 1,
        });
        // Beendete, aber nicht erledigte Zeilen: nur eine offene pro Typ.
        const ids = Array.from({ length: 100 }, () =>
            insertAlert(vehicle.id, {
                type: "SPEEDING",
                ended_at: "2026-01-01 00:00:00",
            }),
        );

        const response = await api
            .patch("/api/alerts")
            .send({ ids, resolved: true });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.resolved, 100);
        assert.equal(VehicleModel.getById(vehicle.id, 1)?.active_alerts, 0);
    });
});

describe("warning lists at any size", () => {
    const realOpen = (type: string) =>
        (db.prepare("SELECT COUNT(*) AS n FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.company_id = 1 AND a.type = ? AND a.resolved_at IS NULL").get(type) as { n: number }).n;
    const driver = async (name: string) => (await api.post("/api/drivers").send({ name })).body.data.id as number;
    const open = async (query = "") => (await api.get(`/api/alerts?filter=open${query}`)).body;

    it("keeps tiles and driver counts right through insert, resolve and delete", async () => {
        const vehicle = VehicleModel.create({ license_plate: "K-SKA 1", company_id: 1 });
        const driverId = await driver("Skala Eins");
        const first = insertAlert(vehicle.id, { type: "SPEEDING", driver_id: driverId, ended_at: "2026-01-01 00:00:00" });
        const second = insertAlert(vehicle.id, { type: "SPEEDING", driver_id: driverId, ended_at: "2026-01-01 00:00:00" });
        insertAlert(vehicle.id, { type: "LOW_FUEL", ended_at: null });

        let body = await open();
        assert.equal(body.meta.type_counts.SPEEDING, realOpen("SPEEDING"));
        assert.equal(body.meta.type_counts.LOW_FUEL, realOpen("LOW_FUEL"));
        assert.equal(body.meta.total, body.meta.counts.open);
        assert.equal((await api.get(`/api/drivers/${driverId}`)).body.data.open_warnings, 2);

        await api.patch(`/api/alerts/${first}`).send({ resolved: true }).expect(200);
        body = await open();
        assert.equal(body.meta.type_counts.SPEEDING, realOpen("SPEEDING"));
        assert.equal(body.meta.counts.resolved, 1);
        assert.equal((await api.get(`/api/drivers/${driverId}`)).body.data.open_warnings, 1);

        db.prepare("DELETE FROM alerts WHERE id = ?").run(second);
        body = await open();
        assert.equal(body.meta.type_counts.SPEEDING, realOpen("SPEEDING"));
        assert.equal((await api.get(`/api/drivers/${driverId}`)).body.data.open_warnings, 0);
    });

    it("finds warnings by plate or driver name, in the numbers too", async () => {
        const one = VehicleModel.create({ license_plate: "K-FIND 1", company_id: 1 });
        const two = VehicleModel.create({ license_plate: "D-ELSE 2", company_id: 1 });
        const named = await driver("Suche Fahrer");
        insertAlert(one.id, { type: "SPEEDING", ended_at: "2026-01-01 00:00:00" });
        insertAlert(two.id, { type: "SPEEDING", driver_id: named, ended_at: "2026-01-01 00:00:00" });

        const plate = await open("&search=k-fi");
        assert.deepEqual(plate.data.map((row: { license_plate: string }) => row.license_plate), ["K-FIND 1"]);
        assert.equal(plate.meta.total, 1);
        assert.equal(plate.meta.counts.open, 1);

        const name = await open("&search=suche");
        assert.deepEqual(name.data.map((row: { license_plate: string }) => row.license_plate), ["D-ELSE 2"]);
        assert.equal((await open("&search=100%25")).meta.total, 0);
    });

    it("searches _ and % as plain characters", async () => {
        const car = VehicleModel.create({ license_plate: "K-US 1", company_id: 1 });
        const odd = await driver("Ana_Rand 50%");
        const plain = await driver("Anaxrand");
        insertAlert(car.id, { type: "SPEEDING", driver_id: odd, ended_at: "2026-01-01 00:00:00" });
        insertAlert(car.id, { type: "SPEEDING", driver_id: plain, ended_at: "2026-01-01 00:00:00" });

        // "_" is no wildcard: only the name with the underscore matches.
        const underscore = await open("&search=ana_r");
        assert.equal(underscore.meta.total, 1);
        assert.equal(underscore.data[0].driver_name, "Ana_Rand 50%");
        assert.equal((await open("&search=50%25")).meta.total, 1);
    });

    it("does not let a viewer find a driver by name where names are hidden", async () => {
        const vehicle = VehicleModel.create({ license_plate: "K-HID 1", company_id: 1 });
        const named = await driver("Geheim Name");
        insertAlert(vehicle.id, { type: "SPEEDING", driver_id: named, ended_at: "2026-01-01 00:00:00" });
        await api.patch("/api/auth/privacy").send({ viewer_driver_names: false }).expect(200);
        const { agent: viewer } = await loginAs(1, "viewer");

        const byName = await viewer.get("/api/alerts?filter=open&search=geheim");
        assert.equal(byName.status, 200);
        assert.equal(byName.body.meta.total, 0);
        assert.equal(byName.body.meta.talk_drivers, 0);

        const byPlate = await viewer.get("/api/alerts?filter=open&search=k-hid");
        assert.equal(byPlate.body.meta.total, 1);
    });

    it("closes every Tempo warning of a filter, and nothing else", async () => {
        const mine = VehicleModel.create({ license_plate: "K-ALL 1", company_id: 1 });
        const scoped = VehicleModel.create({ license_plate: "K-ALL 2", company_id: 1 });
        const theirs = VehicleModel.create({ license_plate: "K-ALL 3", company_id: 2 });
        for (const id of [mine.id, mine.id, scoped.id, theirs.id]) {
            insertAlert(id, { type: "SPEEDING", ended_at: "2026-01-01 00:00:00" });
        }
        insertAlert(mine.id, { type: "LOW_FUEL", ended_at: null });

        const scopedDone = await api
            .patch("/api/alerts")
            .send({ filter: { type: "SPEEDING", vehicle_id: mine.id }, expected: 2, resolved: true });
        assert.equal(scopedDone.status, 200);
        assert.equal(scopedDone.body.data.resolved, 2);
        assert.equal(realOpen("SPEEDING"), 1);
        assert.equal(realOpen("LOW_FUEL"), 1);
        assert.equal(
            (db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE vehicle_id = ? AND resolved_at IS NULL").get(theirs.id) as { n: number }).n,
            1,
        );
    });

    it("changes nothing when the list moved on since the number was confirmed", async () => {
        const vehicle = VehicleModel.create({ license_plate: "K-MOV 1", company_id: 1 });
        insertAlert(vehicle.id, { type: "SPEEDING", ended_at: "2026-01-01 00:00:00" });
        insertAlert(vehicle.id, { type: "SPEEDING", ended_at: "2026-01-01 00:00:00" });

        const stale = await api.patch("/api/alerts").send({ filter: { type: "SPEEDING" }, expected: 1, resolved: true });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.code, "ALERTS_CHANGED");
        assert.equal(realOpen("SPEEDING"), 2);
    });

    it("refuses other types and another company's vehicle", async () => {
        const theirs = VehicleModel.create({ license_plate: "K-NOT 1", company_id: 2 });

        assert.equal((await api.patch("/api/alerts").send({ filter: { type: "LOW_FUEL" }, expected: 1, resolved: true })).status, 400);
        assert.equal((await api.patch("/api/alerts").send({ filter: { type: "SPEEDING", vehicle_id: theirs.id }, expected: 1, resolved: true })).status, 404);
    });

    it("names how many drivers need a talk, the number of that tile", async () => {
        const vehicle = VehicleModel.create({ license_plate: "K-TLK 1", company_id: 1 });
        const talker = await driver("Viel Tempo");
        for (let n = 0; n < 5; n += 1) {
            insertAlert(vehicle.id, { type: "SPEEDING", driver_id: talker, ended_at: "2026-01-01 00:00:00" });
        }

        assert.equal((await open()).meta.talk_drivers, 1);
        assert.equal((await api.get("/api/drivers?min_open_warnings=5")).body.meta.counts.talk, 1);
    });
});
