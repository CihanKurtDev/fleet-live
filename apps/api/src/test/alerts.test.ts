import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";

const TEST_PASSWORD = "secret-pass";

async function loginAs(
    companyId: number,
    role: "dispatcher" | "viewer" = "dispatcher",
) {
    const email = `${role}-${companyId}@example.com`;

    if (!UserModel.findByEmail(email)) {
        UserModel.create({
            name: `${role} ${companyId}`,
            email,
            password: TEST_PASSWORD,
            company_id: companyId,
            role,
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

function insertAlert(
    vehicleId: number,
    input: {
        type?: string;
        severity?: string;
        message?: string;
        resolved_at?: string | null;
        ended_at?: string | null;
    } = {},
) {
    const result = db
        .prepare(
            `
            INSERT INTO alerts (vehicle_id, type, severity, message, resolved_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
            vehicleId,
            input.type ?? "SPEEDING",
            input.severity ?? "HIGH",
            input.message ?? "zu schnell",
            input.resolved_at ?? null,
            input.ended_at ?? null,
        );

    return Number(result.lastInsertRowid);
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = await loginAs(1);
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
        assert.equal(response.body.data[0].driver_id, first.driver_id);
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
            driver_id: other.driver_id,
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
            driver_id: anna.driver_id,
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].message, "anna");
        assert.equal(response.body.data[0].driver_id, anna.driver_id);
    });

    it("lets a viewer read alerts", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-VW 1",
            driver_name: "Viewer",
            company_id: 1,
        });
        insertAlert(vehicle.id);

        const viewer = await loginAs(1, "viewer");
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

        const viewer = await loginAs(1, "viewer");
        const response = await viewer
            .patch(`/api/alerts/${id}`)
            .send({ resolved: true });

        assert.equal(response.status, 403);
        assert.equal(response.body.code, "FORBIDDEN");

        const still = VehicleModel.getById(vehicle.id, 1);
        assert.equal(still?.active_alerts, 1);
    });
});
