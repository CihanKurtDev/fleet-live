import "./env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { insertAlert, loginAs } from "./helpers";
import { base32Decode, totpCode } from "../lib/totp";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";

const SECRET_KEYS = [
    "password_hash",
    "totp_secret",
    "password",
    "recovery_codes",
];

function assertNoSecrets(body: unknown) {
    const text = JSON.stringify(body);
    assert.equal(text.includes("password_hash"), false);
    assert.equal(text.includes("totp_secret"), false);
    assert.equal(text.includes("scrypt$"), false);
    for (const key of SECRET_KEYS) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(body, key),
            false,
            key,
        );
    }
}

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("plan gaps: contract and headers", () => {
    it("answers the health check without a session", async () => {
        const response = await request(app).get("/api/health");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { status: "ok" });
    });

    it("sends helmet defaults and hides the express signature", async () => {
        const response = await request(app).get("/api/health");
        assert.equal(response.headers["x-powered-by"], undefined);
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
    });

    it("sets HttpOnly and SameSite on the session cookie outside production", async () => {
        const { cookie } = await loginAs(1);
        assert.match(cookie, /fleet_session=/);
        const login = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        const header = String(login.headers["set-cookie"]);
        assert.match(header, /HttpOnly/i);
        assert.match(header, /SameSite=Lax/i);
        assert.doesNotMatch(header, /Secure/i);
    });

    it("rejects anonymous calls on the protected surface", async () => {
        const calls = [
            request(app).get("/api/vehicles"),
            request(app).get("/api/vehicles/positions"),
            request(app).get("/api/vehicles/drivers"),
            request(app).get("/api/vehicles/1/telemetry"),
            request(app).get("/api/vehicles/1/trips"),
            request(app).get("/api/vehicles/1/trips/latest"),
            request(app).get("/api/stream"),
            request(app).post("/api/stream/focus").send({ ids: [1] }),
            request(app).get("/api/sim"),
            request(app).patch("/api/sim").send({ running: false }),
            request(app).get("/api/alerts"),
            request(app).get("/api/drivers"),
            request(app).get("/api/briefing"),
            request(app).get("/api/sites"),
            request(app).get("/api/import/runs"),
            request(app).get("/api/export/vehicles"),
            request(app).get("/api/export/alerts"),
            request(app).get("/api/export/trips"),
            request(app).get("/api/export/period"),
            request(app).post("/api/import/preview").send({ csv: "a" }),
            request(app).get("/api/auth/me"),
            request(app).get("/api/auth/members"),
            request(app).post("/api/auth/invites").send({
                email: "a@b.test",
                role: "viewer",
            }),
        ];

        const responses = await Promise.all(calls);
        for (const response of responses) {
            assert.equal(response.status, 401, response.body?.code);
            assert.equal(response.body.code, "UNAUTHORIZED");
        }
    });

    it("includes a stack outside production and German field errors", async () => {
        const { agent } = await loginAs(1);
        const response = await agent.post("/api/vehicles").send({});
        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
        assert.equal(typeof response.body.stack, "string");
        assert.equal(typeof response.body.fields.license_plate, "string");
    });
});

describe("plan gaps: injection and secrets", () => {
    it("treats search quotes as text on vehicles and drivers", async () => {
        const { agent } = await loginAs(1);
        await agent.post("/api/vehicles").send({
            license_plate: "K-INJ 1",
            fuel_level: 50,
            status: "IDLE",
        });
        await agent.post("/api/drivers").send({ name: "O'Brien" });

        const vehicleSearch = await agent
            .get("/api/vehicles")
            .query({ search: "' OR 1=1 --" });
        assert.equal(vehicleSearch.status, 200);
        assert.equal(vehicleSearch.body.data.length, 0);

        const driverSearch = await agent
            .get("/api/drivers")
            .query({ search: "' OR 1=1 --" });
        assert.equal(driverSearch.status, 200);
        assert.equal(driverSearch.body.data.length, 0);

        const literal = await agent
            .get("/api/drivers")
            .query({ search: "O'Brien" });
        assert.equal(literal.status, 200);
        assert.equal(literal.body.data.length, 1);

        const alertSort = await agent
            .get("/api/alerts")
            .query({ sort: "id; DROP TABLE alerts" });
        assert.equal(alertSort.status, 400);
        assert.equal(alertSort.body.code, "VALIDATION_ERROR");
    });

    it("stores markup as data and omits secrets from JSON", async () => {
        const { agent } = await loginAs(1);
        const plate = "K-XSS<script>";
        const created = await agent.post("/api/vehicles").send({
            license_plate: plate,
            fuel_level: 50,
            status: "IDLE",
            depot: "<img src=x onerror=alert(1)>",
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.license_plate, plate);
        assertNoSecrets(created.body);

        const me = await agent.get("/api/auth/me");
        assert.equal(me.status, 200);
        assertNoSecrets(me.body);

        const driver = await agent
            .post("/api/drivers")
            .send({ name: "<script>alert(1)</script>", phone: "+49221" });
        assert.equal(driver.status, 201);
        assert.equal(driver.body.data.name, "<script>alert(1)</script>");
        assertNoSecrets(driver.body);

        const members = await agent.get("/api/auth/members");
        assert.equal(members.status, 200);
        assert.equal(JSON.stringify(members.body).includes("password_hash"), false);
        assert.equal(JSON.stringify(members.body).includes("totp_secret"), false);
    });
});

describe("plan gaps: roles and tenant", () => {
    it("forbids viewer writes across the dispatcher surface", async () => {
        const dispatcher = await loginAs(1, "dispatcher");
        const vehicle = await dispatcher.agent.post("/api/vehicles").send({
            license_plate: "K-VIEW 1",
            fuel_level: 50,
            status: "IDLE",
        });
        assert.equal(vehicle.status, 201);
        const alertId = insertAlert(vehicle.body.id);

        const { agent } = await loginAs(1, "viewer");
        const writes = [
            () =>
                agent.post("/api/vehicles").send({
                    license_plate: "K-VIEW 2",
                    fuel_level: 10,
                    status: "IDLE",
                }),
            () => agent.patch("/api/sim").send({ running: false }),
            () =>
                agent
                    .patch(`/api/alerts/${alertId}`)
                    .send({ resolved: true }),
            () => agent.post("/api/drivers").send({ name: "Viewer legt an" }),
            () =>
                agent.post("/api/sites").send({
                    name: "Köln",
                    latitude: 50.9,
                    longitude: 6.9,
                }),
            () =>
                agent
                    .post("/api/import/preview")
                    .send({ csv: "Kennzeichen\nK-1\n" }),
            () =>
                agent.post("/api/auth/invites").send({
                    email: "neu@example.com",
                    role: "viewer",
                }),
            () => agent.get("/api/auth/members"),
            () =>
                agent.patch("/api/due/settings").send({
                    due_lead_days: 14,
                }),
            () => agent.get("/api/export/vehicles"),
            () => agent.get("/api/export/alerts"),
            () => agent.get("/api/export/trips"),
            () => agent.get("/api/export/period"),
        ];

        for (const call of writes) {
            const response = await call();
            assert.equal(response.status, 403);
            assert.equal(response.body.code, "FORBIDDEN");
        }

        const reads = await Promise.all([
            agent.get("/api/vehicles"),
            agent.get("/api/sim"),
            agent.get("/api/alerts"),
            agent.get("/api/drivers"),
            agent.get("/api/sites"),
            agent.get("/api/briefing"),
            agent.get("/api/due/settings"),
        ]);
        for (const response of reads) {
            assert.equal(response.status, 200);
        }
    });

    it("hides another company's vehicle, driver, alert and site", async () => {
        const other = await loginAs(2, "dispatcher");
        const vehicle = await other.agent.post("/api/vehicles").send({
            license_plate: "K-FREMD 1",
            fuel_level: 50,
            status: "IDLE",
        });
        const driver = await other.agent
            .post("/api/drivers")
            .send({ name: "Fremd Fahrer" });
        const driverId = driver.body.data.id as number;
        const site = await other.agent.post("/api/sites").send({
            name: "Fremd Depot",
            latitude: 48.1,
            longitude: 11.5,
        });
        const alertId = insertAlert(vehicle.body.id);
        assert.equal(vehicle.status, 201);
        assert.equal(driver.status, 201);
        assert.equal(site.status, 201);

        const { agent } = await loginAs(1, "dispatcher");
        const hidden = await Promise.all([
            agent.get(`/api/vehicles/${vehicle.body.id}`),
            agent.get(`/api/drivers/${driverId}`),
            agent
                .patch(`/api/sites/${site.body.id}`)
                .send({ name: "Übernommen" }),
            agent.patch(`/api/alerts/${alertId}`).send({ resolved: true }),
        ]);
        for (const response of hidden) {
            assert.equal(response.status, 404);
            assert.equal(response.body.code, "NOT_FOUND");
        }

        const sites = await agent.get("/api/sites");
        assert.equal(
            sites.body.data.some(
                (row: { name: string }) => row.name === "Fremd Depot",
            ),
            false,
        );
    });
});

describe("plan gaps: password and totp", () => {
    it("rejects a wrong current password and accepts a new one", async () => {
        const { agent } = await loginAs(1);
        const wrong = await agent.post("/api/auth/password").send({
            current_password: "not-the-password",
            password: "replacement-password",
        });
        assert.equal(wrong.status, 400);
        assert.equal(wrong.body.code, "VALIDATION_ERROR");
        assert.equal(
            wrong.body.fields.current_password,
            "Aktuelles Passwort ist falsch.",
        );

        const changed = await agent.post("/api/auth/password").send({
            current_password: "secret-password",
            password: "replacement-password",
        });
        assert.equal(changed.status, 204);

        const oldLogin = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        assert.equal(oldLogin.status, 401);

        const next = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "replacement-password",
        });
        assert.equal(next.status, 200);
    });

    it("disables totp, rejects a bad code, and blocks disable when the company requires it", async () => {
        const { agent } = await loginAs(1);
        const setup = await agent.post("/api/auth/totp/setup").expect(200);
        const secret = setup.body.secret as string;
        const confirmed = await agent.post("/api/auth/totp/confirm").send({
            setup_token: setup.body.setup_token,
            code: totpCode(base32Decode(secret)),
        });
        assert.equal(confirmed.status, 200);
        assert.equal(confirmed.body.recovery_codes.length, 8);
        const codes = confirmed.body.recovery_codes as string[];

        const me = await agent.get("/api/auth/me");
        assert.equal(me.body.recovery_codes, undefined);
        assert.equal(me.body.totp_secret, undefined);
        assert.equal(JSON.stringify(me.body).includes(codes[0]), false);

        await agent.post("/api/auth/logout").expect(204);
        const challenge = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        assert.equal(challenge.status, 200);
        assert.equal(challenge.body.step, "totp");
        assert.equal(challenge.headers["set-cookie"], undefined);

        const wrong = await request(app).post("/api/auth/totp").send({
            challenge: challenge.body.challenge,
            code: "000000",
        });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.body.error, "Code ist falsch.");
        assert.equal(wrong.headers["set-cookie"], undefined);

        const done = await request(app).post("/api/auth/totp").send({
            challenge: challenge.body.challenge,
            code: totpCode(base32Decode(secret)),
        });
        assert.equal(done.status, 200);
        const session = String(done.headers["set-cookie"]).split(";")[0];
        const authed = request(app);

        const badDisable = await authed
            .post("/api/auth/totp/disable")
            .set("Cookie", session)
            .send({ code: "000000" });
        assert.equal(badDisable.status, 400);

        await authed
            .patch("/api/auth/security")
            .set("Cookie", session)
            .send({ totp_required: true })
            .expect(200);

        const blocked = await authed
            .post("/api/auth/totp/disable")
            .set("Cookie", session)
            .send({ code: totpCode(base32Decode(secret)) });
        assert.equal(blocked.status, 403);
        assert.match(blocked.body.error, /Zwei-Faktor/);

        await authed
            .patch("/api/auth/security")
            .set("Cookie", session)
            .send({ totp_required: false })
            .expect(200);

        const disabled = await authed
            .post("/api/auth/totp/disable")
            .set("Cookie", session)
            .send({ code: totpCode(base32Decode(secret)) });
        assert.equal(disabled.status, 200);
        assert.equal(disabled.body.recovery_codes, undefined);

        const plain = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        assert.equal(plain.status, 200);
        assert.equal(plain.body.step, undefined);
        assert.match(String(plain.headers["set-cookie"]), /fleet_session=/);
    });
});

describe("plan gaps: production process", () => {
    it("enforces origin, secure cookies, hidden stacks and rate limits", () => {
        const result = spawnSync(
            "npx tsx src/test/productionGuards.child.ts",
            {
                cwd: path.resolve(__dirname, "../.."),
                env: {
                    ...process.env,
                    NODE_ENV: "production",
                    DATABASE_PATH: ":memory:",
                    CORS_ORIGIN: "http://allowed.example",
                    TOTP_ENCRYPTION_KEY: "plan-gap-totp-key",
                    TELEMETRY_TICK_MS: "0",
                    LOG_LEVEL: "info",
                    SMTP_URL: "",
                },
                encoding: "utf8",
                shell: true,
            },
        );

        const output = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, 0, output);
        assert.match(output, /production-guards: ok/);
        assert.match(output, /\[Redacted\]/);
        assert.equal(output.includes("SENTINEL_COOKIE_VALUE"), false);
        assert.equal(output.includes("SENTINEL_AUTH_VALUE"), false);
    });
});
