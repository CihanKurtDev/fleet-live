import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { takeMails } from "../lib/mailer";
import { seal } from "../lib/secretBox";
import { base32Decode, base32Encode, randomTotpSecret, totpCode } from "../lib/totp";
import { UserModel } from "../models/user.model";
import {
    addMembership,
    configureCompanyIdp,
    cookieValue,
    finish,
    IDP_A,
    idp,
    PASSWORD,
    passwordLogin,
    profile,
    startLink,
    startLogin,
    user,
} from "./ssoFlow";

function withTotp(userId: number) {
    const secret = base32Encode(randomTotpSecret());
    UserModel.setTotp(userId, seal(secret), true);
    return secret;
}

function code(secret: string, at = Date.now()) {
    return totpCode(base32Decode(secret), at);
}

function requireTotp(companyId: number) {
    db.prepare("UPDATE companies SET totp_required = 1 WHERE id = ?").run(companyId);
}

function requireSso(companyId: number) {
    db.prepare("UPDATE companies SET sso_required = 1 WHERE id = ?").run(companyId);
}

/** The login step an identity provider hands back to the sign-in page. */
function challengeFrom(location: string) {
    const url = new URL(location);
    assert.equal(url.pathname, "/login");
    const hash = new URLSearchParams(url.hash.slice(1));
    const challenge = hash.get("challenge");
    assert.ok(challenge, `no step in ${location}`);
    return { challenge, step: hash.get("step") };
}

/** A person with a linked company login of company 1 (issuer IDP_A). */
async function linkedToCompanyIdp(email: string) {
    const person = user(email);
    configureCompanyIdp(1, IDP_A);
    const { agent, cookie } = await passwordLogin(email);
    idp.next = profile({ email, issuer: IDP_A, subject: `a-${email}` });
    const linked = await finish(await startLink(agent, { provider: "company", company_id: 1 }), cookie);
    assert.match(String(linked.headers.location), /sso=linked/);
    await agent.post("/api/auth/logout").expect(204);
    idp.next = profile({ email, issuer: IDP_A, subject: `a-${email}` });
    return person;
}

async function linkedToGoogle(email: string, companyId = 1) {
    const person = user(email, companyId);
    const { agent, cookie } = await passwordLogin(email);
    idp.next = profile({ email });
    await finish(await startLink(agent, { provider: "google" }), cookie);
    await agent.post("/api/auth/logout").expect(204);
    idp.next = profile({ email });
    return person;
}

describe("the second factor after an identity provider", () => {
    it("is asked when the company requires it, also after its own login", async () => {
        const person = await linkedToCompanyIdp("idp-mfa@example.com");
        const secret = withTotp(person.id);
        requireTotp(1);

        const done = await finish(await startLogin("company", 1));
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
        const step = challengeFrom(String(done.headers.location));
        assert.equal(step.step, "totp");

        const signedIn = await request(app)
            .post("/api/auth/totp")
            .send({ challenge: step.challenge, code: code(secret) });
        assert.equal(signedIn.status, 200);
        assert.equal(signedIn.body.company_id, 1);
        assert.ok(cookieValue(signedIn.headers["set-cookie"], "fleet_session"));
    });

    it("is asked when the account has one", async () => {
        const person = await linkedToGoogle("own-factor@example.com");
        withTotp(person.id);

        const done = await finish(await startLogin("google"));
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
        assert.equal(challengeFrom(String(done.headers.location)).step, "totp");
    });

    it("is set up first when the company requires one the account does not have", async () => {
        await linkedToGoogle("enrol@example.com");
        requireTotp(1);

        const done = await finish(await startLogin("google"));
        const step = challengeFrom(String(done.headers.location));
        assert.equal(step.step, "totp_enroll");

        const setup = await request(app)
            .post("/api/auth/totp/setup")
            .send({ challenge: step.challenge });
        assert.equal(setup.status, 200);
        const confirmed = await request(app)
            .post("/api/auth/totp")
            .send({ challenge: step.challenge, code: code(setup.body.secret) });
        assert.equal(confirmed.status, 200);
        assert.equal(confirmed.body.recovery_codes.length, 8);
    });
});

describe("a company that requires its own login", () => {
    it("cannot be entered with Google", async () => {
        await linkedToGoogle("google-only@example.com");
        requireSso(1);

        const done = await finish(await startLogin("google"));
        assert.match(String(done.headers.location), /sso=company/);
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
    });

    it("is skipped by Google for another company, and the switch is refused", async () => {
        const person = await linkedToGoogle("two-companies@example.com", 1);
        addMembership(person.id, 2, "viewer");
        requireSso(1);

        const done = await finish(await startLogin("google"));
        const session = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(session);
        const me = await request(app).get("/api/auth/me").set("Cookie", session);
        assert.equal(me.body.company_id, 2);

        const switched = await request(app)
            .post("/api/auth/company")
            .set("Cookie", session)
            .send({ company_id: 1 });
        assert.equal(switched.status, 403);
        assert.equal(switched.body.code, "SSO_REQUIRED");
    });

    it("lets a member link the company login after the password and the second factor", async () => {
        const person = user("first-link@example.com");
        const secret = withTotp(person.id);
        configureCompanyIdp(1, IDP_A, true);

        const login = await request(app)
            .post("/api/auth/login")
            .send({ email: "first-link@example.com", password: PASSWORD });
        assert.equal(login.body.step, "totp");
        const blocked = await request(app)
            .post("/api/auth/totp")
            .send({ challenge: login.body.challenge, code: code(secret) });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body.code, "SSO_REQUIRED");
        assert.equal(cookieValue(blocked.headers["set-cookie"], "fleet_session"), undefined);
        const linkChallenge = blocked.body.details.link_challenge;
        assert.equal(typeof linkChallenge, "string");

        const started = await request(app)
            .post("/api/auth/sso/link")
            .send({ provider: "company", company_id: 1, challenge: linkChallenge });
        assert.equal(started.status, 200);
        const flow = {
            state: new URL(started.body.url).searchParams.get("state") ?? "",
            cookie: cookieValue(started.headers["set-cookie"], "fleet_sso") ?? "",
            provider: "company",
        };
        idp.next = profile({ email: "first-link@example.com", issuer: IDP_A, subject: "first" });
        const done = await finish(flow);
        const session = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(session, String(done.headers.location));
        const me = await request(app).get("/api/auth/me").set("Cookie", session);
        assert.equal(me.status, 200);
        assert.equal(me.body.company_id, 1);

        // The link step is used up.
        const again = await request(app)
            .post("/api/auth/sso/link")
            .send({ provider: "company", company_id: 1, challenge: linkChallenge });
        assert.equal(again.status, 401);
    });

    it("hands out no link step once the company login is linked", async () => {
        await linkedToCompanyIdp("already@example.com");
        requireSso(1);

        const login = await request(app)
            .post("/api/auth/login")
            .send({ email: "already@example.com", password: PASSWORD });
        assert.equal(login.status, 403);
        assert.equal(login.body.code, "SSO_REQUIRED");
        assert.equal(login.body.details.link_challenge, undefined);
    });
});

describe("an open session", () => {
    it("ends when the company starts to require a second factor it did not pass", async () => {
        user("no-factor@example.com");
        const { cookie } = await passwordLogin("no-factor@example.com");
        assert.ok(cookie);
        await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);

        requireTotp(1);
        const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
        assert.equal(me.status, 401);
        const vehicles = await request(app).get("/api/vehicles").set("Cookie", cookie);
        assert.equal(vehicles.status, 401);
    });

    it("stays when it passed the second factor", async () => {
        const person = user("factor@example.com");
        const secret = withTotp(person.id);
        const login = await request(app)
            .post("/api/auth/login")
            .send({ email: "factor@example.com", password: PASSWORD });
        const done = await request(app)
            .post("/api/auth/totp")
            .send({ challenge: login.body.challenge, code: code(secret) });
        const cookie = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(cookie);

        requireTotp(1);
        await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    });

    it("ends when the company starts to require its own login", async () => {
        user("password-only@example.com");
        const { cookie } = await passwordLogin("password-only@example.com");
        assert.ok(cookie);
        requireSso(1);

        const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
        assert.equal(me.status, 401);
    });

    it("cannot switch into a company whose second factor it did not pass", async () => {
        const person = user("switcher@example.com", 1);
        addMembership(person.id, 2, "dispatcher");
        const { agent, cookie } = await passwordLogin("switcher@example.com");
        const me = await agent.get("/api/auth/me").expect(200);
        const other = me.body.company_id === 1 ? 2 : 1;
        requireTotp(other);

        const switched = await request(app)
            .post("/api/auth/company")
            .set("Cookie", cookie ?? "")
            .send({ company_id: other });
        assert.equal(switched.status, 403);
        assert.equal(switched.body.code, "TOTP_REQUIRED");
    });

    it("counts a second factor set up during the session", async () => {
        user("set-up-now@example.com");
        const { agent } = await passwordLogin("set-up-now@example.com");
        const setup = await agent.post("/api/auth/totp/setup").expect(200);
        await agent
            .post("/api/auth/totp/confirm")
            .send({ setup_token: setup.body.setup_token, code: code(setup.body.secret) })
            .expect(200);

        const saved = await agent.patch("/api/auth/security").send({ totp_required: true });
        assert.equal(saved.status, 200);
        await agent.get("/api/auth/me").expect(200);
    });
});

describe("the company security settings", () => {
    it("cannot require a second factor from a session without one", async () => {
        user("lockout@example.com");
        const { agent } = await passwordLogin("lockout@example.com");

        const saved = await agent.patch("/api/auth/security").send({ totp_required: true });
        assert.equal(saved.status, 403);
        assert.equal(saved.body.code, "TOTP_REQUIRED");
        await agent.get("/api/auth/me").expect(200);
    });

    it("cannot require the company login before the own account is linked to it", async () => {
        user("sso-lockout@example.com");
        configureCompanyIdp(1, IDP_A);
        const { agent } = await passwordLogin("sso-lockout@example.com");

        const saved = await agent.patch("/api/auth/security").send({ sso_required: true, sso_issuer: IDP_A });
        assert.equal(saved.status, 403);
        assert.equal(saved.body.code, "SSO_LINK_REQUIRED");
        assert.equal(saved.body.details.company_id, 1);
        await agent.get("/api/auth/me").expect(200);
    });

    it("can require it from a password session once the own account is linked", async () => {
        user("linked-admin@example.com");
        configureCompanyIdp(1, IDP_A);
        const { agent, cookie } = await passwordLogin("linked-admin@example.com");
        idp.next = profile({ email: "linked-admin@example.com", issuer: IDP_A, subject: "admin" });
        await finish(await startLink(agent, { provider: "company", company_id: 1 }), cookie);

        const saved = await agent.patch("/api/auth/security").send({ sso_required: true, sso_issuer: IDP_A });
        assert.equal(saved.status, 200);
        // The password session ends; the company login works for the dispatcher.
        await agent.get("/api/auth/me").expect(401);
        idp.next = profile({ email: "linked-admin@example.com", issuer: IDP_A, subject: "admin" });
        const done = await finish(await startLogin("company", 1));
        assert.ok(cookieValue(done.headers["set-cookie"], "fleet_session"));
    });

    it("does not count a link to an earlier issuer", async () => {
        user("old-link@example.com");
        configureCompanyIdp(1, IDP_A);
        const { agent, cookie } = await passwordLogin("old-link@example.com");
        idp.next = profile({ email: "old-link@example.com", issuer: IDP_A, subject: "old" });
        await finish(await startLink(agent, { provider: "company", company_id: 1 }), cookie);
        configureCompanyIdp(1, "https://idp-new.example.com");

        const saved = await agent
            .patch("/api/auth/security")
            .send({ sso_required: true, sso_issuer: "https://idp-new.example.com" });
        assert.equal(saved.status, 403);
        assert.equal(saved.body.code, "SSO_LINK_REQUIRED");
    });

    it("does not change the company login while it is required", async () => {
        await linkedToCompanyIdp("change-idp@example.com");
        requireSso(1);
        const done = await finish(await startLogin("company", 1));
        const cookie = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(cookie);

        for (const change of [
            { sso_issuer: "https://idp-new.example.com" },
            { sso_client_id: "another-client" },
        ]) {
            const saved: request.Response = await request(app)
                .patch("/api/auth/security")
                .set("Cookie", cookie)
                .send(change);
            assert.equal(saved.status, 409, JSON.stringify(change));
        }

        const off = await request(app)
            .patch("/api/auth/security")
            .set("Cookie", cookie)
            .send({ sso_required: false, sso_issuer: "https://idp-new.example.com" });
        assert.equal(off.status, 200);
    });

    it("can require the company login from a session of that login", async () => {
        await linkedToCompanyIdp("sso-admin@example.com");
        const done = await finish(await startLogin("company", 1));
        const cookie = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(cookie);

        const saved = await request(app)
            .patch("/api/auth/security")
            .set("Cookie", cookie)
            .send({ sso_required: true, sso_issuer: IDP_A });
        assert.equal(saved.status, 200);
        await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    });
});

describe("accepting an invite", () => {
    it("opens no session when the company requires a second factor", async () => {
        user("inviter@example.com");
        const { agent } = await passwordLogin("inviter@example.com");
        takeMails();
        await agent
            .post("/api/auth/invites")
            .send({ email: "invited@example.com", role: "viewer" })
            .expect(201);
        const [mail] = takeMails();
        assert.ok(mail?.link);
        const token = new URL(mail.link).searchParams.get("token");
        requireTotp(1);

        const accepted = await request(app)
            .post("/api/auth/invites/accept")
            .send({ token, name: "Neu", password: "invited-password" });
        assert.equal(accepted.status, 200);
        assert.deepEqual(accepted.body, { next: "login" });
        assert.equal(cookieValue(accepted.headers["set-cookie"], "fleet_session"), undefined);

        const login = await request(app)
            .post("/api/auth/login")
            .send({ email: "invited@example.com", password: "invited-password" });
        assert.equal(login.body.step, "totp_enroll");
    });
});

describe("a time step", () => {
    it("is not accepted twice for the second factor after a company login", async () => {
        const person = await linkedToCompanyIdp("twice@example.com");
        const secret = withTotp(person.id);
        requireTotp(1);
        const now = Date.now();

        const first = challengeFrom(String((await finish(await startLogin("company", 1))).headers.location));
        await request(app)
            .post("/api/auth/totp")
            .send({ challenge: first.challenge, code: code(secret, now) })
            .expect(200);

        idp.next = profile({ email: "twice@example.com", issuer: IDP_A, subject: "a-twice@example.com" });
        const second = challengeFrom(String((await finish(await startLogin("company", 1))).headers.location));
        const replay = await request(app)
            .post("/api/auth/totp")
            .send({ challenge: second.challenge, code: code(secret, now) });
        assert.equal(replay.status, 401);
    });
});
