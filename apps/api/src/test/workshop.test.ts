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

function shiftDays(iso: string, days: number): string {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function vehicle(plate: string, extra: Parameters<typeof VehicleModel.create>[0] = { license_plate: plate }) {
    return VehicleModel.create({
        company_id: 1,
        hu_due_on: "2020-01",
        uvv_due_on: "2099-01-01",
        ...extra,
        license_plate: plate,
    });
}

async function plan(vehicleId: number, body: Record<string, unknown> = {}) {
    return api.post(`/api/vehicles/${vehicleId}/workshop`).send({
        reason: "HU",
        place: "Prüfstelle Köln-Ost",
        planned_on: shiftDays(today, 3),
        expected_on: shiftDays(today, 4),
        assignee_user_id: me,
        note: "Bremsen mitprüfen lassen.",
        ...body,
    });
}

beforeEach(async () => {
    api = (await loginAs(1)).agent;
    me = (await api.get("/api/auth/me")).body.id as number;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("workshop stays", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/vehicles/1/workshop");
        assert.equal(response.status, 401);
    });

    it("plans a stay: open, on the vehicle, logged, still ready", async () => {
        const car = vehicle("K-CV 9419");
        const created = await plan(car.id);

        assert.equal(created.status, 201);
        assert.equal(created.body.data.state, "PLANNED");
        assert.equal(created.body.data.assignee_name, "dispatcher 1");

        const detail = await api.get(`/api/vehicles/${car.id}`);
        assert.equal(detail.body.availability, "READY");
        assert.equal(detail.body.workshop.state, "PLANNED");
        assert.equal(detail.body.workshop.place, "Prüfstelle Köln-Ost");

        const workshop = await api.get(`/api/vehicles/${car.id}/workshop`);
        assert.equal(workshop.body.data.open.id, created.body.data.id);
        assert.deepEqual(
            workshop.body.data.events.map((event: { action: string }) => event.action),
            ["planned"],
        );
        assert.equal(workshop.body.data.events[0].actor_name, "dispatcher 1");
    });

    it("lets a viewer read but not write", async () => {
        const car = vehicle("K-CV 1");
        await plan(car.id);
        const viewer = (await loginAs(1, "viewer")).agent;

        const read = await viewer.get(`/api/vehicles/${car.id}/workshop`);
        assert.equal(read.status, 200);
        assert.equal(read.body.data.open.state, "PLANNED");

        const write = await viewer.post(`/api/vehicles/${car.id}/workshop`).send({});
        assert.equal(write.status, 403);
        const arrive = await viewer.post(`/api/workshop/${read.body.data.open.id}/arrive`);
        assert.equal(arrive.status, 403);
    });

    it("keeps other companies out", async () => {
        const foreign = VehicleModel.create({ license_plate: "B-FREMD 1", company_id: 2 });
        assert.equal((await api.get(`/api/vehicles/${foreign.id}/workshop`)).status, 404);
        assert.equal((await plan(foreign.id)).status, 404);

        const other = (await loginAs(2)).agent;
        const otherMe = (await other.get("/api/auth/me")).body.id as number;
        const visit = await other.post(`/api/vehicles/${foreign.id}/workshop`).send({
            reason: "OTHER",
            place: "Berlin",
            planned_on: today,
            assignee_user_id: otherMe,
        });
        assert.equal(visit.status, 201);
        assert.equal((await api.post(`/api/workshop/${visit.body.data.id}/arrive`)).status, 404);
    });

    it("validates the assignee, the dates and a second open stay", async () => {
        const car = vehicle("K-CV 2");
        const viewer = UserModel.create({
            name: "Vera Viewer",
            email: "vera@example.com",
            password: "secret-password",
            company_id: 1,
            role: "viewer",
        });

        const notDispatcher = await plan(car.id, { assignee_user_id: viewer.id });
        assert.equal(notDispatcher.status, 400);
        assert.ok(notDispatcher.body.fields.assignee_user_id);

        const early = await plan(car.id, { expected_on: shiftDays(today, 1) });
        assert.equal(early.status, 400);
        assert.ok(early.body.fields.expected_on);

        const future = await plan(car.id, { arrived: true, planned_on: shiftDays(today, 1) });
        assert.equal(future.status, 400);
        assert.ok(future.body.fields.planned_on);

        assert.equal((await plan(car.id)).status, 201);
        const second = await plan(car.id);
        assert.equal(second.status, 409);
        assert.equal(second.body.code, "WORKSHOP_OPEN");
    });

    it("arrives only when the vehicle is not driving, and frees its driver", async () => {
        const car = vehicle("K-CV 3");
        const driverId = await giveCurrentDriver(api, car.id);
        const visit = (await plan(car.id)).body.data;

        assert.equal(
            (await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" })).status,
            200,
        );
        const driving = await api.post(`/api/workshop/${visit.id}/arrive`);
        assert.equal(driving.status, 409);
        assert.equal(driving.body.code, "VEHICLE_DRIVING");

        await api.patch(`/api/vehicles/${car.id}`).send({ status: "IDLE" });
        const arrived = await api.post(`/api/workshop/${visit.id}/arrive`);
        assert.equal(arrived.status, 200);
        assert.equal(arrived.body.data.state, "IN_WORKSHOP");
        assert.equal(arrived.body.data.arrived_on, today);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.availability, "WORKSHOP");
        assert.equal(detail.current_driver_id, null);
        assert.equal(detail.driver_name, null);

        const assign = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: car.id });
        assert.equal(assign.status, 409);
        assert.equal(assign.body.code, "VEHICLE_UNAVAILABLE");

        // Still allowed to drive it later: the eligibility stays.
        const roster = await api.get(`/api/drivers/${driverId}`);
        assert.ok(
            roster.body.data.vehicles.some((entry: { id: number }) => entry.id === car.id),
        );
    });

    it("finishes an HU with the new month and the cost", async () => {
        const car = vehicle("K-CV 4");
        const visit = (await plan(car.id, { arrived: true, planned_on: today })).body.data;
        assert.equal(visit.state, "IN_WORKSHOP");

        const planned = await api.post(`/api/workshop/${visit.id}/arrive`);
        assert.equal(planned.status, 409);

        const missing = await api.post(`/api/workshop/${visit.id}/finish`).send({
            finished_on: today,
        });
        assert.equal(missing.status, 400);
        assert.ok(missing.body.fields.hu_due_on);

        const badCost = await api.post(`/api/workshop/${visit.id}/finish`).send({
            finished_on: today,
            hu_due_on: "2028-10",
            cost: "viel",
        });
        assert.equal(badCost.status, 400);
        assert.ok(badCost.body.fields.cost);

        const done = await api.post(`/api/workshop/${visit.id}/finish`).send({
            finished_on: today,
            hu_due_on: "2028-10",
            cost: "128,50",
            result_note: "Bremsbeläge vorne erneuert.",
        });
        assert.equal(done.status, 200);
        assert.equal(done.body.data.state, "DONE");
        assert.equal(done.body.data.cost_cents, 12850);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.hu_due_on, "2028-10");
        assert.equal(detail.availability, "READY");
        assert.equal(detail.workshop, null);

        const workshop = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data;
        assert.equal(workshop.open, null);
        assert.equal(workshop.past[0].id, visit.id);
    });

    it("finishes a UVV: checked today, next date from the interval", async () => {
        const car = vehicle("K-CV 5", {
            license_plate: "K-CV 5",
            uvv_due_on: "2020-05-01",
        });
        const visit = (await plan(car.id, { reason: "UVV", arrived: true, planned_on: today }))
            .body.data;

        const done = await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today });
        assert.equal(done.status, 200);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.uvv_checked_on, today);
        assert.equal(detail.uvv_due_on, null);
    });

    it("cancels only a planned stay", async () => {
        const car = vehicle("K-CV 6");
        const visit = (await plan(car.id)).body.data;

        const cancelled = await api.post(`/api/workshop/${visit.id}/cancel`);
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.data.state, "CANCELLED");
        assert.equal((await api.post(`/api/workshop/${visit.id}/cancel`)).status, 409);

        const workshop = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data;
        assert.equal(workshop.open, null);
        assert.equal(workshop.past[0].state, "CANCELLED");
    });

    it("edits an open stay and logs the fields", async () => {
        const car = vehicle("K-CV 7");
        const visit = (await plan(car.id)).body.data;

        const edited = await api
            .patch(`/api/workshop/${visit.id}`)
            .send({ place: "Werkstatt Becker", expected_on: shiftDays(today, 6) });
        assert.equal(edited.status, 200);
        assert.equal(edited.body.data.place, "Werkstatt Becker");

        await api.post(`/api/workshop/${visit.id}/arrive`);
        const late = await api.patch(`/api/workshop/${visit.id}`).send({ reason: "UVV" });
        assert.equal(late.status, 400);

        const events = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.events;
        assert.deepEqual(
            events.map((event: { action: string }) => event.action),
            ["arrived", "updated", "planned"],
        );
        assert.deepEqual(events[1].details.fields.sort(), ["expected_on", "place"]);

        const places = await api.get("/api/workshop/places");
        assert.deepEqual(places.body.data, ["Werkstatt Becker"]);
    });
});

describe("workshop counts", () => {
    it("counts a vehicle in a workshop the same on the list, the filter and Schicht", async () => {
        const there = vehicle("K-IN 1");
        vehicle("K-OUT 1");
        await plan(there.id, { arrived: true, planned_on: today });

        const list = (await api.get("/api/vehicles")).body;
        assert.equal(list.meta.counts.in_workshop, 1);

        const filtered = (await api.get("/api/vehicles?filter=in_workshop")).body;
        assert.deepEqual(
            filtered.data.map((row: { license_plate: string }) => row.license_plate),
            ["K-IN 1"],
        );

        const briefing = (await api.get("/api/briefing")).body.data;
        assert.equal(briefing.counts.in_workshop, 1);
    });

    it("lists due stays in Heute dran, mine first, and the chip's filter matches", async () => {
        const colleague = UserModel.create({
            name: "Lea Brandt",
            email: "lea@example.com",
            password: "secret-password",
            company_id: 1,
            role: "dispatcher",
        });
        const appointment = vehicle("K-TERMIN 1");
        const late = vehicle("K-SPAET 1");
        const later = vehicle("K-SPAETER 1");

        await plan(appointment.id, {
            planned_on: today,
            expected_on: null,
            assignee_user_id: colleague.id,
        });
        await plan(late.id, {
            arrived: true,
            planned_on: shiftDays(today, -5),
            expected_on: shiftDays(today, -1),
        });
        await plan(later.id);

        const todayList = (await api.get("/api/today")).body;
        assert.equal(todayList.meta.counts.workshop_due, 2);
        const rows = todayList.data.filter(
            (item: { kind: string }) => item.kind === "workshop_due",
        );
        assert.deepEqual(
            rows.map((item: { subject: string }) => item.subject),
            ["K-SPAET 1", "K-TERMIN 1"],
        );
        assert.equal(rows[1].workshop.assignee_name, "Lea Brandt");

        const chip = (await api.get("/api/vehicles?filter=workshop_due")).body;
        assert.equal(chip.meta.total, 2);
    });

    it("shows the stay on the matching HU row of /fristen", async () => {
        const car = vehicle("K-HU 9");
        const visit = (await plan(car.id)).body.data;

        const due = (await api.get("/api/due?state=overdue&kind=hu")).body;
        const row = due.data.find((entry: { label: string }) => entry.label === "K-HU 9");
        assert.equal(row.workshop.id, visit.id);
        assert.equal(row.workshop.state, "PLANNED");
    });
});

describe("out of service", () => {
    it("takes a vehicle out of service and back", async () => {
        const car = vehicle("K-AD 1");
        const driverId = await giveCurrentDriver(api, car.id);

        const out = await api.patch(`/api/vehicles/${car.id}/availability`).send({
            out_of_service: true,
        });
        assert.equal(out.status, 200);
        assert.equal(out.body.data.availability, "OUT_OF_SERVICE");
        assert.equal(out.body.data.current_driver_id, null);

        assert.equal(
            (await api.get("/api/vehicles?filter=out_of_service")).body.meta.total,
            1,
        );
        const assign = await api
            .patch(`/api/drivers/${driverId}/current-vehicle`)
            .send({ vehicle_id: car.id });
        assert.equal(assign.body.code, "VEHICLE_UNAVAILABLE");

        const back = await api.patch(`/api/vehicles/${car.id}/availability`).send({
            out_of_service: false,
        });
        assert.equal(back.body.data.availability, "READY");
    });

    it("refuses while the vehicle is in a workshop", async () => {
        const car = vehicle("K-AD 2");
        await plan(car.id, { arrived: true, planned_on: today });

        const out = await api.patch(`/api/vehicles/${car.id}/availability`).send({
            out_of_service: true,
        });
        assert.equal(out.status, 409);
        assert.equal(out.body.code, "VEHICLE_IN_WORKSHOP");
    });

    it("is for dispatchers only", async () => {
        const car = vehicle("K-AD 3");
        const viewer = (await loginAs(1, "viewer")).agent;
        const out = await viewer.patch(`/api/vehicles/${car.id}/availability`).send({
            out_of_service: true,
        });
        assert.equal(out.status, 403);
    });
});
