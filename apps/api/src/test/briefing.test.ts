import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    BRIEFING_OPEN_ALERT_LIMIT,
} from "@fleet-live/shared";
import { app } from "../app";
import { db } from "../db/database";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";

const TEST_PASSWORD = "secret-pass";

async function loginAs(
    companyId: number,
    role: "dispatcher" | "viewer" = "dispatcher",
) {
    const email = `${role}-${companyId}@example.com`;

    if (!UserModel.findByEmail(email)) {
        UserModel.create({
            name: `${role} ${companyId}`,
            email,
            password: TEST_PASSWORD,
            company_id: companyId,
            role,
        });
    }

    const agent = request.agent(app);
    const response = await agent.post("/api/auth/login").send({
        email,
        password: TEST_PASSWORD,
    });

    assert.equal(response.status, 200);
    return agent;
}

function insertAlert(
    vehicleId: number,
    input: {
        type?: string;
        severity?: string;
        message?: string;
        resolved_at?: string | null;
        ended_at?: string | null;
        created_at?: string;
    } = {},
) {
    const result = db
        .prepare(
            `
            INSERT INTO alerts (
                vehicle_id, type, severity, message, resolved_at, ended_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `,
        )
        .run(
            vehicleId,
            input.type ?? "SPEEDING",
            input.severity ?? "HIGH",
            input.message ?? "zu schnell",
            input.resolved_at ?? null,
            input.ended_at ?? null,
            input.created_at ?? null,
        );

    return Number(result.lastInsertRowid);
}

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
    api = await loginAs(1);
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
        const viewer = await loginAs(1, "viewer");
        const response = await viewer.get("/api/briefing");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.counts.open, 0);
        assert.equal(response.body.data.open_alerts.length, 0);
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
                { name: "Anna Fahrt", open_warnings: 2 },
                { name: "Dirk Funk", open_warnings: 1 },
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
});
