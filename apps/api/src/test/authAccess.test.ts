import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { takeMails } from "../lib/mailer";
import { setOidcDriverForTests } from "../lib/oidc";
import { base32Decode, totpCode } from "../lib/totp";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";

const PASSWORD = "register-password";

function tokenFrom(link: string): string {
    const token = new URL(link).searchParams.get("token");
    assert.ok(token);
    return token;
}

afterEach(() => {
    setOidcDriverForTests(null);
    takeMails();
    UserModel.resetForTests();
});

describe("registration and email confirmation", () => {
    it("does not open a session until the email is confirmed", async () => {
        const created = await request(app).post("/api/auth/register").send({
            company_name: "Nordlicht GmbH",
            name: "Ada Admin",
            email: "ada@nordlicht.test",
            password: PASSWORD,
        });

        assert.equal(created.status, 201);
        assert.equal(created.headers["set-cookie"], undefined);
        const [mail] = takeMails();
        assert.ok(mail);
        assert.equal(mail.to, "ada@nordlicht.test");
        assert.doesNotMatch(JSON.stringify(created.body), /token/);

        const blocked = await request(app).post("/api/auth/login").send({
            email: "ada@nordlicht.test",
            password: PASSWORD,
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body.code, "EMAIL_UNVERIFIED");

        const verified = await request(app)
            .post("/api/auth/verify-email")
            .send({ token: tokenFrom(mail.link) });
        assert.equal(verified.status, 204);
        const again = await request(app)
            .post("/api/auth/verify-email")
            .send({ token: tokenFrom(mail.link) });
        assert.equal(again.status, 204);

        const login = await request(app).post("/api/auth/login").send({
            email: "ada@nordlicht.test",
            password: PASSWORD,
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.company_name, "Nordlicht GmbH");
        assert.equal(login.body.role, "dispatcher");
        assert.equal(login.body.import_prompt, true);
    });

    it("uses the same forgot-password answer when the email is unknown", async () => {
        UserModel.create({
            name: "Known",
            email: "known@example.com",
            password: PASSWORD,
            company_id: 1,
        });

        const known = await request(app)
            .post("/api/auth/forgot-password")
            .send({ email: "known@example.com" });
        const unknown = await request(app)
            .post("/api/auth/forgot-password")
            .send({ email: "missing@example.com" });

        assert.equal(known.status, 200);
        assert.equal(unknown.status, 200);
        assert.deepEqual(unknown.body, known.body);
        assert.equal(takeMails().length, 1);
    });

    it("invalidates every session when the password is reset", async () => {
        UserModel.create({
            name: "Known",
            email: "known@example.com",
            password: PASSWORD,
            company_id: 1,
        });
        const first = request.agent(app);
        const second = request.agent(app);
        const credentials = {
            email: "known@example.com",
            password: PASSWORD,
        };
        await first.post("/api/auth/login").send(credentials).expect(200);
        await second.post("/api/auth/login").send(credentials).expect(200);
        await request(app)
            .post("/api/auth/forgot-password")
            .send({ email: "known@example.com" })
            .expect(200);
        const [mail] = takeMails();
        assert.ok(mail);

        await request(app)
            .post("/api/auth/reset-password")
            .send({ token: tokenFrom(mail.link), password: "replacement-password" })
            .expect(204);

        await first.get("/api/auth/me").expect(401);
        await second.get("/api/auth/me").expect(401);
        await request(app)
            .post("/api/auth/reset-password")
            .send({
                token: tokenFrom(mail.link),
                password: "replacement-password",
            })
            .expect(400);
    });
});

describe("memberships", () => {
    it("switches company and hides the other fleet", async () => {
        const { agent } = await loginDispatcher();
        const vehicle = VehicleModel.create({
            license_plate: "K-AC 100",
            fuel_level: 80,
            status: "IDLE",
            company_id: 1,
        });

        const created = await agent
            .post("/api/auth/companies")
            .send({ name: "Leere Firma" })
            .expect(201);
        assert.equal(created.body.company_name, "Leere Firma");
        assert.equal(created.body.import_prompt, true);

        await agent.get(`/api/vehicles/${vehicle.id}`).expect(404);
        await agent
            .post("/api/auth/import-prompt/dismiss")
            .expect(200)
            .expect((response) => {
                assert.equal(response.body.import_prompt, false);
            });

        const back = await agent
            .post("/api/auth/company")
            .send({ company_id: 1 })
            .expect(200);
        assert.equal(back.body.company_id, 1);
        await agent.get(`/api/vehicles/${vehicle.id}`).expect(200);
    });

    it("invites a viewer and keeps the last dispatcher", async () => {
        const { agent, userId } = await loginDispatcher();

        const demote = await agent
            .patch(`/api/auth/members/${userId}`)
            .send({ role: "viewer" });
        assert.equal(demote.status, 403);

        await agent
            .post("/api/auth/invites")
            .send({ email: "viewer-new@example.com", role: "viewer" })
            .expect(201);
        const [invite] = takeMails();
        assert.ok(invite);
        const accepted = await request(app)
            .post("/api/auth/invites/accept")
            .send({
                token: tokenFrom(invite.link),
                name: "Neue Person",
                password: PASSWORD,
            })
            .expect(200);
        assert.equal(accepted.body.role, "viewer");
        const viewer = request.agent(app);
        const cookie = accepted.headers["set-cookie"];
        assert.ok(cookie);
        await viewer
            .post("/api/vehicles")
            .set("Cookie", cookie)
            .send({
                license_plate: "K-NO 1",
                fuel_level: 50,
                status: "IDLE",
            })
            .expect(403);

        await agent
            .post("/api/auth/invites")
            .send({ email: "second@example.com", role: "dispatcher" })
            .expect(201);
        const mails = takeMails();
        const second = mails.find((mail) => mail.to === "second@example.com");
        assert.ok(second);
        await request(app)
            .post("/api/auth/invites/accept")
            .send({
                token: tokenFrom(second.link),
                name: "Zweiter",
                password: PASSWORD,
            })
            .expect(200);

        await agent
            .patch(`/api/auth/members/${userId}`)
            .send({ role: "viewer" })
            .expect(200);
    });

    it("adds a membership when the email already has an account", async () => {
        UserModel.create({
            name: "Bestehend",
            email: "bestehend@example.com",
            password: PASSWORD,
            company_id: 1,
            role: "viewer",
        });
        const { agent } = await loginDispatcher();
        await agent
            .post("/api/auth/companies")
            .send({ name: "Zweite Mitgliedschaft" })
            .expect(201);
        await agent
            .post("/api/auth/invites")
            .send({ email: "bestehend@example.com", role: "dispatcher" })
            .expect(201);

        const login = await request(app).post("/api/auth/login").send({
            email: "bestehend@example.com",
            password: PASSWORD,
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.memberships.length, 2);
    });
});

describe("totp and sso", () => {
    it("asks for a code after the password when totp is enabled", async () => {
        const { agent } = await loginDispatcher();
        const setup = await agent.post("/api/auth/totp/setup").expect(200);
        const code = totpCode(base32Decode(setup.body.secret));
        const confirmed = await agent.post("/api/auth/totp/confirm").send({
            setup_token: setup.body.setup_token,
            code,
        });
        assert.equal(confirmed.status, 200);
        assert.equal(confirmed.body.recovery_codes.length, 8);
        await agent.post("/api/auth/logout").expect(204);

        const challenge = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        assert.equal(challenge.status, 200);
        assert.equal(challenge.body.step, "totp");
        assert.equal(challenge.headers["set-cookie"], undefined);

        const done = await request(app).post("/api/auth/totp").send({
            challenge: challenge.body.challenge,
            code: totpCode(base32Decode(setup.body.secret)),
        });
        assert.equal(done.status, 200);
        assert.equal(done.body.email, "dispatcher-1@example.com");
        assert.match(String(done.headers["set-cookie"]), /fleet_session=/);
    });

    it("logs an existing user in through the mocked issuer", async () => {
        UserModel.create({
            name: "SSO",
            email: "sso@example.com",
            password: PASSWORD,
            company_id: 1,
        });
        setOidcDriverForTests({
            async authorizationUrl(input) {
                return `https://idp.example/auth?state=${encodeURIComponent(input.state)}`;
            },
            async callback() {
                return {
                    subject: "subject-1",
                    email: "sso@example.com",
                    emailVerified: true,
                    name: "SSO",
                };
            },
        });

        const start = await request(app)
            .get("/api/auth/sso/google/start")
            .redirects(0);
        assert.equal(start.status, 302);
        const location = String(start.headers.location);
        const state = new URL(location).searchParams.get("state");
        assert.ok(state);
        const cookie = start.headers["set-cookie"];
        assert.ok(cookie);

        const done = await request(app)
            .get(`/api/auth/sso/google/callback?code=abc&state=${encodeURIComponent(state)}`)
            .set("Cookie", cookie)
            .redirects(0);
        assert.equal(done.status, 302);
        assert.match(String(done.headers.location), /\/$/);
        const session = done.headers["set-cookie"];
        assert.match(String(session), /fleet_session=/);

        const me = await request(app)
            .get("/api/auth/me")
            .set("Cookie", session);
        assert.equal(me.status, 200);
        assert.equal(me.body.email, "sso@example.com");
    });

    it("refuses the password when the company requires its own login", async () => {
        const { agent } = await loginDispatcher();
        await agent
            .patch("/api/auth/security")
            .send({
                sso_issuer: "https://login.example.com",
                sso_client_id: "client",
                sso_client_secret: "secret-value",
                sso_required: true,
            })
            .expect(200);
        const saved = await agent.get("/api/auth/security");
        assert.equal(saved.status, 200);
        assert.equal(saved.body.sso_issuer, "https://login.example.com");
        assert.equal(saved.body.sso_client_id, "client");
        assert.equal(saved.body.sso_secret_set, true);
        assert.equal(saved.body.sso_client_secret, undefined);

        const discovered = await request(app)
            .post("/api/auth/sso/company/discover")
            .send({ email: "dispatcher-1@example.com" });
        assert.equal(discovered.status, 200);
        assert.equal(discovered.body.company_id, 1);

        const blocked = await request(app).post("/api/auth/login").send({
            email: "dispatcher-1@example.com",
            password: "secret-password",
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body.code, "SSO_REQUIRED");
        assert.equal(blocked.body.details.sso_company_id, 1);
    });

    it("does not advertise Google or Microsoft without client credentials", async () => {
        const listed = await request(app).get("/api/auth/sso/providers");
        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body, { google: false, microsoft: false });

        const start = await request(app)
            .get("/api/auth/sso/google/start")
            .redirects(0);
        assert.equal(start.status, 302);
        assert.match(String(start.headers.location), /sso=unconfigured/);
    });
});

async function loginDispatcher() {
    const email = "dispatcher-1@example.com";

    if (!UserModel.findByEmail(email)) {
        UserModel.create({
            name: "Dispatcher 1",
            email,
            password: "secret-password",
            company_id: 1,
        });
    }

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
        email,
        password: "secret-password",
    });
    assert.equal(login.status, 200);

    return { agent, userId: login.body.id as number };
}
