import "./env";
import assert from "node:assert/strict";
import { berlinTodayIso } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { TelemetryModel } from "../models/telemetry.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { WorkshopPlaceModel } from "../models/workshopPlace.model";
import { playWorkshopTrips } from "../sim/workshopTrips";
import {
    haversineMeters,
    nextSimTick,
    pointAtFraction,
    resetSimProgress,
    seedSimProgress,
    setSimDestination,
    SIM_ROUTES,
} from "../sim/routes";
import { applyTickEffects } from "../sse/telemetryTicker";
import { giveCurrentDriver, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;
let me: number;
let placeId: number;

const today = berlinTodayIso();
/** Prüfstelle Köln-Ost in the tests. */
const PLACE = { latitude: 50.941, longitude: 7.052 };
const ELSEWHERE = { latitude: 50.9, longitude: 6.9 };

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

/** A device report at a place; the circles are laid again, as after a tick. */
function parkAt(vehicleId: number, at: { latitude: number; longitude: number }) {
    db.prepare(`INSERT INTO telemetry (vehicle_id, latitude, longitude, speed) VALUES (?, ?, ?, 0)`).run(
        vehicleId,
        at.latitude,
        at.longitude,
    );
    WorkshopPlaceModel.refreshInside(1);
}

async function createPlace(body: Record<string, unknown> = {}) {
    return api.post("/api/workshop/places").send({
        name: "Prüfstelle Köln-Ost",
        address: "Industriestraße 12, 50735 Köln",
        phone: "0221 555 0142",
        ...PLACE,
        radius_m: 150,
        ...body,
    });
}

async function plan(vehicleId: number, body: Record<string, unknown> = {}) {
    return api.post(`/api/vehicles/${vehicleId}/workshop`).send({
        reasons: ["HU"],
        workshop_id: placeId,
        planned_on: shiftDays(today, 3),
        planned_time: "08:00",
        expected_on: shiftDays(today, 4),
        assignee_user_id: me,
        note: "Bremsen mitprüfen lassen.",
        ...body,
    });
}

/** Planned today and arrived by hand (the vehicle stands elsewhere). */
async function inWorkshop(vehicleId: number, body: Record<string, unknown> = {}) {
    const visit = (await plan(vehicleId, { planned_on: today, expected_on: today, ...body })).body.data;
    const arrived = await api.post(`/api/workshop/${visit.id}/arrive`);
    assert.equal(arrived.status, 200);
    return arrived.body.data;
}

const todayRows = async () =>
    (await api.get("/api/today")).body.data.filter(
        (item: { kind: string }) => item.kind === "workshop_due",
    ) as Array<{ subject: string; workshop_task: string; workshop: { id: number } | null; workshop_place: { name: string } | null }>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
    me = (await api.get("/api/auth/me")).body.id as number;
    placeId = (await createPlace()).body.data.id as number;
});

afterEach(() => {
    resetSimProgress();
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("workshop places", () => {
    it("requires a session", async () => {
        assert.equal((await request(app).get("/api/workshop/places")).status, 401);
        assert.equal((await request(app).get("/api/vehicles/1/workshop")).status, 401);
    });

    it("are places of the company with a contact; viewers read, dispatchers write", async () => {
        const list = (await api.get("/api/workshop/places")).body.data;
        assert.equal(list.length, 1);
        assert.equal(list[0].phone, "0221 555 0142");
        assert.equal(list[0].radius_m, 150);

        assert.equal((await createPlace()).status, 409);
        const empty = await createPlace({ name: " " });
        assert.equal(empty.status, 400);
        assert.ok(empty.body.fields.name);

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get("/api/workshop/places")).status, 200);
        assert.equal((await viewer.post("/api/workshop/places").send({})).status, 403);

        const moved = await api.patch(`/api/workshop/places/${placeId}`).send({ phone: "0221 1" });
        assert.equal(moved.body.data.phone, "0221 1");

        const other = (await loginAs(2)).agent;
        assert.equal((await other.get("/api/workshop/places")).body.data.length, 0);
        assert.equal((await other.patch(`/api/workshop/places/${placeId}`).send({ phone: "x" })).status, 404);
    });

    it("counts the vehicles in the circle and keeps a place with an open stay", async () => {
        const car = vehicle("K-ORT 1");
        parkAt(car.id, PLACE);
        assert.equal((await api.get("/api/workshop/places")).body.data[0].vehicles_here, 1);

        const visit = (await plan(car.id)).body.data;
        const place = (await api.get("/api/workshop/places")).body.data[0];
        assert.deepEqual(place.here, [{ vehicle_id: car.id, license_plate: "K-ORT 1" }]);
        assert.equal(place.appointments.length, 1);
        assert.equal(place.appointments[0].visit_id, visit.id);
        assert.equal(place.appointments[0].license_plate, "K-ORT 1");
        // It parks in the circle, so the planned stay has arrived.
        assert.equal(place.appointments[0].state, "IN_WORKSHOP");
        assert.deepEqual(place.appointments[0].reasons, ["HU"]);

        const refused = await api.delete(`/api/workshop/places/${placeId}`);
        assert.equal(refused.status, 409);
        assert.equal(refused.body.code, "WORKSHOP_IN_USE");
    });
});

describe("workshop stays", () => {
    it("plans a stay at a workshop place: open, on the vehicle, logged, still ready", async () => {
        const car = vehicle("K-CV 9419");
        const created = await plan(car.id);

        assert.equal(created.status, 201);
        assert.equal(created.body.data.state, "PLANNED");
        assert.equal(created.body.data.place, "Prüfstelle Köln-Ost");
        assert.equal(created.body.data.workshop.phone, "0221 555 0142");
        assert.equal(created.body.data.planned_time, "08:00");

        const detail = await api.get(`/api/vehicles/${car.id}`);
        assert.equal(detail.body.availability, "READY");
        assert.equal(detail.body.workshop.workshop_id, placeId);
        assert.equal(detail.body.workshop.planned_time, "08:00");

        const events = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.events;
        assert.deepEqual(events.map((event: { action: string }) => event.action), ["planned"]);
        assert.equal(events[0].actor_name, "dispatcher 1");
    });

    it("lets a viewer read but not write, and keeps other companies out", async () => {
        const car = vehicle("K-CV 1");
        const visit = (await plan(car.id)).body.data;
        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get(`/api/vehicles/${car.id}/workshop`)).status, 200);
        assert.equal((await viewer.post(`/api/vehicles/${car.id}/workshop`).send({})).status, 403);
        assert.equal((await viewer.post(`/api/workshop/${visit.id}/cost`).send({ cost: "1" })).status, 403);

        const foreign = VehicleModel.create({ license_plate: "B-FREMD 1", company_id: 2 });
        assert.equal((await plan(foreign.id)).status, 404);
        const other = (await loginAs(2)).agent;
        const otherMe = (await other.get("/api/auth/me")).body.id as number;
        const foreignPlace = await other.post(`/api/vehicles/${foreign.id}/workshop`).send({
            reasons: ["OTHER"],
            workshop_id: placeId,
            planned_on: today,
            expected_on: today,
            assignee_user_id: otherMe,
        });
        assert.equal(foreignPlace.status, 400);
        assert.ok(foreignPlace.body.fields.workshop_id);
        assert.equal((await other.post(`/api/workshop/${visit.id}/arrive`)).status, 404);
    });

    it("validates who, when, why and where", async () => {
        const car = vehicle("K-CV 2");
        const otherCar = vehicle("K-CV 22");
        const viewer = UserModel.create({
            name: "Vera Viewer",
            email: "vera@example.com",
            password: "secret-password",
            company_id: 1,
            role: "viewer",
        });
        const driverOfOther = await giveCurrentDriver(api, otherCar.id, "Fremder Fahrer");

        const cases: Array<[Record<string, unknown>, string]> = [
            [{ assignee_user_id: viewer.id }, "assignee_user_id"],
            [{ expected_on: shiftDays(today, 1) }, "expected_on"],
            [{ expected_on: undefined }, "expected_on"],
            [{ planned_on: shiftDays(today, -1) }, "planned_on"],
            [{ planned_time: "8 Uhr" }, "planned_time"],
            [{ reasons: ["DAMAGE"] }, "damage_ids"],
            [{ bring_driver_id: driverOfOther }, "bring_driver_id"],
            [{ workshop_id: undefined }, "workshop_id"],
        ];
        for (const [body, field] of cases) {
            const response = await plan(car.id, body);
            assert.equal(response.status, 400, field);
            assert.ok(response.body.fields[field], field);
        }

        const notThere = await plan(car.id, { arrived: true, planned_on: today, expected_on: today });
        assert.equal(notThere.status, 409);
        assert.equal(notThere.body.code, "NOT_AT_WORKSHOP");

        assert.equal((await plan(car.id)).status, 201);
        const second = await plan(car.id);
        assert.equal(second.status, 409);
        assert.equal(second.body.code, "WORKSHOP_OPEN");
    });

    it("arrives by position when the vehicle stops in the workshop circle, and frees its driver", async () => {
        const car = vehicle("K-CV 3");
        const driverId = await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });
        const visit = (await plan(car.id, { planned_on: today, bring_driver_id: driverId })).body.data;
        assert.equal(visit.bring_driver_name, `Fahrer ${car.id}`);

        // Driving through the circle is no arrival.
        parkAt(car.id, PLACE);
        assert.equal((await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.open.state, "PLANNED");

        await api.patch(`/api/vehicles/${car.id}`).send({ status: "IDLE" });
        const open = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.open;
        assert.equal(open.state, "IN_WORKSHOP");
        assert.equal(open.arrived_by, "POSITION");
        assert.equal(open.arrived_on, today);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.availability, "WORKSHOP");
        assert.equal(detail.current_driver_id, null);

        const assign = await api.patch(`/api/drivers/${driverId}/current-vehicle`).send({ vehicle_id: car.id });
        assert.equal(assign.body.code, "VEHICLE_UNAVAILABLE");
    });

    it("arrives by hand only while the vehicle stands, and a stay planned while it parks there starts at once", async () => {
        const car = vehicle("K-CV 33");
        await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });
        const visit = (await plan(car.id)).body.data;
        const driving = await api.post(`/api/workshop/${visit.id}/arrive`);
        assert.equal(driving.status, 409);
        assert.equal(driving.body.code, "VEHICLE_DRIVING");

        await api.patch(`/api/vehicles/${car.id}`).send({ status: "IDLE" });
        const byHand = await api.post(`/api/workshop/${visit.id}/arrive`);
        assert.equal(byHand.body.data.arrived_by, "HAND");

        const parked = vehicle("K-CV 34");
        parkAt(parked.id, PLACE);
        const started = await plan(parked.id, { planned_on: today, expected_on: today });
        assert.equal((await api.get(`/api/vehicles/${parked.id}/workshop`)).body.data.open.id, started.body.data.id);
        assert.equal((await api.get(`/api/vehicles/${parked.id}`)).body.availability, "WORKSHOP");
    });

    it("finishes an HU with the new month; costs can follow with the invoice", async () => {
        const car = vehicle("K-CV 4");
        const visit = await inWorkshop(car.id);

        const missing = await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today });
        assert.equal(missing.status, 400);
        assert.ok(missing.body.fields.hu_due_on);

        const early = await api.post(`/api/workshop/${visit.id}/cost`).send({ cost: "128,50" });
        assert.equal(early.status, 409);

        const done = await api
            .post(`/api/workshop/${visit.id}/finish`)
            .send({ finished_on: today, hu_due_on: "2028-10" });
        assert.equal(done.status, 200);
        assert.equal(done.body.data.cost_cents, null);
        // It does not stand at the workshop: nothing to pick up.
        assert.notEqual(done.body.data.picked_up_at, null);

        const bad = await api.post(`/api/workshop/${visit.id}/cost`).send({ cost: "viel" });
        assert.equal(bad.status, 400);
        assert.ok(bad.body.fields.cost);
        const cost = await api.post(`/api/workshop/${visit.id}/cost`).send({ cost: "412,80" });
        assert.equal(cost.body.data.cost_cents, 41280);

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.hu_due_on, "2028-10");
        assert.equal(detail.availability, "READY");
        const past = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.past[0];
        assert.equal(past.cost_cents, 41280);
    });

    it("finishes a UVV: checked today, next date from the interval", async () => {
        const car = vehicle("K-CV 5", { license_plate: "K-CV 5", uvv_due_on: "2020-05-01" });
        const visit = await inWorkshop(car.id, { reasons: ["UVV"] });

        assert.equal((await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today })).status, 200);
        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.uvv_checked_on, today);
        assert.equal(detail.uvv_due_on, null);
    });

    it("takes the reading on the invoice for a GPS box, not for a vehicle that reports its dashboard", async () => {
        const van = vehicle("K-RE 1", { license_plate: "K-RE 1", vehicle_type: "VAN" });
        const visit = await inWorkshop(van.id, { reasons: ["MAINTENANCE"] });

        const bad = await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today, odometer: "12a" });
        assert.equal(bad.status, 400);
        assert.ok(bad.body.fields.odometer);

        await api
            .post(`/api/workshop/${visit.id}/finish`)
            .send({ finished_on: today, odometer: "48.250" })
            .expect(200);
        const odometer = (await api.get(`/api/vehicles/${van.id}/odometer`)).body.data;
        assert.equal(odometer.km, 48250);
        assert.equal(odometer.readings[0].source, "MANUAL");
        assert.match(odometer.readings[0].note, /^Werkstattrechnung · /);

        const truck = vehicle("K-RE 2", { license_plate: "K-RE 2", vehicle_type: "TRUCK" });
        db.prepare(`UPDATE vehicles SET odometer_m = 300000000, odometer_reported_at = ? WHERE id = ?`).run(
            `${today} 07:00:00`,
            truck.id,
        );
        const truckVisit = await inWorkshop(truck.id, { reasons: ["MAINTENANCE"] });
        const refused = await api
            .post(`/api/workshop/${truckVisit.id}/finish`)
            .send({ finished_on: today, odometer: "1" });
        assert.equal(refused.status, 400);
        assert.ok(refused.body.fields.odometer);
        // Nothing was written: the stay is still open.
        assert.equal((await api.get(`/api/vehicles/${truck.id}/workshop`)).body.data.open.state, "IN_WORKSHOP");
        assert.equal((await api.get(`/api/vehicles/${truck.id}`)).body.odometer_km, 300000);
    });

    it("cancels only a planned stay", async () => {
        const car = vehicle("K-CV 6");
        const visit = (await plan(car.id)).body.data;

        assert.equal((await api.post(`/api/workshop/${visit.id}/cancel`)).body.data.state, "CANCELLED");
        assert.equal((await api.post(`/api/workshop/${visit.id}/cancel`)).status, 409);
    });

    it("edits a planned stay and logs the fields; the workshop is fixed after arrival", async () => {
        const car = vehicle("K-CV 7");
        const becker = (await createPlace({ name: "Werkstatt Becker", ...ELSEWHERE })).body.data;
        const visit = (await plan(car.id)).body.data;

        const edited = await api
            .patch(`/api/workshop/${visit.id}`)
            .send({ workshop_id: becker.id, expected_on: shiftDays(today, 6) });
        assert.equal(edited.status, 200);
        assert.equal(edited.body.data.place, "Werkstatt Becker");

        const past = await api.patch(`/api/workshop/${visit.id}`).send({ planned_on: shiftDays(today, -2) });
        assert.equal(past.status, 400);

        await api.post(`/api/workshop/${visit.id}/arrive`);
        const late = await api.patch(`/api/workshop/${visit.id}`).send({ workshop_id: placeId });
        assert.equal(late.status, 400);

        const events = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.events;
        assert.deepEqual(events.map((event: { action: string }) => event.action), ["arrived", "updated", "planned"]);
        assert.deepEqual(events[1].details.fields.sort(), ["expected_on", "workshop_id"]);
    });
});

describe("workshop tasks in Heute dran", () => {
    it("lists missed, late, a trip without driver, a pickup and a vehicle without a stay; the chip matches", async () => {
        const missed = vehicle("K-VERPASST 1");
        const late = vehicle("K-SPAET 1");
        const trip = vehicle("K-HIN 1");
        const pickup = vehicle("K-AB 1");
        const unplanned = vehicle("K-OHNE 1");
        vehicle("K-NICHTS 1");

        const missedVisit = (await plan(missed.id)).body.data;
        db.prepare(`UPDATE workshop_visits SET planned_on = ?, expected_on = ? WHERE id = ?`).run(
            shiftDays(today, -2),
            shiftDays(today, -1),
            missedVisit.id,
        );
        const lateVisit = await inWorkshop(late.id);
        db.prepare(`UPDATE workshop_visits SET expected_on = ? WHERE id = ?`).run(shiftDays(today, -3), lateVisit.id);
        await plan(trip.id, { planned_on: today, expected_on: today });

        parkAt(pickup.id, PLACE);
        const pickupVisit = (await plan(pickup.id, { planned_on: today, expected_on: today })).body.data;
        await api.post(`/api/workshop/${pickupVisit.id}/finish`).send({ finished_on: today, hu_due_on: "2028-01" });

        parkAt(unplanned.id, PLACE);

        const rows = await todayRows();
        assert.deepEqual(
            rows.map((row) => [row.subject, row.workshop_task]),
            [
                ["K-VERPASST 1", "missed"],
                ["K-SPAET 1", "return_late"],
                ["K-HIN 1", "trip_no_driver"],
                ["K-AB 1", "pickup"],
                ["K-OHNE 1", "unplanned"],
            ],
        );
        assert.equal(rows[3]?.workshop?.id, pickupVisit.id);
        assert.equal(rows[4]?.workshop, null);
        assert.equal(rows[4]?.workshop_place?.name, "Prüfstelle Köln-Ost");

        const chip = (await api.get("/api/vehicles?filter=workshop_due")).body;
        assert.equal(chip.meta.total, 5);
        // Each row says why it is listed, the same task as the Schicht row.
        assert.deepEqual(
            Object.fromEntries(
                chip.data.map((row: { license_plate: string; workshop_task: string | null }) => [row.license_plate, row.workshop_task]),
            ),
            Object.fromEntries(rows.map((row) => [row.subject, row.workshop_task])),
        );
        assert.equal((await api.get("/api/today")).body.meta.counts.workshop_due, 5);

        // A vehicle without a stay can get one where it stands.
        const created = await plan(unplanned.id, { arrived: true, planned_on: today, expected_on: today, reasons: ["OTHER"] });
        assert.equal(created.body.data.state, "IN_WORKSHOP");
    });

    it("is picked up when the vehicle leaves the circle", async () => {
        const car = vehicle("K-ABHOL 1");
        parkAt(car.id, PLACE);
        const visit = (await plan(car.id, { planned_on: today, expected_on: today })).body.data;
        await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today, hu_due_on: "2028-01" });

        applyTickEffects([
            { id: car.id, company_id: 1, speed: 30, speed_limit_kmh: 50, ...ELSEWHERE, recorded_at: "2026-10-30 10:00:00", fuel_level: 50 },
        ]);
        const past = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.past[0];
        assert.notEqual(past.picked_up_at, null);
        assert.equal((await todayRows()).length, 0);
    });

    it("shows the stay on the HU row of /fristen, whatever its reason", async () => {
        const hu = vehicle("K-HU 9");
        const other = vehicle("K-HU 10");
        const visit = (await plan(hu.id)).body.data;
        await plan(other.id, { reasons: ["MAINTENANCE"] });

        const due = (await api.get("/api/due?state=overdue&kind=hu")).body;
        const row = (label: string) => due.data.find((entry: { label: string }) => entry.label === label);
        assert.equal(row("K-HU 9").workshop.id, visit.id);
        assert.deepEqual(row("K-HU 10").workshop.reasons, ["MAINTENANCE"]);
    });
});

describe("the simulator drives to the workshop", () => {
    it("drives a vehicle with an appointment today there, parks, and the app sees it arrive", async () => {
        const route = SIM_ROUTES.find((entry) => entry.id === "koeln-duesseldorf");
        assert.ok(route);
        const road = pointAtFraction(route.points, 0.24);
        const nearRoad = (await createPlace({ name: "Am Weg", latitude: road.lat + 0.0005, longitude: road.lng })).body.data;

        const car = vehicle("K-SIM 1");
        await giveCurrentDriver(api, car.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" });
        seedSimProgress(car.id, "koeln-duesseldorf", 0.2);
        await plan(car.id, { workshop_id: nearRoad.id, planned_on: today, planned_time: null, expected_on: today });

        playWorkshopTrips();
        let parked = false;
        for (let step = 0; step < 80 && !parked; step += 1) {
            const patches = TelemetryModel.tickDrivingVehicles([car.id]);
            parked = patches.some((patch) => patch.parked === true);
            applyTickEffects(patches);
        }
        assert.ok(parked, "parked at the workshop");

        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.status, "IDLE");
        assert.equal(detail.availability, "WORKSHOP");
        assert.equal(detail.current_driver_id, null);
        const open = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.open;
        assert.equal(open.arrived_by, "POSITION");
    });

    it("drives a finished vehicle off when it gets a driver", async () => {
        const car = vehicle("K-SIM 2");
        parkAt(car.id, PLACE);
        const visit = (await plan(car.id, { planned_on: today, expected_on: today })).body.data;
        await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today, hu_due_on: "2028-01" });

        playWorkshopTrips();
        assert.equal((await api.get(`/api/vehicles/${car.id}`)).body.status, "IDLE");

        await giveCurrentDriver(api, car.id);
        playWorkshopTrips();
        assert.equal((await api.get(`/api/vehicles/${car.id}`)).body.status, "DRIVING");
    });

    it("drives to a workshop far from every road, step by step, and back to its road", () => {
        const budapest = { lat: 47.4979, lng: 19.0402 };
        const id = 9_901;
        seedSimProgress(id, "koeln-duesseldorf", 0.5);
        assert.equal(setSimDestination(id, budapest), true);

        let at = pointAtFraction(SIM_ROUTES.find((entry) => entry.id === "koeln-duesseldorf")!.points, 0.5);
        let speed: number | null = 100;
        let parked = false;
        let ticks = 0;

        while (!parked && ticks < 5_000) {
            const tick = nextSimTick(id, at, speed, 60);
            // Never further in one tick than it drove: no jump across the map.
            assert.ok(haversineMeters(at, tick) <= tick.meters + 1, `tick ${ticks} jumps`);
            at = { lat: tick.lat, lng: tick.lng };
            speed = tick.speed;
            parked = tick.parked;
            ticks += 1;
        }

        assert.ok(parked, "parked in Budapest");
        assert.ok(haversineMeters(at, budapest) < 1);
        assert.ok(ticks > 10, "the long way takes many ticks");

        // Setting off again leads back to the road over many ticks too.
        const away = nextSimTick(id, at, 0, 60);
        assert.equal(away.parked, false);
        assert.ok(haversineMeters(at, away) <= away.meters + 1);
        assert.ok(haversineMeters(away, budapest) > 0);
    });
});

describe("out of service", () => {
    it("takes a vehicle out of service and back, not while in a workshop", async () => {
        const car = vehicle("K-AD 1");
        const driverId = await giveCurrentDriver(api, car.id);

        const out = await api.patch(`/api/vehicles/${car.id}/availability`).send({ out_of_service: true });
        assert.equal(out.body.data.availability, "OUT_OF_SERVICE");
        assert.equal(out.body.data.current_driver_id, null);
        assert.equal((await api.get("/api/vehicles?filter=out_of_service")).body.meta.total, 1);
        const assign = await api.patch(`/api/drivers/${driverId}/current-vehicle`).send({ vehicle_id: car.id });
        assert.equal(assign.body.code, "VEHICLE_UNAVAILABLE");
        const back = await api.patch(`/api/vehicles/${car.id}/availability`).send({ out_of_service: false });
        assert.equal(back.body.data.availability, "READY");

        const there = vehicle("K-AD 2");
        await inWorkshop(there.id);
        const refused = await api.patch(`/api/vehicles/${there.id}/availability`).send({ out_of_service: true });
        assert.equal(refused.body.code, "VEHICLE_IN_WORKSHOP");

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.patch(`/api/vehicles/${car.id}/availability`).send({ out_of_service: true })).status, 403);
    });

    it("counts a vehicle in a workshop the same on the list, the filter and Schicht (Nicht verfügbar)", async () => {
        const there = vehicle("K-IN 1");
        vehicle("K-OUT 1");
        await inWorkshop(there.id);

        assert.equal((await api.get("/api/vehicles")).body.meta.counts.in_workshop, 1);
        assert.deepEqual(
            (await api.get("/api/vehicles?filter=in_workshop")).body.data.map((row: { license_plate: string }) => row.license_plate),
            ["K-IN 1"],
        );
        assert.equal((await api.get("/api/vehicles")).body.meta.counts.unavailable, 1);
        assert.equal((await api.get("/api/briefing")).body.data.counts.unavailable, 1);
    });
});

describe("a stay does everything that is due, and how the vehicle gets there", () => {
    it("takes several reasons and finishes each: HU month, UVV check, damage repaired", async () => {
        const car = vehicle("K-ALL 1");
        const damage = (
            await api.post(`/api/vehicles/${car.id}/damages`).send({
                occurred_on: today,
                description: "Spiegel abgerissen",
                severity: "MINOR",
                drivable: true,
            })
        ).body.data;
        const visit = await inWorkshop(car.id, {
            reasons: ["DAMAGE", "UVV", "HU"],
            damage_ids: [damage.id],
        });
        assert.deepEqual(visit.reasons, ["HU", "UVV", "DAMAGE"]);

        const missingHu = await api.post(`/api/workshop/${visit.id}/finish`).send({ finished_on: today });
        assert.equal(missingHu.status, 400);
        assert.ok(missingHu.body.fields.hu_due_on);

        const done = await api
            .post(`/api/workshop/${visit.id}/finish`)
            .send({ finished_on: today, hu_due_on: "2028-03" });
        assert.equal(done.status, 200);
        const detail = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(detail.hu_due_on, "2028-03");
        assert.equal(detail.uvv_checked_on, today);
        const damages = (await api.get(`/api/vehicles/${car.id}/damages`)).body.data;
        assert.equal(damages[0].state, "REPAIRED");
    });

    it("adds a deadline to a running stay instead of a second stay, and keeps damages and reason in step", async () => {
        const car = vehicle("K-ADD 1");
        const visit = (await plan(car.id, { reasons: ["MAINTENANCE"] })).body.data;

        const added = await api.patch(`/api/workshop/${visit.id}`).send({ reasons: ["MAINTENANCE", "HU"] });
        assert.equal(added.status, 200);
        assert.deepEqual(added.body.data.reasons, ["HU", "MAINTENANCE"]);
        const events = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.events;
        assert.deepEqual(events[0].details.fields, ["reasons"]);

        const noDamage = await api.patch(`/api/workshop/${visit.id}`).send({ reasons: ["DAMAGE"] });
        assert.equal(noDamage.status, 400);
        assert.ok(noDamage.body.fields.damage_ids);

        const empty = await api.patch(`/api/workshop/${visit.id}`).send({ reasons: [] });
        assert.equal(empty.status, 400);
    });

    it("tows a vehicle that cannot be driven; no driver brings it", async () => {
        const car = vehicle("K-TOW 1");
        await api.post(`/api/vehicles/${car.id}/damages`).send({
            occurred_on: today,
            description: "Motor aus",
            severity: "SEVERE",
            drivable: false,
        });

        const byDriver = await plan(car.id, { transport: "DRIVER" });
        assert.equal(byDriver.status, 409);
        assert.equal(byDriver.body.code, "VEHICLE_NOT_DRIVABLE");

        const towed = await plan(car.id, { transport: "TOW", bring_driver_id: null });
        assert.equal(towed.status, 201);
        assert.equal(towed.body.data.transport, "TOW");
        assert.equal(towed.body.data.bring_driver_id, null);

        const withDriver = await api
            .patch(`/api/workshop/${towed.body.data.id}`)
            .send({ transport: "TOW", bring_driver_id: 5 });
        assert.equal(withDriver.status, 400);
        assert.ok(withDriver.body.fields.bring_driver_id);
    });

    it("lets the simulator bring a towed vehicle into the circle, where it arrives", async () => {
        const car = vehicle("K-TOW 2");
        parkAt(car.id, ELSEWHERE);
        const visit = (
            await plan(car.id, {
                transport: "TOW",
                planned_on: today,
                planned_time: null,
                expected_on: today,
            })
        ).body.data;

        const trips = playWorkshopTrips();
        assert.equal(trips.patches.length, 1);
        applyTickEffects(trips.patches);

        const open = (await api.get(`/api/vehicles/${car.id}/workshop`)).body.data.open;
        assert.equal(open.id, visit.id);
        assert.equal(open.state, "IN_WORKSHOP");
        assert.equal(open.arrived_by, "POSITION");
        assert.equal((await api.get(`/api/vehicles/${car.id}/trips`)).body.meta.total, 0);
    });

    it("says who may bring it: an expired licence, another drive, another trip that day", async () => {
        const car = vehicle("K-BRING 1");
        const other = vehicle("K-BRING 2");
        const ok = await giveCurrentDriver(api, other.id, "Mia Bring");
        await api.post(`/api/drivers/${ok}/vehicles`).send({ vehicle_id: car.id });
        const expired = (
            await api.post("/api/drivers").send({ name: "Ole Alt", licence_expires_on: "2026-01-31" })
        ).body.data.id as number;
        await api.post(`/api/drivers/${expired}/vehicles`).send({ vehicle_id: car.id });
        const day = shiftDays(today, 3);
        await plan(other.id, { reasons: ["MAINTENANCE"], planned_on: day, expected_on: day, bring_driver_id: ok });

        const bringers = (await api.get(`/api/vehicles/${car.id}/workshop/bringers?on=${day}`)).body.data;
        const mia = bringers.find((row: { name: string }) => row.name === "Mia Bring");
        const ole = bringers.find((row: { name: string }) => row.name === "Ole Alt");
        assert.equal(mia.licence_expired, false);
        assert.deepEqual(mia.other_transports.map((trip: { license_plate: string }) => trip.license_plate), ["K-BRING 2"]);
        assert.equal(ole.licence_expired, true);

        const refused = await plan(car.id, { bring_driver_id: expired });
        assert.equal(refused.status, 400);
        assert.ok(refused.body.fields.bring_driver_id);

        const driverPage = (await api.get(`/api/drivers/${ok}`)).body.data;
        assert.deepEqual(
            driverPage.workshop_transports.map((trip: { license_plate: string; planned_on: string }) => [trip.license_plate, trip.planned_on]),
            [["K-BRING 2", day]],
        );
    });
});
