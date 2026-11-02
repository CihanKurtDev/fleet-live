import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { db } from "../db/database";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

async function driverWith(name: string, licence: Record<string, string | null>, vehicleId: number) {
    const id = (await api.post("/api/drivers").send({ name, ...licence })).body.data.id as number;
    await api.post(`/api/drivers/${id}/vehicles`).send({ vehicle_id: vehicleId });
    return id;
}

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("an expired driving licence", () => {
    it("cannot be given a vehicle to drive", async () => {
        const truck = VehicleModel.create({ license_plate: "K-LKW 1", company_id: 1 });
        const expired = await driverWith("Katarzyna Alt", { licence_expires_on: "2026-05-05" }, truck.id);

        const refused = await api.patch(`/api/drivers/${expired}/current-vehicle`).send({ vehicle_id: truck.id });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.code, "LICENCE_EXPIRED");
        assert.match(refused.body.error, /seit 05\.05\.2026 abgelaufen/);

        await api.patch(`/api/drivers/${expired}`).send({ licence_expires_on: "2031-05-05" });
        const allowed = await api.patch(`/api/drivers/${expired}/current-vehicle`).send({ vehicle_id: truck.id });
        assert.equal(allowed.status, 200);
    });

    it("does not take a licence check dated after the expiry", async () => {
        const truck = VehicleModel.create({ license_plate: "K-LKW 2", company_id: 1 });
        const id = await driverWith("Olga Alt", { licence_expires_on: "2026-05-06" }, truck.id);

        const check = await api.patch(`/api/drivers/${id}`).send({ licence_checked_on: "2026-10-14" });
        assert.equal(check.status, 400);
        assert.ok(check.body.fields.licence_checked_on);

        const both = await api
            .patch(`/api/drivers/${id}`)
            .send({ licence_expires_on: "2031-05-06", licence_checked_on: "2026-10-14" });
        assert.equal(both.status, 200);
    });

    it("counts an old check after expiry as overdue in the deadlines", async () => {
        const truck = VehicleModel.create({ license_plate: "K-LKW 3", company_id: 1 });
        const id = await driverWith("Bert Alt", { licence_expires_on: "2026-05-06" }, truck.id);
        // Older data could hold such a check; it does not count.
        db.prepare(`UPDATE drivers SET licence_checked_on = '2026-10-14' WHERE id = ?`).run(id);

        const rows = (await api.get("/api/due?state=overdue&kind=licence_check&search=Bert")).body.data;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].due_on, null);
    });

    it("puts a driver with an expired licence who has a vehicle first in Heute dran, with the vehicle and phone", async () => {
        const truck = VehicleModel.create({ license_plate: "K-XE 1", company_id: 1 });
        const id = await driverWith("Olga Krause", { phone: "+49 152 1883462", licence_expires_on: "2031-01-01" }, truck.id);
        await api.patch(`/api/drivers/${id}/current-vehicle`).send({ vehicle_id: truck.id });
        db.prepare(`UPDATE drivers SET licence_expires_on = '2026-05-06' WHERE id = ?`).run(id);

        const today = (await api.get("/api/today")).body;
        assert.equal(today.data[0].kind, "licence_driving");
        assert.equal(today.data[0].subject, "Olga Krause");
        assert.equal(today.data[0].vehicle_plate, "K-XE 1");
        assert.equal(today.data[0].phone, "+49 152 1883462");
        assert.equal(today.meta.counts.licence_driving, 1);

        const list = (await api.get("/api/drivers?licence_driving=true")).body;
        assert.equal(list.meta.total, 1);
        assert.equal(list.meta.counts.licence_driving, 1);
    });
});
