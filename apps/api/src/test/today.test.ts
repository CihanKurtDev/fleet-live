import "./env";
import assert from "node:assert/strict";
import {
    endingUntil,
    nextWorkday,
    TODAY_KINDS,
    type TodayGroup,
    type TodayResponse,
} from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { DriverModel } from "../models/driver.model";
import { TodayModel } from "../models/today.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

/** A driver who is current on the vehicle (in use), with an optional licence. */
function assign(vehicleId: number, name: string, licence: { expires?: string | null; checked?: string | null } = {}) {
    const driver = DriverModel.create(1, name);
    db.prepare("UPDATE drivers SET licence_expires_on = ?, licence_checked_on = ? WHERE id = ?").run(
        licence.expires === undefined ? "2099-01-01" : licence.expires,
        licence.checked === undefined ? "2099-01-01" : licence.checked,
        driver.id,
    );
    db.prepare("INSERT OR IGNORE INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)").run(driver.id, vehicleId);
    db.prepare("UPDATE vehicles SET current_driver_id = ?, driver_name = ? WHERE id = ?").run(driver.id, name, vehicleId);
    return driver.id;
}

const vehicle = (plate: string, dates: { hu?: string | null; uvv?: string | null } = {}, companyId = 1) =>
    VehicleModel.create({
        license_plate: plate,
        company_id: companyId,
        hu_due_on: dates.hu === undefined ? "2099-01" : (dates.hu ?? undefined),
        uvv_due_on: dates.uvv === undefined ? "2099-01-01" : (dates.uvv ?? undefined),
    });

const group = (body: TodayResponse, kind: string): TodayGroup | undefined =>
    body.data.groups.find((entry) => entry.kind === kind);

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("working days", () => {
    it("settle the weekend on Friday", () => {
        // 13.11.2026 is a Friday.
        assert.equal(endingUntil("2026-11-13"), "2026-11-15");
        assert.equal(nextWorkday("2026-11-15"), "2026-11-16");
        assert.equal(endingUntil("2026-11-18"), "2026-11-18");
        assert.equal(nextWorkday("2026-11-18"), "2026-11-19");
    });
});

describe("GET /api/today", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/today");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lists overdue deadlines only of what is in use, each a part of its tile", async () => {
        const used = vehicle("K-HU 1", { hu: "2020-01" });
        assign(used.id, "Ute Einsatz");
        vehicle("K-HU 2", { hu: "2020-01" });
        const silent = vehicle("K-FUNK 1");
        db.prepare("UPDATE vehicles SET status = 'OFFLINE' WHERE id = ?").run(silent.id);
        insertAlert(silent.id, { type: "OFFLINE", severity: "MEDIUM", message: "kein Signal" });
        vehicle("B-FREMD 1", { hu: "2020-01" }, 2);

        const response = await api.get("/api/today");
        assert.equal(response.status, 200);
        const body = response.body as TodayResponse;
        const overdue = group(body, "deadline_overdue");

        assert.equal(overdue?.count, 1);
        assert.equal(overdue?.items[0].subject, "K-HU 1");
        assert.equal(overdue?.items[0].driver_name, "Ute Einsatz");
        // Not in use: only on /fristen and in the tile.
        const dueTotal = (await api.get("/api/due?state=overdue")).body.meta.total;
        assert.equal(dueTotal, 2);
        assert.equal(body.meta.counts.offline, (await api.get("/api/alerts?filter=open&type=OFFLINE")).body.meta.total);
        assert.equal(body.meta.total, TODAY_KINDS.reduce((sum, kind) => sum + body.meta.counts[kind], 0));
        const subjects = body.data.groups.flatMap((entry) => entry.items.map((item) => item.subject));
        assert.equal(subjects.includes("B-FREMD 1"), false);
        assert.equal(subjects.includes("K-HU 2"), false);
        // Groups keep the order of TODAY_KINDS.
        const order = body.data.groups.map((entry) => TODAY_KINDS.indexOf(entry.kind));
        assert.deepEqual([...order].sort((a, b) => a - b), order);
    });

    it("names who drove since the licence ran out and who could take over", async () => {
        const car = vehicle("K-XE 1");
        const olga = assign(car.id, "Olga Krause", { expires: "2026-05-06" });
        db.prepare("UPDATE drivers SET phone = '+49 152 1883462' WHERE id = ?").run(olga);
        const piotr = DriverModel.create(1, "Piotr Koch");
        db.prepare("UPDATE drivers SET licence_expires_on = '2031-01-01' WHERE id = ?").run(piotr.id);
        db.prepare("INSERT INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)").run(piotr.id, car.id);
        db.prepare("INSERT INTO trips (vehicle_id, driver_id, started_at, ended_at, distance_m, path) VALUES (?, ?, '2026-05-06 20:00:00', '2026-05-06 21:00:00', 4000, '')").run(car.id, olga);
        db.prepare("INSERT INTO trips (vehicle_id, driver_id, started_at, ended_at, distance_m, path) VALUES (?, ?, '2026-06-01 08:00:00', '2026-06-01 10:00:00', 120000, '')").run(car.id, olga);

        const body = (await api.get("/api/today")).body as TodayResponse;
        const row = group(body, "licence_driving")?.items[0];

        assert.equal(body.data.groups[0].kind, "licence_driving");
        assert.equal(row?.subject, "Olga Krause");
        assert.equal(row?.vehicle_plate, "K-XE 1");
        assert.equal(row?.phone, "+49 152 1883462");
        // The trip on her last valid day does not count.
        assert.equal(row?.trips_since, 1);
        assert.equal(row?.km_since, 120);
        assert.equal(row?.replacement?.name, "Piotr Koch");
        // One task, one row: her expired licence is not a second overdue row.
        assert.equal(group(body, "deadline_overdue"), undefined);
    });

    it("puts what runs out over the weekend into Friday and the rest into the plan by its day", () => {
        const van = vehicle("K-UV 1", { uvv: "2026-11-15" });
        assign(van.id, "Uwe Woche", { expires: "2026-11-14", checked: "2026-05-18" });
        const truck = vehicle("K-UV 2", { uvv: "2026-11-21" });
        assign(truck.id, "Tina Plan", { checked: "2026-05-16" });
        vehicle("K-UV 3", { uvv: "2026-11-16" });

        const body = TodayModel.forCompany(1, { today: "2026-11-13" });

        assert.equal(body.meta.ending_until, "2026-11-15");
        assert.equal(body.meta.next_workday, "2026-11-16");
        assert.equal(group(body, "licence_ending")?.items[0].subject, "Uwe Woche");
        assert.equal(group(body, "deadline_ending")?.items[0].subject, "K-UV 1");
        // The plan reaches the company lead (30 days) and lists only days that have something.
        assert.equal(body.meta.week_until, "2026-12-15");
        const plan = body.data.week.map((day) => [day.date, day.count, day.items.map((item) => `${item.kind}:${item.subject}`)]);
        assert.deepEqual(plan, [
            // The check comes due Monday; K-UV 3 has no driver, so it is no task.
            ["2026-11-16", 1, ["licence_check:Tina Plan"]],
            // Uwe's check (last 18.05.) comes due Wednesday.
            ["2026-11-18", 1, ["licence_check:Uwe Woche"]],
            ["2026-11-21", 1, ["uvv:K-UV 2"]],
        ]);
        assert.equal(body.meta.week_total, 3);
    });

    it("lists planned workshop stays on their day", () => {
        const van = vehicle("K-WS 1");
        db.prepare(
            "INSERT INTO workshop_visits (vehicle_id, reasons, state, place, planned_on, expected_on) VALUES (?, json_array('HU'), 'PLANNED', 'Weber', '2026-11-17', '2026-11-17')",
        ).run(van.id);

        const body = TodayModel.forCompany(1, { today: "2026-11-13" });
        const tuesday = body.data.week[0];

        assert.equal(body.data.week.length, 1);
        assert.equal(tuesday.date, "2026-11-17");
        assert.equal(tuesday.items[0].kind, "workshop");
        assert.equal(tuesday.items[0].stay?.place, "Weber");
    });

    it("counts a driver without a licence date as not checkable", async () => {
        const van = vehicle("K-ND 1", { uvv: null });
        assign(van.id, "Nina Datum", { expires: null });

        const body = (await api.get("/api/today")).body as TodayResponse;
        const missing = group(body, "date_missing");

        assert.equal(missing?.count, 2);
        assert.deepEqual(
            missing?.items.map((item) => `${item.due_kind}:${item.subject}`).sort(),
            ["licence_expiry:Nina Datum", "uvv:K-ND 1"],
        );
    });
});
