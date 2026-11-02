import "./env";
import assert from "node:assert/strict";
import { berlinTodayIso } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { migrate } from "../db/migrate";
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
    const place = (await api.get("/api/workshop/places")).body.data[0] ??
        (
            await api.post("/api/workshop/places").send({
                name: "Karosserie Schmitz",
                latitude: 50.98,
                longitude: 6.97,
            })
        ).body.data;
    return api.post(`/api/vehicles/${vehicleId}/workshop`).send({
        reasons: ["DAMAGE"],
        transport: "TOW",
        workshop_id: place.id,
        planned_on: today,
        expected_on: today,
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

    it("stops a vehicle that breaks down on a trip and keeps where, when and who", async () => {
        const car = vehicle("K-SCH 4");
        const driverId = await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });
        const open = await api.get(`/api/vehicles/${car.id}/trips/latest`);
        assert.equal(open.body.data.ended_at, null);

        const created = await report(car.id, {
            drivable: false,
            occurred_time: "07:42",
            latitude: 50.95,
            longitude: 6.93,
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.data.occurred_time, "07:42");
        assert.equal(created.body.data.latitude, 50.95);
        assert.equal(created.body.data.longitude, 6.93);
        assert.equal(created.body.data.driver_id, driverId);
        assert.ok(created.body.data.driver_name);
        assert.deepEqual(created.body.data.photo_ids, []);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.status, "IDLE");
        assert.equal(detail.current_driver_id, null);
        assert.equal(detail.availability, "NOT_DRIVABLE");
        const trip = (await api.get(`/api/vehicles/${car.id}/trips/latest`)).body.data;
        assert.notEqual(trip.ended_at, null);

        // The driver snapshot stays when the driver is gone from the vehicle.
        const listed = (await api.get(`/api/vehicles/${car.id}/damages`)).body.data[0];
        assert.equal(listed.driver_id, driverId);
    });

    it("stops a driving vehicle when a damage becomes undrivable", async () => {
        const car = vehicle("K-SCH 5");
        await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });
        const damage = (await report(car.id)).body.data;

        const patched = await api.patch(`/api/damages/${damage.id}`).send({ drivable: false });
        assert.equal(patched.status, 200);
        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.status, "IDLE");
        assert.equal(detail.current_driver_id, null);
    });

    it("switches a planned stay brought by a driver to towing once the vehicle cannot be driven", async () => {
        const car = vehicle("K-SCH 11");
        const driverId = await giveCurrentDriver(api, car.id);
        const place = (
            await api.post("/api/workshop/places").send({ name: "Karosserie Abt", latitude: 50.99, longitude: 6.98 })
        ).body.data;
        const stay = await api.post(`/api/vehicles/${car.id}/workshop`).send({
            reasons: ["MAINTENANCE"],
            transport: "DRIVER",
            bring_driver_id: driverId,
            workshop_id: place.id,
            planned_on: today,
            expected_on: today,
            assignee_user_id: me,
        });
        assert.equal(stay.status, 201);

        assert.equal((await report(car.id, { drivable: false })).status, 201);

        const workshop = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data;
        assert.equal(workshop.open.transport, "TOW");
        assert.equal(workshop.open.bring_driver_id, null);
        assert.ok(
            workshop.events.some(
                (event: { action: string; details: { fields?: string[] } | null }) =>
                    event.action === "updated" && event.details?.fields?.includes("transport"),
            ),
        );
        // No task „Hinfahrt ohne Fahrer“ that could not be done.
        assert.equal((await api.get(`/api/vehicles/${car.id}`)).body.workshop_task, null);
    });

    it("repairs an older planned stay brought by a driver at the next start", async () => {
        const car = vehicle("K-SCH 12");
        await report(car.id, { drivable: false });
        // A row from before: a driver was to bring a vehicle that cannot be driven.
        const stay = db
            .prepare(
                `INSERT INTO workshop_visits (vehicle_id, reasons, transport, state, place, planned_on, expected_on)
                 VALUES (?, json_array('DAMAGE'), 'DRIVER', 'PLANNED', 'Alt', ?, ?)`,
            )
            .run(car.id, today, today);

        migrate(db);

        const row = db
            .prepare("SELECT transport, bring_driver_id FROM workshop_visits WHERE id = ?")
            .get(Number(stay.lastInsertRowid)) as { transport: string; bring_driver_id: number | null };
        assert.equal(row.transport, "TOW");
        assert.equal(row.bring_driver_id, null);
    });

    it("validates time and place", async () => {
        const car = vehicle("K-SCH 6");
        const badTime = await report(car.id, { occurred_time: "25:00" });
        assert.equal(badTime.status, 400);
        assert.ok(badTime.body.fields.occurred_time);

        const half = await report(car.id, { latitude: 50.9 });
        assert.equal(half.status, 400);
        assert.ok(half.body.fields.latitude);
    });

    it("keeps up to three photos and serves them only to the company", async () => {
        const car = vehicle("K-SCH 7");
        const damage = (await report(car.id)).body.data;
        const upload = () =>
            api
                .post(`/api/damages/${damage.id}/photos`)
                .set("Content-Type", "image/jpeg")
                .send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]));

        const first = await upload();
        assert.equal(first.status, 201);
        assert.equal(first.body.data.photo_ids.length, 1);
        await upload();
        await upload();
        const full = await upload();
        assert.equal(full.status, 409);
        assert.equal(full.body.code, "DAMAGE_PHOTOS_FULL");

        const photoId = first.body.data.photo_ids[0];
        const served = await api.get(`/api/damages/${damage.id}/photos/${photoId}`);
        assert.equal(served.status, 200);
        assert.equal(served.headers["content-type"], "image/jpeg");
        assert.equal(served.headers["x-content-type-options"], "nosniff");

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get(`/api/damages/${damage.id}/photos/${photoId}`)).status, 200);
        assert.equal(
            (await viewer.delete(`/api/damages/${damage.id}/photos/${photoId}`)).status,
            403,
        );
        const other = (await loginAs(2)).agent;
        assert.equal((await other.get(`/api/damages/${damage.id}/photos/${photoId}`)).status, 404);

        const removed = await api.delete(`/api/damages/${damage.id}/photos/${photoId}`);
        assert.equal(removed.status, 200);
        assert.equal(removed.body.data.photo_ids.length, 2);
    });

    it("refuses files that are not images", async () => {
        const car = vehicle("K-SCH 8");
        const damage = (await report(car.id)).body.data;

        const lying = await api
            .post(`/api/damages/${damage.id}/photos`)
            .set("Content-Type", "image/png")
            .send(Buffer.from("<svg onload=alert(1)>"));
        assert.equal(lying.status, 400);
        assert.equal(lying.body.code, "DAMAGE_PHOTO_TYPE");

        const pdf = await api
            .post(`/api/damages/${damage.id}/photos`)
            .set("Content-Type", "application/pdf")
            .send(Buffer.from("%PDF-1.4"));
        assert.equal(pdf.status, 415);
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
