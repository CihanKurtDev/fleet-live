import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    BRIEFING_HISTORY_MONTHS,
    BRIEFING_OPEN_ALERT_LIMIT,
    briefingMonthKeys,
} from "@fleet-live/shared";
import { app } from "../app";
import { db } from "../db/database";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { TripModel } from "../models/trip.model";
import { insertAlert, loginAs } from "./helpers";

function setLastTelemetry(vehicleId: number, recordedAt: string) {
    const result = db
        .prepare(
            `
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed, recorded_at)
            VALUES (?, 50.9, 6.96, 0, ?)
            `,
        )
        .run(vehicleId, recordedAt);

    db.prepare("UPDATE vehicles SET last_telemetry_id = ? WHERE id = ?").run(
        result.lastInsertRowid,
        vehicleId,
    );
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/briefing", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/briefing");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lets a viewer read the snapshot", async () => {
        const viewer = (await loginAs(1, "viewer")).agent;
        const response = await viewer.get("/api/briefing");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.counts.open, 0);
        assert.equal(response.body.data.open_alerts.length, 0);
        assert.equal(response.body.data.history.length, BRIEFING_HISTORY_MONTHS);
        assert.equal(response.body.data.history[0]?.speeding_events, 0);
    });

    it("counts this company and omits the other tenant", async () => {
        const driving = VehicleModel.create({
            license_plate: "K-DR 1",
            driver_name: "Anna Fahrt",
            company_id: 1,
            status: "DRIVING",
        });
        VehicleModel.create({
            license_plate: "K-ID 1",
            driver_name: "Ben Stand",
            company_id: 1,
            status: "IDLE",
        });
        VehicleModel.create({
            license_plate: "K-ST 1",
            driver_name: "Cara Feier",
            company_id: 1,
            status: "STOPPED",
        });
        const offline = VehicleModel.create({
            license_plate: "K-OF 1",
            driver_name: "Dirk Funk",
            company_id: 1,
            status: "OFFLINE",
        });
        VehicleModel.create({
            license_plate: "K-FU 1",
            driver_name: "Eva Tank",
            company_id: 1,
            fuel_level: 8,
            status: "DRIVING",
        });
        const other = VehicleModel.create({
            license_plate: "K-XX 1",
            driver_name: "Fremde",
            company_id: 2,
            status: "OFFLINE",
        });

        insertAlert(driving.id, {
            type: "SPEEDING",
            message: "offen tempo",
            created_at: "2026-09-01 10:00:02",
        });
        insertAlert(driving.id, {
            type: "LOW_FUEL",
            message: "offen tank",
            created_at: "2026-09-01 10:00:01",
        });
        insertAlert(offline.id, {
            type: "OFFLINE",
            message: "offen funk",
            created_at: "2026-09-01 09:00:00",
        });
        insertAlert(driving.id, {
            type: "SPEEDING",
            message: "erledigt",
            resolved_at: "2026-09-01 08:00:00",
            ended_at: "2026-09-01 08:00:00",
            created_at: "2026-09-01 07:00:00",
        });
        insertAlert(other.id, {
            type: "OFFLINE",
            message: "fremd",
        });

        setLastTelemetry(offline.id, "2026-09-01 09:50:00");

        const response = await api.get("/api/briefing");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.counts.open, 3);
        assert.equal(response.body.data.counts.driving, 2);
        assert.equal(response.body.data.counts.idle, 1);
        assert.equal(response.body.data.counts.offline, 1);
        assert.equal(response.body.data.counts.low_fuel, 1);
        assert.equal(response.body.data.open_alerts.length, 3);
        assert.equal(response.body.data.open_alerts[0].message, "offen tempo");
        assert.equal(response.body.data.open_alerts[1].message, "offen tank");
        assert.deepEqual(
            response.body.data.offline_vehicles.map(
                (row: { license_plate: string }) => row.license_plate,
            ),
            ["K-OF 1"],
        );
        assert.equal(
            response.body.data.offline_vehicles[0].recorded_at,
            "2026-09-01 09:50:00",
        );
        assert.deepEqual(
            response.body.data.drivers.map(
                (row: { name: string; open_warnings: number }) => ({
                    name: row.name,
                    open_warnings: row.open_warnings,
                }),
            ),
            [
                { name: "Anna Fahrt", open_warnings: 1 },
            ],
        );
    });

    it("caps the work list at the briefing limit", async () => {
        for (let index = 0; index < BRIEFING_OPEN_ALERT_LIMIT + 2; index += 1) {
            const vehicle = VehicleModel.create({
                license_plate: `K-OP ${index + 1}`,
                driver_name: `Fahrer ${index + 1}`,
                company_id: 1,
            });
            insertAlert(vehicle.id, {
                created_at: `2026-09-01 10:00:${String(index).padStart(2, "0")}`,
            });
        }

        const response = await api.get("/api/briefing");

        assert.equal(response.status, 200);
        assert.equal(
            response.body.data.counts.open,
            BRIEFING_OPEN_ALERT_LIMIT + 2,
        );
        assert.equal(
            response.body.data.open_alerts.length,
            BRIEFING_OPEN_ALERT_LIMIT,
        );
        assert.equal(
            response.body.data.open_alerts[0].license_plate,
            `K-OP ${BRIEFING_OPEN_ALERT_LIMIT + 2}`,
        );
    });

    it("aggregates history months for this company only", async () => {
        const month = briefingMonthKeys()[0];
        const ours = VehicleModel.create({
            license_plate: "K-HS 1",
            driver_name: "Histo Tempo",
            company_id: 1,
            status: "DRIVING",
        });
        const other = VehicleModel.create({
            license_plate: "K-HS 2",
            driver_name: "Fremde Tempo",
            company_id: 2,
            status: "DRIVING",
        });

        insertAlert(ours.id, {
            type: "SPEEDING",
            severity: "HIGH",
            created_at: `${month}-12 08:00:00`,
            ended_at: `${month}-12 08:01:00`,
            resolved_at: `${month}-12 09:00:00`,
        });
        insertAlert(other.id, {
            type: "SPEEDING",
            severity: "HIGH",
            created_at: `${month}-12 08:00:00`,
            ended_at: `${month}-12 08:01:00`,
            resolved_at: `${month}-12 09:00:00`,
        });

        const response = await api.get("/api/briefing");
        const row = (
            response.body.data.history as Array<{
                month: string;
                speeding_events: number;
                speeding_drivers: number;
                speeding_high: number;
            }>
        ).find((entry) => entry.month === month);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.history.length, BRIEFING_HISTORY_MONTHS);
        assert.equal(row?.speeding_events, 1);
        assert.equal(row?.speeding_drivers, 1);
        assert.equal(row?.speeding_high, 1);
    });

    it("reads month km from the rollup and ignores another company", async () => {
        const month = briefingMonthKeys()[0];
        VehicleModel.create({
            license_plate: "K-KM 1",
            driver_name: "Km Eins",
            company_id: 1,
        });
        TripModel.addClosedDistance(1, `${month}-10 08:00:00`, 50_000);
        TripModel.addClosedDistance(2, `${month}-10 08:00:00`, 9_000_000);

        const response = await api.get("/api/briefing");
        const row = (
            response.body.data.history as Array<{
                month: string;
                distance_m: number;
            }>
        ).find((entry) => entry.month === month);

        assert.equal(response.status, 200);
        assert.equal(row?.distance_m, 50_000);
    });
});
