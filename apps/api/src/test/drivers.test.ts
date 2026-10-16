import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { DRIVER_TALK_MIN_OPEN_WARNINGS } from "@fleet-live/shared";
import { app } from "../app";
import { db } from "../db/database";
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
        assert.equal(response.body.data[0].current_vehicle_status, "IDLE");
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

        const byDefault = await api.get("/api/drivers");
        assert.equal(byDefault.status, 200);
        assert.deepEqual(
            byDefault.body.data.map((row: { name: string }) => row.name),
            ["Anna", "Ben"],
        );

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
        assert.equal(response.body.data[0].current_vehicle_status, "IDLE");
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

describe("GET /api/drivers board filters", () => {
    /** Open SPEEDING rows; `ended_at` set so one vehicle may hold several. */
    function openWarnings(vehicleId: number, count: number, createdAt?: string) {
        for (let index = 0; index < count; index += 1) {
            insertAlert(vehicleId, {
                type: "SPEEDING",
                ended_at: "2026-01-01 00:00:00",
                created_at: createdAt,
            });
        }
    }

    it("keeps the list unchanged without the new params", async () => {
        const anna = VehicleModel.create({
            license_plate: "K-BF 1",
            driver_name: "Anna",
            company_id: 1,
        });
        await api.post("/api/drivers").send({ name: "Pool" });
        openWarnings(anna.id, 2);

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 2);
        assert.deepEqual(
            response.body.data.map((row: { name: string }) => row.name),
            ["Anna", "Pool"],
        );
    });

    it("filters by a minimum of open SPEEDING warnings and counts the filtered total", async () => {
        const anna = VehicleModel.create({
            license_plate: "K-BF 2",
            driver_name: "Anna",
            company_id: 1,
        });
        const ben = VehicleModel.create({
            license_plate: "K-BF 3",
            driver_name: "Ben",
            company_id: 1,
        });
        const clara = VehicleModel.create({
            license_plate: "K-BF 4",
            driver_name: "Clara",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-BF 9",
            driver_name: "Fremde",
            company_id: 2,
        });

        openWarnings(anna.id, 5, "2026-03-01 08:00:00");
        insertAlert(anna.id, {
            type: "SPEEDING",
            ended_at: "2026-03-02 09:00:00",
            created_at: "2026-03-02 09:00:00",
        });
        openWarnings(ben.id, 4);
        // Resolved rows and other types do not count.
        insertAlert(ben.id, {
            type: "SPEEDING",
            ended_at: "2026-01-01 00:00:00",
            resolved_at: "2026-01-02 00:00:00",
        });
        insertAlert(ben.id, { type: "LOW_FUEL" });
        openWarnings(clara.id, 7);
        openWarnings(other.id, 9);

        const response = await api.get("/api/drivers").query({
            min_open_warnings: 5,
            limit: 10,
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 2);
        assert.deepEqual(
            response.body.data.map((row: { name: string }) => row.name),
            ["Clara", "Anna"],
        );
        const annaRow = response.body.data.find(
            (row: { name: string }) => row.name === "Anna",
        );
        assert.equal(annaRow.open_warnings, 6);
        assert.equal(annaRow.last_warning_at, "2026-03-02 09:00:00");

        const searched = await api.get("/api/drivers").query({
            min_open_warnings: 5,
            search: "ann",
        });
        assert.equal(searched.body.meta.total, 1);
        assert.equal(searched.body.data[0].name, "Anna");

        const theirs = await (await loginAs(2)).agent
            .get("/api/drivers")
            .query({ min_open_warnings: 5 });
        assert.equal(theirs.status, 200);
        assert.deepEqual(
            theirs.body.data.map((row: { name: string }) => row.name),
            ["Fremde"],
        );
    });

    it("reports no last warning without open SPEEDING rows", async () => {
        const quiet = VehicleModel.create({
            license_plate: "K-BF 5",
            driver_name: "Quiet",
            company_id: 1,
        });
        insertAlert(quiet.id, {
            type: "SPEEDING",
            ended_at: "2026-01-01 00:00:00",
            resolved_at: "2026-01-02 00:00:00",
        });

        const response = await api.get("/api/drivers");

        assert.equal(response.status, 200);
        assert.equal(response.body.data[0].last_warning_at, null);
    });

    it("filters drivers without a current vehicle", async () => {
        VehicleModel.create({
            license_plate: "K-BF 6",
            driver_name: "Driving",
            company_id: 1,
        });
        const eligible = await api.post("/api/drivers").send({ name: "Eligible" });
        await api.post("/api/drivers").send({ name: "Nobody" });
        const spare = VehicleModel.create({
            license_plate: "K-BF 7",
            company_id: 1,
        });
        const assigned = await api
            .post(`/api/drivers/${eligible.body.data.id}/vehicles`)
            .send({ vehicle_id: spare.id });
        assert.equal(assigned.status, 201);

        VehicleModel.create({
            license_plate: "K-BF 8",
            company_id: 2,
        });
        const otherApi = (await loginAs(2)).agent;
        await otherApi.post("/api/drivers").send({ name: "Fremd ohne" });

        const response = await api.get("/api/drivers").query({
            without_vehicle: "true",
            sort: "name",
            dir: "asc",
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 2);
        assert.deepEqual(
            response.body.data.map(
                (row: { name: string; vehicle_count: number }) => [
                    row.name,
                    row.vehicle_count,
                ],
            ),
            [
                ["Eligible", 1],
                ["Nobody", 0],
            ],
        );
        assert.ok(
            response.body.data.every(
                (row: { current_vehicle_plate: string | null }) =>
                    row.current_vehicle_plate === null,
            ),
        );

        const theirs = await otherApi
            .get("/api/drivers")
            .query({ without_vehicle: "true" });
        assert.deepEqual(
            theirs.body.data.map((row: { name: string }) => row.name),
            ["Fremd ohne"],
        );
    });

    it("rejects invalid filter values", async () => {
        for (const query of [
            { min_open_warnings: "0" },
            { min_open_warnings: "abc" },
            { min_open_warnings: "2.5" },
            { min_open_warnings: "1001" },
            { without_vehicle: "yes" },
            { without_vehicle: "false" },
        ]) {
            const response = await api.get("/api/drivers").query(query);

            assert.equal(response.status, 400, JSON.stringify(query));
            assert.equal(response.body.code, "VALIDATION_ERROR");
        }
    });

    it("requires a session for the filters", async () => {
        const response = await request(app)
            .get("/api/drivers")
            .query({ min_open_warnings: 5, without_vehicle: "true" });

        assert.equal(response.status, 401);
    });
});

describe("GET /api/drivers page size and tile counts", () => {
    function seedDrivers(count: number) {
        for (let index = 0; index < count; index += 1) {
            VehicleModel.create({
                license_plate: `K-PS ${index + 1}`,
                driver_name: `Fahrer ${String(index + 1).padStart(2, "0")}`,
                company_id: 1,
            });
        }
    }

    it("serves the page size the list measured", async () => {
        seedDrivers(12);

        const response = await api
            .get("/api/drivers")
            .query({ page: 2, limit: 7, sort: "name", dir: "asc" });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.length, 5);
        assert.equal(response.body.meta.limit, 7);
        assert.equal(response.body.meta.pageCount, 2);
    });

    it("rejects a limit outside 1 to 100", async () => {
        for (const limit of [0, 101, 2.5]) {
            const response = await api.get("/api/drivers").query({ limit });

            assert.equal(response.status, 400, `limit ${limit}`);
            assert.equal(response.body.code, "VALIDATION_ERROR");
        }
    });

    it("counts all, talk and without-vehicle drivers for the tiles", async () => {
        const anna = VehicleModel.create({
            license_plate: "K-TC 1",
            driver_name: "Anna",
            company_id: 1,
        });
        const ben = VehicleModel.create({
            license_plate: "K-TC 2",
            driver_name: "Ben",
            company_id: 1,
        });
        const other = VehicleModel.create({
            license_plate: "K-TC 9",
            driver_name: "Fremde",
            company_id: 2,
        });
        await api.post("/api/drivers").send({ name: "Pool" });
        for (let index = 0; index < DRIVER_TALK_MIN_OPEN_WARNINGS; index += 1) {
            insertAlert(anna.id, {
                type: "SPEEDING",
                ended_at: "2026-01-01 00:00:00",
            });
        }
        // Below the threshold, resolved rows and other companies do not count.
        for (let index = 0; index < DRIVER_TALK_MIN_OPEN_WARNINGS - 1; index += 1) {
            insertAlert(ben.id, {
                type: "SPEEDING",
                ended_at: "2026-01-01 00:00:00",
            });
        }
        insertAlert(ben.id, {
            type: "SPEEDING",
            ended_at: "2026-01-01 00:00:00",
            resolved_at: "2026-01-02 00:00:00",
        });
        for (let index = 0; index < 9; index += 1) {
            insertAlert(other.id, {
                type: "SPEEDING",
                ended_at: "2026-01-01 00:00:00",
            });
        }

        const all = await api.get("/api/drivers");
        assert.deepEqual(all.body.meta.counts, {
            all: 3,
            talk: 1,
            without_vehicle: 1,
        });

        // The numbers do not move with a tile filter, but follow the search.
        const filtered = await api
            .get("/api/drivers")
            .query({ without_vehicle: "true" });
        assert.equal(filtered.body.meta.total, 1);
        assert.deepEqual(filtered.body.meta.counts, all.body.meta.counts);

        const searched = await api.get("/api/drivers").query({ search: "ann" });
        assert.deepEqual(searched.body.meta.counts, {
            all: 1,
            talk: 1,
            without_vehicle: 0,
        });

        const theirs = await (await loginAs(2)).agent.get("/api/drivers");
        assert.deepEqual(theirs.body.meta.counts, {
            all: 1,
            talk: 1,
            without_vehicle: 0,
        });
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
        assert.equal(created.body.data.phone, null);
        assert.equal(
            created.headers.location,
            `/api/drivers/${created.body.data.id}`,
        );

        const duplicate = await api.post("/api/drivers").send({ name: "Elisa" });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.body.code, "CONFLICT");

        const listed = await api.get("/api/drivers").query({ search: "Elisa" });
        assert.equal(listed.body.data[0].current_vehicle_plate, null);
        assert.equal(listed.body.data[0].current_vehicle_status, null);
        assert.equal(listed.body.data[0].phone, null);
    });

    it("stores licence dates", async () => {
        const created = await api.post("/api/drivers").send({
            name: "Elisa",
            licence_expires_on: "15.06.2028",
            licence_checked_on: "2026-04-01",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.data.licence_expires_on, "2028-06-15");
        assert.equal(created.body.data.active, true);
        assert.equal(created.body.data.licence_checked_on, "2026-04-01");

        const patched = await api
            .patch(`/api/drivers/${created.body.data.id}`)
            .send({ licence_checked_on: "2026-09-01" });

        assert.equal(patched.status, 200);
        assert.equal(patched.body.data.licence_expires_on, "2028-06-15");
        assert.equal(patched.body.data.licence_checked_on, "2026-09-01");
    });

    it("stores an optional phone number", async () => {
        const created = await api.post("/api/drivers").send({
            name: "Elisa",
            phone: "+49 170 1234567",
        });

        assert.equal(created.status, 201);
        assert.equal(created.body.data.phone, "+49 170 1234567");

        const detail = await api.get(`/api/drivers/${created.body.data.id}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.phone, "+49 170 1234567");
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

describe("PATCH /api/drivers/:id", () => {
    it("renames a driver and updates the denormalized current name", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-REN 1",
            driver_name: "Altname",
            company_id: 1,
        });
        const driverId = requireCurrentDriver(vehicle);

        const patched = await api.patch(`/api/drivers/${driverId}`).send({
            name: "Neuname",
            phone: "0221 123",
        });

        assert.equal(patched.status, 200);
        assert.equal(patched.body.data.name, "Neuname");
        assert.equal(patched.body.data.phone, "0221 123");

        const listed = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(listed.body.driver_name, "Neuname");
    });

    it("forbids a viewer from patching drivers", async () => {
        const created = await api.post("/api/drivers").send({ name: "View" });
        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer
            .patch(`/api/drivers/${created.body.data.id}`)
            .send({ phone: "1" });

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

        const listed = await api.get("/api/drivers").query({ search: "Karl" });
        assert.equal(listed.body.data[0].current_vehicle_plate, "K-DRV 1");
        assert.equal(listed.body.data[0].current_vehicle_status, "DRIVING");

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
            "Karl ist noch unterwegs auf K-DRV 1. Aktuelles Fahrzeug lässt sich erst nach der Fahrt wechseln.",
        );

        const clearCurrent = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: null });

        assert.equal(clearCurrent.status, 409);
    });

    it("rejects taking over current on a driving vehicle", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-TO 1",
            driver_name: "Tom",
            company_id: 1,
            status: "DRIVING",
        });
        const tomId = requireCurrentDriver(vehicle);

        const other = await api.post("/api/drivers").send({ name: "Ute" });
        const uteId = other.body.data.id as number;

        await api
            .post(`/api/drivers/${uteId}/vehicles`)
            .send({ vehicle_id: vehicle.id });

        const takeover = await api
            .patch(`/api/drivers/${uteId}/current-vehicle`)
            .send({ vehicle_id: vehicle.id });

        assert.equal(takeover.status, 409);
        assert.equal(takeover.body.code, "CONFLICT");
        assert.match(
            takeover.body.error,
            /unterwegs.*erst nach der Fahrt wechseln/i,
        );

        const stillTom = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(stillTom.body.current_driver_id, tomId);
    });

    it("rejects unassigning the current driver while the vehicle is driving", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-UN 1",
            driver_name: "Vera",
            company_id: 1,
            status: "DRIVING",
        });
        const veraId = requireCurrentDriver(vehicle);

        const removed = await api.delete(
            `/api/drivers/${veraId}/vehicles/${vehicle.id}`,
        );

        assert.equal(removed.status, 409);
        assert.equal(removed.body.code, "CONFLICT");
        assert.match(
            removed.body.error,
            /unterwegs.*erst nach der Fahrt entfernen/i,
        );

        const still = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(still.body.current_driver_id, veraId);
        assert.equal(still.body.status, "DRIVING");
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

describe("DELETE /api/drivers/:id", () => {
    it("deletes the driver, clears vehicles and eligibility, keeps alerts without a driver", async () => {
        const current = VehicleModel.create({
            license_plate: "K-RM 1",
            driver_name: "Rita",
            company_id: 1,
        });
        const eligible = VehicleModel.create({
            license_plate: "K-RM 2",
            company_id: 1,
        });
        const ritaId = requireCurrentDriver(current);
        await api
            .post(`/api/drivers/${ritaId}/vehicles`)
            .send({ vehicle_id: eligible.id });
        const alertId = insertAlert(current.id, {
            type: "SPEEDING",
            message: "rita-tempo",
        });
        await api.post("/api/drivers").send({ name: "Sven" });

        const before = await api.get("/api/drivers");
        assert.equal(before.body.meta.total, 2);
        const eligibleBefore = await api
            .get("/api/drivers")
            .query({ vehicle_id: eligible.id });
        assert.equal(eligibleBefore.body.meta.total, 1);

        const removed = await api.delete(`/api/drivers/${ritaId}`);

        assert.equal(removed.status, 204);
        assert.equal(removed.text, "");

        const detail = await api.get(`/api/drivers/${ritaId}`);
        assert.equal(detail.status, 404);

        const after = await api.get("/api/drivers");
        assert.equal(after.body.meta.total, 1);
        assert.equal(after.body.data[0].name, "Sven");

        const vehicle = await api.get(`/api/vehicles/${current.id}`);
        assert.equal(vehicle.body.current_driver_id, null);
        assert.equal(vehicle.body.driver_name, null);

        const eligibleAfter = await api
            .get("/api/drivers")
            .query({ vehicle_id: eligible.id });
        assert.equal(eligibleAfter.body.meta.total, 0);
        const links = db
            .prepare(
                `SELECT COUNT(*) AS n FROM driver_vehicles WHERE driver_id = ?`,
            )
            .get(ritaId) as { n: number };
        assert.equal(links.n, 0);

        const alerts = await api
            .get("/api/alerts")
            .query({ vehicle_id: current.id, filter: "all" });
        assert.equal(alerts.body.data.length, 1);
        assert.equal(alerts.body.data[0].id, alertId);
        assert.equal(alerts.body.data[0].message, "rita-tempo");
        assert.equal(alerts.body.data[0].driver_id, null);
        assert.equal(alerts.body.data[0].driver_name, null);
    });

    it("rejects deleting a driver who is on a trip", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-RM 3",
            driver_name: "Tom",
            company_id: 1,
            status: "DRIVING",
        });
        const tomId = requireCurrentDriver(vehicle);

        const removed = await api.delete(`/api/drivers/${tomId}`);

        assert.equal(removed.status, 409);
        assert.equal(removed.body.code, "CONFLICT");
        assert.equal(
            removed.body.error,
            "Tom ist noch unterwegs auf K-RM 3. Der Fahrer lässt sich erst nach der Fahrt löschen.",
        );

        const still = await api.get(`/api/drivers/${tomId}`);
        assert.equal(still.status, 200);
        const stillVehicle = await api.get(`/api/vehicles/${vehicle.id}`);
        assert.equal(stillVehicle.body.current_driver_id, tomId);
    });

    it("forbids a viewer from deleting drivers", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-RM 4",
            driver_name: "Uli",
            company_id: 1,
        });
        const uliId = requireCurrentDriver(vehicle);
        const viewer = (await loginAs(1, "viewer")).agent;

        const removed = await viewer.delete(`/api/drivers/${uliId}`);

        assert.equal(removed.status, 403);
        const still = await api.get(`/api/drivers/${uliId}`);
        assert.equal(still.status, 200);
    });

    it("requires a session", async () => {
        const response = await request(app).delete("/api/drivers/1");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("returns 404 for another company's driver and leaves it in place", async () => {
        const other = VehicleModel.create({
            license_plate: "K-OTH 7",
            driver_name: "Fremde",
            company_id: 2,
        });
        const otherDriverId = requireCurrentDriver(other);

        const removed = await api.delete(`/api/drivers/${otherDriverId}`);

        assert.equal(removed.status, 404);
        assert.equal(removed.body.code, "NOT_FOUND");
        assert.equal(removed.body.error, "Fahrer nicht gefunden.");

        const row = db
            .prepare(`SELECT COUNT(*) AS n FROM drivers WHERE id = ?`)
            .get(otherDriverId) as { n: number };
        assert.equal(row.n, 1);
    });

    it("returns 404 for an unknown id", async () => {
        const removed = await api.delete("/api/drivers/999999");

        assert.equal(removed.status, 404);
        assert.equal(removed.body.code, "NOT_FOUND");
    });

    it("returns 400 for an invalid id", async () => {
        const removed = await api.delete("/api/drivers/abc");

        assert.equal(removed.status, 400);
        assert.equal(removed.body.code, "BAD_REQUEST");
        assert.equal(removed.body.error, "Ungültige Fahrer-ID.");
    });
});
