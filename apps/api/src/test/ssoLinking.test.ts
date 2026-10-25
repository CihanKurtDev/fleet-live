import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";
import {
    addMembership,
    configureCompanyIdp,
    cookieValue,
    finish,
    GOOGLE,
    IDP_A,
    IDP_B,
    identities,
    idp,
    passwordLogin,
    profile,
    sessionCount,
    startLink,
    startLogin,
    user,
} from "./ssoFlow";

describe("signing in with an external identity", () => {
    it("does not create an account for an unknown e-mail", async () => {
        idp.next = profile({ email: "nobody@example.com" });
        const done = await finish(await startLogin("google"));

        assert.equal(done.status, 302);
        assert.match(String(done.headers.location), /sso=unknown/);
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
        assert.equal(UserModel.findByEmail("nobody@example.com"), undefined);
        assert.equal(sessionCount(), 0);
    });

    it("never links to an existing local account by e-mail alone", async () => {
        user("local@example.com");
        idp.next = profile({ email: "local@example.com" });
        const done = await finish(await startLogin("google"));

        assert.match(String(done.headers.location), /sso=unknown/);
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
        assert.deepEqual(identities(), []);
        assert.equal(sessionCount(), 0);
    });

    it("does not let the login of company A sign in a user of company B", async () => {
        const other = user("b-user@example.com", 2);
        configureCompanyIdp(1, IDP_A);
        configureCompanyIdp(2, IDP_A);

        // The person links the shared issuer for company B, explicitly.
        const { agent, cookie } = await passwordLogin("b-user@example.com");
        idp.next = profile({ email: "b-user@example.com", issuer: IDP_A, subject: "b-sub" });
        const linked = await finish(
            await startLink(agent, { provider: "company", company_id: 2 }),
            cookie,
        );
        assert.match(String(linked.headers.location), /sso=linked/);
        assert.equal(identities()[0]?.user_id, other.id);

        // The same assertion through company A's login finds no one.
        idp.next = profile({ email: "b-user@example.com", issuer: IDP_A, subject: "b-sub" });
        const done = await finish(await startLogin("company", 1));
        assert.match(String(done.headers.location), /sso=unknown/);
        assert.equal(cookieValue(done.headers["set-cookie"], "fleet_session"), undefined);
    });

    it("keeps a company login inside that company for a person with several roles", async () => {
        const person = user("multi@example.com", 1, "dispatcher");
        addMembership(person.id, 2, "viewer");
        configureCompanyIdp(2, IDP_B);

        const { agent, cookie } = await passwordLogin("multi@example.com");
        idp.next = profile({ email: "multi@example.com", issuer: IDP_B, subject: "multi" });
        const linked = await finish(
            await startLink(agent, { provider: "company", company_id: 2 }),
            cookie,
        );
        assert.match(String(linked.headers.location), /sso=linked/);
        await agent.post("/api/auth/logout").expect(204);

        idp.next = profile({ email: "multi@example.com", issuer: IDP_B, subject: "multi" });
        const done = await finish(await startLogin("company", 2));
        const session = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(session);

        const me = await request(app).get("/api/auth/me").set("Cookie", session);
        assert.equal(me.status, 200);
        assert.equal(me.body.company_id, 2);
        assert.equal(me.body.role, "viewer");

        const viewerWrite = await request(app)
            .post("/api/drivers")
            .set("Cookie", session)
            .send({ name: "Nicht erlaubt" });
        assert.equal(viewerWrite.status, 403);

        // Company B's identity provider vouches for company B only.
        const switched = await request(app)
            .post("/api/auth/company")
            .set("Cookie", session)
            .send({ company_id: 1 });
        assert.equal(switched.status, 403);
        assert.equal(switched.body.code, "REAUTH_REQUIRED");
    });

    it("refuses an identity that is already linked to someone else", async () => {
        const owner = user("owner@example.com");
        user("thief@example.com");

        const ownerLogin = await passwordLogin("owner@example.com");
        idp.next = profile({ email: "owner@example.com", subject: "shared-sub" });
        await finish(
            await startLink(ownerLogin.agent, { provider: "google" }),
            ownerLogin.cookie,
        );

        // The provider claims the same subject with the thief's address.
        const thief = await passwordLogin("thief@example.com");
        idp.next = profile({ email: "thief@example.com", subject: "shared-sub" });
        const taken = await finish(await startLink(thief.agent, { provider: "google" }), thief.cookie);
        assert.match(String(taken.headers.location), /sso=taken/);
        assert.deepEqual(
            identities().map((row) => row.user_id),
            [owner.id],
        );
    });

    it("links once when two link attempts race", async () => {
        user("race@example.com");
        const { agent, cookie } = await passwordLogin("race@example.com");
        const first = await startLink(agent, { provider: "google" });
        const second = await startLink(agent, { provider: "google" });
        idp.next = profile({ email: "race@example.com", subject: "race-sub" });
        idp.delayMs = 20;

        const results = await Promise.all([finish(first, cookie), finish(second, cookie)]);

        for (const result of results) {
            assert.equal(result.status, 302);
            assert.doesNotMatch(String(result.headers.location), /sso=error/);
        }

        assert.equal(identities().length, 1);
    });

    it("accepts one callback when the same state arrives twice at once", async () => {
        const owner = user("replay@example.com");
        const { agent, cookie } = await passwordLogin("replay@example.com");
        idp.next = profile({ email: "replay@example.com", subject: "replay-sub" });
        await finish(await startLink(agent, { provider: "google" }), cookie);
        await agent.post("/api/auth/logout").expect(204);
        const before = sessionCount();

        const flow = await startLogin("google");
        idp.delayMs = 20;
        const [a, b] = await Promise.all([finish(flow), finish(flow)]);
        const sessions = [a, b]
            .map((result) => cookieValue(result.headers["set-cookie"], "fleet_session"))
            .filter(Boolean);

        assert.equal(sessions.length, 1);
        assert.equal(sessionCount(), before + 1);
        assert.equal(identities()[0]?.user_id, owner.id);
    });

    it("rejects an issuer that is not the configured one", async () => {
        const owner = user("issuer@example.com");
        const { agent, cookie } = await passwordLogin("issuer@example.com");
        idp.next = profile({ email: "issuer@example.com", subject: "iss-sub" });
        await finish(await startLink(agent, { provider: "google" }), cookie);
        assert.equal(identities()[0]?.user_id, owner.id);

        idp.next = profile({
            email: "issuer@example.com",
            subject: "iss-sub",
            issuer: "https://evil.example.com",
        });
        const forged = await finish(await startLogin("google"));
        assert.match(String(forged.headers.location), /sso=error/);
        assert.equal(cookieValue(forged.headers["set-cookie"], "fleet_session"), undefined);
    });

    it("rejects an answer without a subject", async () => {
        user("nosub@example.com");
        const { agent, cookie } = await passwordLogin("nosub@example.com");
        idp.next = profile({ email: "nosub@example.com", subject: "" });
        const done = await finish(await startLink(agent, { provider: "google" }), cookie);

        assert.match(String(done.headers.location), /sso=error/);
        assert.deepEqual(identities(), []);
    });

    it("lets the owner link an identity and then sign in with it", async () => {
        const owner = user("legit@example.com");
        const { agent, cookie } = await passwordLogin("legit@example.com");
        idp.next = profile({ email: "legit@example.com", subject: "legit-sub" });
        const linked = await finish(await startLink(agent, { provider: "google" }), cookie);

        assert.equal(linked.status, 302);
        assert.match(String(linked.headers.location), /\/konto\?sso=linked/);
        // Linking does not replace the owner's session.
        assert.equal(cookieValue(linked.headers["set-cookie"], "fleet_session"), undefined);
        assert.deepEqual(identities(), [
            { user_id: owner.id, provider: "google", issuer: GOOGLE, subject: "legit-sub" },
        ]);

        await agent.post("/api/auth/logout").expect(204);
        idp.next = profile({ email: "legit@example.com", subject: "legit-sub" });
        const done = await finish(await startLogin("google"));
        const session = cookieValue(done.headers["set-cookie"], "fleet_session");
        assert.ok(session);
        const me = await request(app).get("/api/auth/me").set("Cookie", session);
        assert.equal(me.body.email, "legit@example.com");
    });

    it("needs a session to start a link", async () => {
        const started = await request(app).post("/api/auth/sso/link").send({ provider: "google" });
        assert.equal(started.status, 401);
    });

    it("does not link an identity whose verified e-mail is another one", async () => {
        user("mine@example.com");
        const { agent, cookie } = await passwordLogin("mine@example.com");

        idp.next = profile({ email: "someone-else@example.com" });
        const other = await finish(await startLink(agent, { provider: "google" }), cookie);
        assert.match(String(other.headers.location), /sso=mismatch/);

        idp.next = profile({ email: "mine@example.com", emailVerified: false });
        const unverified = await finish(await startLink(agent, { provider: "google" }), cookie);
        assert.match(String(unverified.headers.location), /sso=mismatch/);
        assert.deepEqual(identities(), []);
    });

    it("issues no session when a link fails", async () => {
        user("fail@example.com");
        const { agent, cookie } = await passwordLogin("fail@example.com");
        const before = sessionCount();
        idp.next = new Error("idp down");
        const failed = await finish(await startLink(agent, { provider: "google" }), cookie);

        assert.match(String(failed.headers.location), /sso=error/);
        assert.equal(cookieValue(failed.headers["set-cookie"], "fleet_session"), undefined);
        assert.equal(sessionCount(), before);
        assert.deepEqual(identities(), []);
    });

    it("refuses a link whose browser session changed to another person", async () => {
        user("first@example.com");
        user("second@example.com");
        const first = await passwordLogin("first@example.com");
        const flow = await startLink(first.agent, { provider: "google" });
        const second = await passwordLogin("second@example.com");

        idp.next = profile({ email: "first@example.com", subject: "first-sub" });
        const done = await finish(flow, second.cookie);
        assert.match(String(done.headers.location), /sso=error/);
        assert.deepEqual(identities(), []);
    });

    it("does not accept a callback twice, even after it failed", async () => {
        const owner = user("once@example.com");
        const { agent, cookie } = await passwordLogin("once@example.com");
        idp.next = profile({ email: "once@example.com", subject: "once-sub" });
        await finish(await startLink(agent, { provider: "google" }), cookie);
        assert.equal(identities()[0]?.user_id, owner.id);

        const flow = await startLogin("google");
        const ok = await finish(flow);
        assert.ok(cookieValue(ok.headers["set-cookie"], "fleet_session"));
        const replay = await finish(flow);
        assert.match(String(replay.headers.location), /sso=error/);
        assert.equal(cookieValue(replay.headers["set-cookie"], "fleet_session"), undefined);

        const broken = await startLogin("google");
        idp.next = new Error("network");
        await finish(broken);
        idp.next = profile({ email: "once@example.com", subject: "once-sub" });
        const retry = await finish(broken);
        assert.match(String(retry.headers.location), /sso=error/);
        assert.equal(cookieValue(retry.headers["set-cookie"], "fleet_session"), undefined);
    });

    it("refuses a callback without the state cookie of the browser that started it", async () => {
        const flow = await startLogin("google");
        idp.next = profile({ email: "x@example.com" });
        const done = await request(app)
            .get(`/api/auth/sso/google/callback?code=abc&state=${encodeURIComponent(flow.state)}`)
            .redirects(0);
        assert.match(String(done.headers.location), /sso=error/);
    });
});
