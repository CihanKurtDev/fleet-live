import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { parseCsv } from "../lib/csvParse";
import { TripModel } from "../models/trip.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/export", () => {
    it("requires a session", async () => {
        for (const path of [
            "/api/export/vehicles",
            "/api/export/alerts",
            "/api/export/trips",
            "/api/export/period",
        ]) {
            const response = await request(app).get(path);
            assert.equal(response.status, 401);
            assert.equal(response.body.code, "UNAUTHORIZED");
        }
    });

    it("blocks a viewer", async () => {
        const { agent } = await loginAs(1, "viewer");

        for (const path of [
            "/api/export/vehicles",
            "/api/export/alerts",
            "/api/export/trips",
            "/api/export/period",
        ]) {
            const response = await agent.get(path);
            assert.equal(response.status, 403);
            assert.equal(response.body.code, "FORBIDDEN");
        }
    });

    it("downloads this company's vehicles, alerts and trips", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-EXP 1",
            company_id: 1,
            fuel_level: 40,
            status: "IDLE",
            driver_name: "Eva Export",
            vin: "WDB12345678901234",
            vehicle_type: "VAN",
            hu_due_on: "2026-10",
            uvv_checked_on: "2026-03-01",
            uvv_due_on: "2027-03-01",
            depot: 'Köln; "Nord"',
            cost_center: "4711",
        });
        VehicleModel.create({
            license_plate: "K-FORMEL 1",
            company_id: 1,
            status: "DRIVING",
            fuel_level: 80,
            depot: "=1+1",
        });
        const other = VehicleModel.create({
            license_plate: "K-FREMD 9",
            company_id: 2,
            status: "OFFLINE",
            fuel_level: 10,
            driver_name: "Fremd",
        });

        insertAlert(vehicle.id, { message: "zu schnell" });
        insertAlert(other.id, { message: "fremd" });

        const trip = TripModel.open(vehicle.id, "2026-10-13 14:00:00");
        db.prepare(
            `
            UPDATE trips
            SET distance_m = 1500, max_speed = 88.4, point_count = 4, path = 'secret-path'
            WHERE id = ?
            `,
        ).run(trip.id);
        TripModel.open(other.id, "2026-10-13 14:00:00");

        const vehicles = await api.get("/api/export/vehicles");
        assert.equal(vehicles.status, 200);
        assert.match(vehicles.headers["content-type"], /text\/csv/);
        assert.match(
            vehicles.headers["content-disposition"],
            /filename="fahrzeuge\.csv"/,
        );
        assert.equal(vehicles.text.charCodeAt(0), 0xfeff);
        assert.equal(vehicles.text.includes("secret-path"), false);
        assert.equal(vehicles.text.includes("K-FREMD 9"), false);

        const vehicleTable = parseCsv(vehicles.text);
        assert.deepEqual(vehicleTable.columns, [
            "Kennzeichen",
            "Tank",
            "Status",
            "Fahrer",
            "VIN",
            "Fahrzeugtyp",
            "Depot",
            "HU",
            "UVV",
            "UVV fällig",
            "Kostenstelle",
        ]);
        const exported = rowByPlate(vehicleTable.rows, "K-EXP 1");
        assert.ok(exported);
        assert.deepEqual(exported, [
            "K-EXP 1",
            "40",
            "Standby",
            "Eva Export",
            "WDB12345678901234",
            "Transporter",
            'Köln; "Nord"',
            "2026-10",
            "2026-03-01",
            "2027-03-01",
            "4711",
        ]);
        const formula = rowByPlate(vehicleTable.rows, "K-FORMEL 1");
        assert.equal(formula?.[6], "'=1+1");

        const alerts = await api.get("/api/export/alerts");
        assert.equal(alerts.status, 200);
        assert.match(
            alerts.headers["content-disposition"],
            /filename="warnungen\.csv"/,
        );
        assert.equal(alerts.text.includes("fremd"), false);
        const alertTable = parseCsv(alerts.text);
        assert.equal(alertTable.columns[0], "Kennzeichen");
        assert.equal(alertTable.rows.length, 1);
        assert.equal(alertTable.rows[0]?.[0], "K-EXP 1");
        assert.equal(alertTable.rows[0]?.[1], "Eva Export");
        assert.equal(alertTable.rows[0]?.[2], "Geschwindigkeit");
        assert.equal(alertTable.rows[0]?.[3], "Hoch");
        assert.equal(alertTable.rows[0]?.[4], "zu schnell");
        assert.match(alertTable.rows[0]?.[5] ?? "", /^\d{2}\.\d{2}\.\d{4}/);

        const trips = await api.get("/api/export/trips");
        assert.equal(trips.status, 200);
        assert.match(trips.headers["content-disposition"], /filename="fahrten\.csv"/);
        assert.equal(trips.text.includes("secret-path"), false);
        assert.equal(trips.text.includes("K-FREMD 9"), false);
        const tripTable = parseCsv(trips.text);
        assert.deepEqual(tripTable.columns, [
            "Kennzeichen",
            "Start",
            "Ende",
            "Strecke km",
            "Höchstgeschwindigkeit",
            "Punkte",
            "Verbrauch l",
        ]);
        assert.equal(tripTable.rows.length, 1);
        assert.equal(tripTable.rows[0]?.[0], "K-EXP 1");
        assert.equal(tripTable.rows[0]?.[2], "");
        assert.equal(tripTable.rows[0]?.[3], "1,5");
        assert.equal(tripTable.rows[0]?.[4], "88");
        assert.equal(tripTable.rows[0]?.[5], "4");
        assert.equal(tripTable.rows[0]?.[6], "0,4");
    });

    it("downloads one month and skips the other company", async () => {
        VehicleModel.create({
            license_plate: "K-MON 1",
            company_id: 1,
            status: "IDLE",
            fuel_level: 50,
        });
        const other = VehicleModel.create({
            license_plate: "K-MON 2",
            company_id: 2,
            status: "IDLE",
            fuel_level: 50,
        });
        TripModel.addClosedDistance(1, "2026-10-02 08:00:00", 10_000);
        TripModel.addClosedDistance(2, "2026-10-02 08:00:00", 50_000);
        const mine = VehicleModel.create({
            license_plate: "K-MON 3",
            company_id: 1,
            status: "IDLE",
            fuel_level: 40,
        });
        insertAlert(mine.id, {
            message: "offen im monat",
            created_at: "2026-10-13 10:00:00",
        });
        insertAlert(mine.id, {
            type: "LOW_FUEL",
            message: "erledigt im monat",
            created_at: "2026-10-13 11:00:00",
            resolved_at: "2026-10-13 12:00:00",
        });
        insertAlert(other.id, {
            message: "fremd im monat",
            created_at: "2026-10-13 10:00:00",
        });

        const response = await api.get("/api/export/period?month=2026-10");
        assert.equal(response.status, 200);
        assert.match(
            response.headers["content-disposition"],
            /filename="zeitraum\.csv"/,
        );
        const table = parseCsv(response.text);
        assert.deepEqual(table.columns, [
            "Monat",
            "Kilometer",
            "Angelegt und offen",
            "Angelegt und erledigt",
            "Verbrauch l",
        ]);
        assert.deepEqual(table.rows[0], ["2026-10", "10,0", "1", "1", "2,5"]);
        assert.equal(response.text.includes("fremd"), false);

        const invalid = await api.get("/api/export/period?month=2026-13");
        assert.equal(invalid.status, 400);
        assert.equal(invalid.body.code, "VALIDATION_ERROR");
    });
});

function rowByPlate(rows: string[][], plate: string): string[] | undefined {
    return rows.find((row) => row[0] === plate);
}
