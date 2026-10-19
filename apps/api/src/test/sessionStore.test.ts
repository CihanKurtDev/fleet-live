import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { hashToken } from "../lib/tokenHash";
import { SessionModel } from "../models/session.model";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

afterEach(() => {
    UserModel.resetForTests();
    SessionModel.resetForTests();
});

const cookieToken = (cookie: string) =>
    decodeURIComponent(cookie.split("=")[1] ?? "");

const rowFor = (token: string) =>
    db
        .prepare("SELECT token, expires_at, persistent FROM sessions WHERE token = ?")
        .get(hashToken(token)) as
        | { token: string; expires_at: string; persistent: number }
        | undefined;

describe("session tokens are stored hashed", () => {
    it("keeps the hash in the table, never the cookie value", async () => {
        const { cookie } = await loginAs(1);
        const token = cookieToken(cookie);

        assert.ok(token.length >= 32);
        assert.equal(
            db.prepare("SELECT 1 FROM sessions WHERE token = ?").get(token),
            undefined,
        );
        assert.ok(rowFor(token));
    });

    it("still recognises the session by its cookie", async () => {
        const { agent } = await loginAs(1);
        const me = await agent.get("/api/auth/me");

        assert.equal(me.status, 200);
        assert.ok(me.body.user ?? me.body.data ?? me.body);
    });

    it("deletes the row on logout", async () => {
        const { agent, cookie } = await loginAs(1);
        const token = cookieToken(cookie);

        assert.ok(rowFor(token));
        await agent.post("/api/auth/logout").expect(204);
        assert.equal(rowFor(token), undefined);
    });

    it("rejects a cookie that carries the stored hash", async () => {
        const { cookie } = await loginAs(1);
        const hash = hashToken(cookieToken(cookie));
        const response = await request(app)
            .get("/api/vehicles")
            .set("Cookie", `fleet_session=${hash}`);

        assert.equal(response.status, 401);
    });
});

describe("expired and idle sessions", () => {
    it("rejects an expired session even before the sweep ran", async () => {
        const { agent, cookie } = await loginAs(1);
        const token = cookieToken(cookie);

        // The sweep has just run, so it will not run again for a minute.
        SessionModel.purgeExpired();
        db.prepare(
            "UPDATE sessions SET expires_at = datetime('now', '-1 minutes') WHERE token = ?",
        ).run(hashToken(token));
        assert.ok(rowFor(token), "row is still there");

        const response = await agent.get("/api/vehicles");
        assert.equal(response.status, 401);
    });

    it("sweeps expired rows when it is due", async () => {
        const { cookie } = await loginAs(1);
        const token = cookieToken(cookie);

        db.prepare(
            "UPDATE sessions SET expires_at = datetime('now', '-1 minutes') WHERE token = ?",
        ).run(hashToken(token));
        SessionModel.purgeExpired();

        assert.equal(rowFor(token), undefined);
    });

    it("does not write the session on every request", async () => {
        const { agent, cookie } = await loginAs(1);
        const token = cookieToken(cookie);
        const before = rowFor(token)?.expires_at;

        await agent.get("/api/auth/me").expect(200);
        await agent.get("/api/auth/me").expect(200);

        assert.equal(rowFor(token)?.expires_at, before);
    });

    it("pushes an idle session out once it is more than a minute behind", async () => {
        const { agent, cookie } = await loginAs(1);
        const token = cookieToken(cookie);

        db.prepare(
            "UPDATE sessions SET expires_at = datetime('now', '+10 minutes') WHERE token = ?",
        ).run(hashToken(token));
        await agent.get("/api/auth/me").expect(200);

        const row = db
            .prepare(
                "SELECT expires_at > datetime('now', '+14 minutes') AS pushed FROM sessions WHERE token = ?",
            )
            .get(hashToken(token)) as { pushed: number };

        assert.equal(row.pushed, 1);
    });

    it("leaves a remembered session alone", async () => {
        UserModel.create({
            name: "Remember",
            email: "remember@example.com",
            password: "secret-password",
            company_id: 1,
            role: "dispatcher",
        });
        const agent = request.agent(app);
        const login = await agent
            .post("/api/auth/login")
            .send({
                email: "remember@example.com",
                password: "secret-password",
                remember: true,
            });
        assert.equal(login.status, 200);

        const raw = login.headers["set-cookie"];
        const header = String(Array.isArray(raw) ? raw[0] : raw);
        const token = cookieToken(header.split(";")[0]);
        const before = rowFor(token);

        assert.equal(before?.persistent, 1);
        await agent.get("/api/auth/me").expect(200);
        assert.equal(rowFor(token)?.expires_at, before?.expires_at);
    });
});
