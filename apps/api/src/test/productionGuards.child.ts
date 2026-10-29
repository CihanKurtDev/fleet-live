/**
 * Läuft nur als Kindprozess mit NODE_ENV=production.
 * Nicht in den normalen Testlauf hängen: config liest die Umgebung beim Import.
 */
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../app";
import { logger } from "../logger";
import { UserModel } from "../models/user.model";

const ORIGIN = "http://allowed.example";

async function main() {
    logger.info(
        {
            req: {
                headers: {
                    cookie: "fleet_session=SENTINEL_COOKIE_VALUE",
                    authorization: "Bearer SENTINEL_AUTH_VALUE",
                },
            },
            res: { headers: { "set-cookie": "fleet_session=SENTINEL_COOKIE_VALUE" } },
        },
        "redact-probe",
    );

    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers["x-powered-by"], undefined);

    const getVehicles = await request(app).get("/api/vehicles");
    assert.equal(getVehicles.status, 401);
    assert.notEqual(getVehicles.body.code, "ORIGIN_FORBIDDEN");

    const missingOrigin = await request(app)
        .post("/api/vehicles")
        .send({ license_plate: "K-ORIGIN 1", fuel_level: 40, status: "IDLE" });
    assert.equal(missingOrigin.status, 403);
    assert.equal(missingOrigin.body.code, "ORIGIN_FORBIDDEN");

    const evilOrigin = await request(app)
        .post("/api/vehicles")
        .set("Origin", "http://evil.example")
        .send({ license_plate: "K-ORIGIN 1", fuel_level: 40, status: "IDLE" });
    assert.equal(evilOrigin.status, 403);
    assert.equal(evilOrigin.body.code, "ORIGIN_FORBIDDEN");

    UserModel.create({
        name: "Prod",
        email: "prod@example.com",
        password: "secret-password",
        company_id: 1,
    });

    const login = await request(app)
        .post("/api/auth/login")
        .set("Origin", ORIGIN)
        .send({ email: "prod@example.com", password: "secret-password" });
    assert.equal(login.status, 200);
    const setCookie = String(login.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
    assert.equal(login.body.password_hash, undefined);
    assert.equal(login.body.totp_secret, undefined);
    assert.equal(login.body.stack, undefined);

    const cookie = setCookie.split(";")[0];

    const created = await request(app)
        .post("/api/vehicles")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie)
        .send({ license_plate: "K-ORIGIN 1", fuel_level: 40, status: "IDLE" });
    assert.equal(created.status, 201);
    assert.equal(created.body.stack, undefined);

    const invalid = await request(app)
        .post("/api/vehicles")
        .set("Origin", ORIGIN)
        .set("Cookie", cookie)
        .send({});
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "VALIDATION_ERROR");
    assert.equal(invalid.body.stack, undefined);

    // Wrong passwords per address slow down: five free, the sixth sets a
    // wait, and the next try right away has to wait.
    const accountStatuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
        const failed = await request(app)
            .post("/api/auth/login")
            .set("Origin", ORIGIN)
            .send({
                email: "prod@example.com",
                password: "wrong-password-xx",
            });
        accountStatuses.push(failed.status);
        if (failed.status === 429) {
            assert.equal(failed.body.code, "LOGIN_SLOW_DOWN");
            assert.equal(failed.headers["retry-after"], "2");
            break;
        }
    }
    assert.deepEqual(
        accountStatuses,
        [401, 401, 401, 401, 401, 401, 429],
        `account slowdown statuses: ${accountStatuses.join(",")}`,
    );

    let sawAuthLimit = false;
    for (let i = 0; i < 12; i += 1) {
        const attempt = await request(app)
            .post("/api/auth/register")
            .set("Origin", ORIGIN)
            .send({});
        if (attempt.status === 429) {
            assert.equal(attempt.body.code, "AUTH_RATE_LIMITED");
            sawAuthLimit = true;
            break;
        }
    }
    assert.equal(sawAuthLimit, true);

    let sawGlobalLimit = false;
    let firstHealthInBurst = 0;
    for (let i = 0; i < 340; i += 1) {
        const probe = await request(app).get("/api/health");
        if (i === 0) {
            firstHealthInBurst = probe.status;
        }
        if (probe.status === 429) {
            sawGlobalLimit = true;
            break;
        }
    }
    assert.equal(firstHealthInBurst, 200);
    assert.equal(sawGlobalLimit, true);

    console.log("production-guards: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
