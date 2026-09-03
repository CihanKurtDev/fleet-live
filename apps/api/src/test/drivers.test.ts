import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { insertAlert, loginAs } from "./helpers";

function requireCurrentDriver(vehicle: {
    current_driver_id: number | null;
}): number {
    assert.ok(vehicle.current_driver_id);
    return vehicle.current_driver_id;
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/drivers", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/drivers");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lists only this company's drivers with SPEEDING counts", async () => {
        const mine = VehicleModel.create({
            license_plate: "K-OWN 1",
            driver_name: "Anna",
            company_id: 1,
        });
        VehicleModel.create({
            license_plate: "K-OWN 2",
            driver_name: "Anna",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-OTH 1",
            driver_name: "Anna",
            company_id: 2,
        });

        insertAlert(mine.id, { type: "SPEEDING" });
        insertAlert(mine.id, {
            type: "LOW_FUEL",
            resolved_at: "2026-01-01 00:00:00",
        });
        insertAlert(other.id, { type: "OFFLINE" });

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 1);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].name, "Anna");
        assert.equal(response.body.data[0].vehicle_count, 2);
        assert.equal(response.body.data[0].vehicle_plate, null);
        assert.equal(response.body.data[0].current_vehicle_plate, "K-OWN 1");
        assert.equal(response.body.data[0].open_warnings, 1);
        assert.equal(response.body.data[0].counts.all, 1);
        assert.equal(response.body.data[0].counts.SPEEDING, 1);
        assert.equal(response.body.data[0].counts.LOW_FUEL, 0);
        assert.equal(response.body.data[0].counts.OFFLINE, 0);
    });

    it("sorts by open SPEEDING warnings and rejects injection", async () => {
        const quiet = VehicleModel.create({
            license_plate: "K-Q 1",
            driver_name: "Ben",
            company_id: 1,
        });
        const noisy = VehicleModel.create({
            license_plate: "K-N 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const noisySecond = VehicleModel.create({
            license_plate: "K-N 2",
            driver_name: "Anna",
            company_id: 1,
        });

        insertAlert(quiet.id, { type: "SPEEDING" });
        insertAlert(noisy.id, { type: "SPEEDING" });
        insertAlert(noisySecond.id, {
            type: "SPEEDING",
            driver_id: requireCurrentDriver(noisy),
        });
        insertAlert(noisy.id, { type: "LOW_FUEL" });

        const ordered = await api.get("/api/drivers").query({
            sort: "open_warnings",
            dir: "desc",
        });

        assert.equal(ordered.status, 200);
        assert.deepEqual(
            ordered.body.data.map((row: { name: string }) => row.name),
            ["Anna", "Ben"],
        );
        assert.equal(ordered.body.data[0].open_warnings, 2);

        const rejected = await api.get("/api/drivers").query({
            sort: "name;DROP TABLE drivers",
        });

        assert.equal(rejected.status, 400);
        assert.equal(rejected.body.code, "VALIDATION_ERROR");
    });

    it("counts zero open warnings when a driver has a vehicle but no alerts", async () => {
        VehicleModel.create({
            license_plate: "K-NONE 1",
            driver_name: "Ben",
            company_id: 1,
        });

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.data[0].open_warnings, 0);
        assert.equal(response.body.data[0].counts.all, 0);
        assert.equal(response.body.data[0].vehicle_count, 1);
        assert.equal(response.body.data[0].vehicle_plate, "K-NONE 1");
        assert.equal(response.body.data[0].current_vehicle_plate, "K-NONE 1");
    });

    it("upserts the same name in one company and isolates names across companies", async () => {
        const first = VehicleModel.create({
            license_plate: "K-A 1",
            driver_name: "Clara",
            company_id: 1,
        });
        const second = VehicleModel.create({
            license_plate: "K-A 2",
            driver_name: "Clara",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-B 1",
            driver_name: "Clara",
            company_id: 2,
        });

        assert.ok(first.current_driver_id);
        assert.equal(second.current_driver_id, null);
        assert.notEqual(first.current_driver_id, other.current_driver_id);

        const detail = await api.get(
            `/api/drivers/${first.current_driver_id}`,
        );
        assert.equal(detail.body.data.vehicles.length, 2);

        const otherApi = (await loginAs(2)).agent;
        const mine = await api.get("/api/drivers");
        const theirs = await otherApi.get("/api/drivers");

        assert.equal(mine.body.data.length, 1);
        assert.equal(theirs.body.data.length, 1);
        assert.notEqual(mine.body.data[0].id, theirs.body.data[0].id);
    });

    it("lets a viewer read drivers", async () => {
        VehicleModel.create({
            license_plate: "K-VW 1",
            driver_name: "Viewer",
            company_id: 1,
        });

        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
    });

    it("filters drivers assigned to a vehicle of this company", async () => {
        const anna = VehicleModel.create({
            license_plate: "K-F 1",
            driver_name: "Anna",
            company_id: 1,
        });
        VehicleModel.create({
            license_plate: "K-F 2",
            driver_name: "Ben",
            company_id: 1,
        });

        const response = await api.get("/api/drivers").query({
            vehicle_id: anna.id,
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 1);
        assert.equal(response.body.data[0].name, "Anna");
    });

    it("returns 404 when filtering by another company's vehicle_id", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 8",
            driver_name: "Fremde",
            company_id: 2,
        });

        const response = await api.get("/api/drivers").query({
            vehicle_id: other.id,
        });

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
    });
});

describe("GET /api/drivers/:id", () => {
    it("returns vehicles and SPEEDING counts including resolved rows", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-D 1",
            driver_name: "Dana",
            company_id: 1,
        });
        insertAlert(vehicle.id, { type: "SPEEDING" });
        insertAlert(vehicle.id, {
            type: "SPEEDING",
            resolved_at: "2026-01-02 00:00:00",
            ended_at: "2026-01-02 00:00:00",
        });
        insertAlert(vehicle.id, { type: "OFFLINE" });

        const response = await api.get(
            `/api/drivers/${requireCurrentDriver(vehicle)}`,
        );

        assert.equal(response.status, 200);
        assert.equal(response.body.data.name, "Dana");
        assert.equal(response.body.data.counts.SPEEDING, 2);
        assert.equal(response.body.data.counts.OFFLINE, 0);
        assert.equal(response.body.data.counts.all, 2);
        assert.equal(response.body.data.open_warnings, 1);
        assert.equal(response.body.data.vehicles.length, 1);
        assert.equal(response.body.data.vehicles[0].license_plate, "K-D 1");
        assert.equal(response.body.data.vehicles[0].is_current, true);
        assert.equal(
            response.body.data.current_vehicle.license_plate,
            "K-D 1",
        );
    });

    it("returns 404 for another company's driver", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 9",
            driver_name: "Fremde",
            company_id: 2,
        });

        const response = await api.get(
            `/api/drivers/${requireCurrentDriver(other)}`,
        );

        assert.equal(response.status, 404);
        assert.equal(response.body.code, "NOT_FOUND");
    });
});

describe("POST /api/drivers", () => {
    it("creates a driver by name", async () => {
        const created = await api.post("/api/drivers").send({ name: "Elisa" });

        assert.equal(created.status, 201);
        assert.equal(created.body.data.name, "Elisa");
        assert.equal(
            created.headers.location,
            `/api/drivers/${created.body.data.id}`,
        );

        const duplicate = await api.post("/api/drivers").send({ name: "Elisa" });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.body.code, "CONFLICT");
    });

    it("rejects an empty name", async () => {
        const response = await api.post("/api/drivers").send({ name: "  " });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });

    it("forbids a viewer from creating drivers", async () => {
        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer.post("/api/drivers").send({ name: "No" });

        assert.equal(response.status, 403);
        assert.equal(response.body.code, "FORBIDDEN");
    });
});

describe("driver assignment", () => {
    it("assigns eligibility without making the vehicle current", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-POOL 1",
            fuel_level: 40,
            status: "IDLE",
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.current_driver_id, null);
        assert.equal(created.body.driver_name, null);

        const driver = await api.post("/api/drivers").send({ name: "Finn" });
        const assigned = await api
            .post(`/api/drivers/${driver.body.data.id}/vehicles`)
            .send({ vehicle_id: created.body.id });

        assert.equal(assigned.status, 201);
        assert.equal(assigned.body.data.vehicles.length, 1);
        assert.equal(assigned.body.data.vehicles[0].is_current, false);
        assert.equal(assigned.body.data.current_vehicle, null);

        const vehicle = await api.get(`/api/vehicles/${created.body.id}`);
        assert.equal(vehicle.body.current_driver_id, null);
    });

    it("sets, transfers and clears the current vehicle atomically", async () => {
        const first = VehicleModel.create({
            license_plate: "K-CUR 1",
            driver_name: "Greta",
            company_id: 1,
        });
        const second = VehicleModel.create({
            license_plate: "K-CUR 2",
            company_id: 1,
        });
        const gretaId = requireCurrentDriver(first);
        const otherDriver = await api.post("/api/drivers").send({ name: "Hugo" });

        await api
            .post(`/api/drivers/${gretaId}/vehicles`)
            .send({ vehicle_id: second.id });
        await api
            .post(`/api/drivers/${otherDriver.body.data.id}/vehicles`)
            .send({ vehicle_id: second.id });
        await api
            .patch(`/api/drivers/${otherDriver.body.data.id}/current-vehicle`)
            .send({ vehicle_id: second.id });

        const transferred = await api
            .patch(`/api/drivers/${gretaId}/current-vehicle`)
            .send({ vehicle_id: second.id });

        assert.equal(transferred.status, 200);
        assert.equal(
            transferred.body.data.current_vehicle.license_plate,
            "K-CUR 2",
        );

        const firstAfter = await api.get(`/api/vehicles/${first.id}`);
        const secondAfter = await api.get(`/api/vehicles/${second.id}`);
        assert.equal(firstAfter.body.current_driver_id, null);
        assert.equal(secondAfter.body.current_driver_id, gretaId);
        assert.equal(secondAfter.body.driver_name, "Greta");

        const hugo = await api.get(
            `/api/drivers/${otherDriver.body.data.id}`,
        );
        assert.equal(hugo.body.data.current_vehicle, null);
        assert.equal(hugo.body.data.vehicles.length, 1);

        const cleared = await api
            .patch(`/api/drivers/${gretaId}/current-vehicle`)
            .send({ vehicle_id: null });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.body.data.current_vehicle, null);

        const pool = await api.get(`/api/vehicles/${second.id}`);
        assert.equal(pool.body.current_driver_id, null);
        assert.equal(pool.body.driver_name, null);
    });

    it("rejects setting current without eligibility", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-NO 1",
            company_id: 1,
        });
        const driver = await api.post("/api/drivers").send({ name: "Ina" });

        const response = await api
            .patch(`/api/drivers/${driver.body.data.id}/current-vehicle`)
            .send({ vehicle_id: vehicle.id });

        assert.equal(response.status, 409);
        assert.equal(response.body.code, "CONFLICT");
        assert.equal(
            response.body.error,
            "Das Fahrzeug ist diesem Fahrer nicht zugewiesen.",
        );
    });

    it("rejects changing current vehicle while the driver is on a trip", async () => {
        const current = VehicleModel.create({
            license_plate: "K-DRV 1",
            driver_name: "Karl",
            company_id: 1,
            status: "DRIVING",
        });
        const other = VehicleModel.create({
            license_plate: "K-DRV 2",
            company_id: 1,
            status: "IDLE",
        });
        const driverId = requireCurrentDriver(current);

        await api
            .post(`/api/drivers/${driverId}/vehicles`)
            .send({ vehicle_id: other.id });

        const switchCurrent = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: other.id });

        assert.equal(switchCurrent.status, 409);
        assert.equal(switchCurrent.body.code, "CONFLICT");
        assert.equal(
            switchCurrent.body.error,
            "Fahrer ist noch unterwegs. Aktuelles Fahrzeug lässt sich erst nach der Fahrt wechseln.",
        );

        const clearCurrent = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: null });

        assert.equal(clearCurrent.status, 409);
    });

    it("clears current when eligibility is removed", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-DEL 1",
            driver_name: "Jonas",
            company_id: 1,
        });
        const driverId = requireCurrentDriver(vehicle);

        const removed = await api.delete(
            `/api/drivers/${driverId}/vehicles/${vehicle.id}`,
        );

        assert.equal(removed.status, 200);
        assert.equal(removed.body.data.vehicles.length, 0);

        const after = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(after.body.current_driver_id, null);
    });

    it("does not move a SPEEDING snapshot when the current driver changes", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-SNAP 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const annaId = requireCurrentDriver(vehicle);
        insertAlert(vehicle.id, { type: "SPEEDING", message: "anna-tempo" });

        const ben = await api.post("/api/drivers").send({ name: "Ben" });
        await api
            .post(`/api/drivers/${ben.body.data.id}/vehicles`)
            .send({ vehicle_id: vehicle.id });
        await api
            .patch(`/api/drivers/${ben.body.data.id}/current-vehicle`)
            .send({ vehicle_id: vehicle.id });

        const annaAlerts = await api.get("/api/alerts").query({
            driver_id: annaId,
            filter: "all",
        });
        const benAlerts = await api.get("/api/alerts").query({
            driver_id: ben.body.data.id,
            filter: "all",
        });

        assert.equal(annaAlerts.body.data.length, 1);
        assert.equal(annaAlerts.body.data[0].message, "anna-tempo");
        assert.equal(benAlerts.body.data.length, 0);
    });

    it("returns 404 for another company's vehicle on assign", async () => {
        const other = VehicleModel.create({
            license_plate: "K-FRD 2",
            driver_name: "Fremde",
            company_id: 2,
        });
        const driver = await api.post("/api/drivers").send({ name: "Kim" });

        const response = await api
            .post(`/api/drivers/${driver.body.data.id}/vehicles`)
            .send({ vehicle_id: other.id });

        assert.equal(response.status, 404);
    });

    it("forbids a viewer from assignment writes", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-VW 9",
            driver_name: "Lia",
            company_id: 1,
        });
        const driverId = requireCurrentDriver(vehicle);
        const viewer = (await loginAs(1, "viewer")).agent;

        const assign = await viewer
            .post(`/api/drivers/${driverId}/vehicles`)
            .send({ vehicle_id: vehicle.id });
        assert.equal(assign.status, 403);

        const current = await viewer
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: null });
        assert.equal(current.status, 403);

        const removed = await viewer.delete(
            `/api/drivers/${driverId}/vehicles/${vehicle.id}`,
        );
        assert.equal(removed.status, 403);
    });
});

describe("vehicle create no longer upserts drivers from the body", () => {
    it("creates a pool vehicle and ignores driver_name on HTTP writes", async () => {
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-UP 1",
            driver_name: "Alt",
            fuel_level: 50,
            status: "IDLE",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.current_driver_id, null);
        assert.equal(created.body.driver_name, null);

        const drivers = await api.get("/api/drivers");
        assert.equal(drivers.body.meta.total, 0);

        const patched = await api.patch(`/api/vehicles/${created.body.id}`).send({
            driver_name: "Neu",
        });
        assert.equal(patched.status, 400);
        assert.equal(
            patched.body.error,
            "Mindestens ein Feld ist erforderlich.",
        );
    });
});
