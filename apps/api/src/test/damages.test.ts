import "./env";
import assert from "node:assert/strict";
import { berlinTodayIso } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { giveCurrentDriver, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;
let me: number;
const today = berlinTodayIso();

function vehicle(plate: string) {
    return VehicleModel.create({
        company_id: 1,
        license_plate: plate,
        hu_due_on: "2099-01",
        uvv_due_on: "2099-01-01",
    });
}

async function report(vehicleId: number, body: Record<string, unknown> = {}) {
    return api.post(`/api/vehicles/${vehicleId}/damages`).send({
        occurred_on: today,
        description: "Delle Heckklappe",
        severity: "MEDIUM",
        drivable: true,
        ...body,
    });
}

async function plan(vehicleId: number, damageIds: number[]) {
    return api.post(`/api/vehicles/${vehicleId}/workshop`).send({
        reason: "DAMAGE",
        place: "Karosserie Schmitz",
        planned_on: today,
        assignee_user_id: me,
        damage_ids: damageIds,
    });
}

const counts = async () => (await api.get("/api/vehicles")).body.meta.counts;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
    me = (await api.get("/api/auth/me")).body.id as number;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("damages", () => {
    it("requires a session", async () => {
        assert.equal((await request(app).get("/api/vehicles/1/damages")).status, 401);
    });

    it("reports a drivable damage: open, counted, the vehicle stays ready", async () => {
        const car = vehicle("K-SCH 1");
        const created = await report(car.id);

        assert.equal(created.status, 201);
        assert.equal(created.body.data.state, "OPEN");
        assert.equal(created.body.data.reported_by_name, "dispatcher 1");

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.open_damages, 1);
        assert.equal(detail.availability, "READY");
        assert.equal((await counts()).damage_open, 1);
        assert.equal((await counts()).not_drivable, 0);
    });

    it("validates the report", async () => {
        const car = vehicle("K-SCH 2");
        const empty = await report(car.id, { description: " " });
        assert.equal(empty.status, 400);
        assert.ok(empty.body.fields.description);

        const future = await report(car.id, { occurred_on: "2999-01-01" });
        assert.equal(future.status, 400);
        assert.ok(future.body.fields.occurred_on);
    });

    it("takes a not drivable vehicle off the road and lists it in Heute dran", async () => {
        const car = vehicle("K-SCH 3");
        const driverId = await giveCurrentDriver(api, car.id);
        const created = await report(car.id, { drivable: false, severity: "SEVERE" });
        assert.equal(created.status, 201);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.availability, "NOT_DRIVABLE");
        assert.equal(detail.current_driver_id, null);

        const assign = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: car.id });
        assert.equal(assign.status, 409);
        assert.equal(assign.body.code, "VEHICLE_UNAVAILABLE");

        const today = (await api.get("/api/today")).body;
        assert.equal(today.meta.counts.damage_unplanned, 1);
        const row = today.data.find((item: { kind: string }) => item.kind === "damage_unplanned");
        assert.equal(row.subject, "K-SCH 3");
        assert.equal(row.damage.id, created.body.data.id);
        assert.equal((await counts()).damage_unplanned, 1);
    });

    it("refuses „nicht fahrbereit“ while the vehicle drives", async () => {
        const car = vehicle("K-SCH 4");
        await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });

        const refused = await report(car.id, { drivable: false });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.code, "VEHICLE_DRIVING");

        const drivable = await report(car.id);
        assert.equal(drivable.status, 201);
        const patched = await api
            .patch(`/api/damages/${drivable.body.data.id}`)
            .send({ drivable: false });
        assert.equal(patched.status, 409);
    });

    it("goes through the workshop: planned, there, repaired", async () => {
        const car = vehicle("K-SCH 5");
        const damage = (await report(car.id, { drivable: false })).body.data;

        const visit = await plan(car.id, [damage.id]);
        assert.equal(visit.status, 201);

        const planned = (await api.get(`/api/vehicles/${car.id}/damages`)).body.data[0];
        assert.equal(planned.workshop_visit_id, visit.body.data.id);
        assert.equal(planned.workshop_state, "PLANNED");
        assert.equal((await counts()).damage_unplanned, 0);
        assert.equal((await counts()).not_drivable, 1);

        await api.post(`/api/workshop/${visit.body.data.id}/arrive`);
        assert.equal((await api.get(`/api/vehicles/${car.id}`)).body.availability, "WORKSHOP");
        assert.equal((await counts()).not_drivable, 0);

        const closeInStay = await api.post(`/api/damages/${damage.id}/close`);
        assert.equal(closeInStay.status, 409);

        await api
            .post(`/api/workshop/${visit.body.data.id}/finish`)
            .send({ finished_on: today, cost: "840" });
        const repaired = (await api.get(`/api/vehicles/${car.id}/damages`)).body.data[0];
        assert.equal(repaired.state, "REPAIRED");
        assert.equal(repaired.closed_on, today);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.availability, "READY");
        assert.equal(detail.open_damages, 0);
    });

    it("frees the damages again when the stay is cancelled", async () => {
        const car = vehicle("K-SCH 6");
        const damage = (await report(car.id, { drivable: false })).body.data;
        const visit = (await plan(car.id, [damage.id])).body.data;

        await api.post(`/api/workshop/${visit.id}/cancel`);
        const open = (await api.get(`/api/vehicles/${car.id}/damages`)).body.data[0];
        assert.equal(open.state, "OPEN");
        assert.equal(open.workshop_visit_id, null);
        assert.equal((await counts()).damage_unplanned, 1);
    });

    it("closes a damage without a workshop", async () => {
        const car = vehicle("K-SCH 7");
        const damage = (await report(car.id, { severity: "MINOR" })).body.data;

        const closed = await api.post(`/api/damages/${damage.id}/close`);
        assert.equal(closed.status, 200);
        assert.equal(closed.body.data.state, "CLOSED");
        assert.equal((await api.post(`/api/damages/${damage.id}/close`)).status, 409);
        assert.equal((await api.patch(`/api/damages/${damage.id}`).send({ severity: "SEVERE" })).status, 409);
    });

    it("links only open damages of the same vehicle", async () => {
        const car = vehicle("K-SCH 8");
        const other = vehicle("K-SCH 9");
        const foreign = (await report(other.id)).body.data;

        const wrong = await plan(car.id, [foreign.id]);
        assert.equal(wrong.status, 400);
        assert.ok(wrong.body.fields.damage_ids);
        // Nothing was written: the vehicle has no stay.
        assert.equal((await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.open, null);
    });

    it("keeps other companies out and viewers read-only", async () => {
        const car = vehicle("K-SCH 10");
        const damage = (await report(car.id)).body.data;
        const foreign = VehicleModel.create({ company_id: 2, license_plate: "B-FREMD 9" });

        assert.equal((await api.get(`/api/vehicles/${foreign.id}/damages`)).status, 404);
        assert.equal((await report(foreign.id)).status, 404);

        const other = (await loginAs(2)).agent;
        assert.equal((await other.post(`/api/damages/${damage.id}/close`)).status, 404);

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get(`/api/vehicles/${car.id}/damages`)).status, 200);
        assert.equal((await viewer.post(`/api/vehicles/${car.id}/damages`).send({})).status, 403);
        assert.equal((await viewer.post(`/api/damages/${damage.id}/close`)).status, 403);
    });
});
