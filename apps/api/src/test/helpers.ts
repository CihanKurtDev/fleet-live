import "./env";
import assert from "node:assert/strict";
import type { VehicleStatus } from "@fleet-live/shared";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";

const TEST_PASSWORD = "secret-pass";

/**
 * Legt bei Bedarf einen User an und liefert Session-Agent plus Cookie-Header
 * (für SSE-`fetch`, das kein SuperTest-Agent ist).
 */
export async function loginAs(
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

    const raw = response.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    assert.ok(header);

    return { agent, cookie: String(header).split(";")[0] };
}

export function insertAlert(
    vehicleId: number,
    input: {
        type?: string;
        severity?: string;
        message?: string;
        resolved_at?: string | null;
        ended_at?: string | null;
        driver_id?: number | null;
        created_at?: string;
    } = {},
): number {
    const vehicle = db
        .prepare(`SELECT current_driver_id FROM vehicles WHERE id = ?`)
        .get(vehicleId) as { current_driver_id: number | null } | undefined;

    const result = db
        .prepare(
            `
            INSERT INTO alerts (
                vehicle_id, driver_id, type, severity, message,
                resolved_at, ended_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            `,
        )
        .run(
            vehicleId,
            input.driver_id !== undefined
                ? input.driver_id
                : (vehicle?.current_driver_id ?? null),
            input.type ?? "SPEEDING",
            input.severity ?? "HIGH",
            input.message ?? "zu schnell",
            input.resolved_at ?? null,
            input.ended_at ?? null,
            input.created_at ?? null,
        );

    return Number(result.lastInsertRowid);
}

export function seedFleet(count = 3) {
    const created = [];

    for (let i = 0; i < count; i += 1) {
        const status: VehicleStatus =
            i % 5 === 0 ? "OFFLINE" : i % 3 === 0 ? "DRIVING" : "IDLE";
        const fuel = i % 4 === 0 ? 10 : 80;

        created.push(
            VehicleModel.create({
                license_plate: `K-T ${String(i).padStart(3, "0")}`,
                driver_name: `Driver ${i}`,
                fuel_level: fuel,
                status,
            }),
        );
    }

    const [first, second] = created;
    if (second) {
        db.prepare(
            `
                INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
                VALUES (?, ?, ?, ?)
            `,
        ).run(second.id, 50.9, 6.9, 70);
    }

    if (first) {
        db.prepare(
            `
                INSERT INTO alerts (vehicle_id, type, severity, message)
                VALUES (?, 'SPEEDING', 'HIGH', 'too fast')
            `,
        ).run(first.id);
    }

    const third = created[2];
    if (third) {
        db.prepare(
            `
                INSERT INTO alerts (vehicle_id, type, severity, message)
                VALUES (?, 'SPEEDING', 'HIGH', 'too fast')
            `,
        ).run(third.id);
    }

    return created;
}
