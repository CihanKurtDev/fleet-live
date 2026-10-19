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
        const a = insertAlert(first.id, { type: "OFFLINE" });
        const b = insertAlert(first.id, { type: "SPEEDING" });
        const c = insertAlert(second.id, { type: "SPEEDING" });
        const untouched = insertAlert(second.id, { type: "OFFLINE" });

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
        const open = insertAlert(vehicle.id, { type: "OFFLINE" });

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
                type: "OFFLINE",
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
