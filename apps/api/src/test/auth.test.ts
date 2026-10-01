import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";

function setCookieHeader(response: request.Response): string {
    const header = response.headers["set-cookie"];
    return Array.isArray(header) ? header.join(";") : (header ?? "");
}

afterEach(() => {
    UserModel.resetForTests();
});

describe("POST /api/auth/login", () => {
    it("sets a session cookie and returns the user", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-password",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-password",
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.email, "test@example.com");
        assert.equal(response.body.company_id, 1);
        assert.equal(response.body.role, "dispatcher");
        assert.equal(response.body.password_hash, undefined);
        const cookie = setCookieHeader(response);
        assert.match(cookie, /fleet_session=/);
        assert.doesNotMatch(cookie, /Max-Age=/);
    });

    it("persists the cookie for seven days when remember is set", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-password",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-password",
            remember: true,
        });

        assert.equal(response.status, 200);
        assert.match(
            setCookieHeader(response),
            /Max-Age=604800/,
        );
    });

    it("rejects a wrong password without saying which field failed", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-password",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "wrong-password",
        });

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
        assert.equal(response.body.fields, undefined);
    });

    it("rejects invalid input with 400", async () => {
        const response = await request(app).post("/api/auth/login").send({
            email: "not-an-email",
            password: "",
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });
});

describe("GET /api/auth/me and logout", () => {
    it("requires a session and forgets it on logout", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-password",
            company_id: 1,
        });

        const agent = request.agent(app);

        const anonymous = await agent.get("/api/auth/me");
        assert.equal(anonymous.status, 401);

        const login = await agent.post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-password",
        });
        assert.equal(login.status, 200);

        const me = await agent.get("/api/auth/me");
        assert.equal(me.status, 200);
        assert.equal(me.body.email, "test@example.com");

        const logout = await agent.post("/api/auth/logout");
        assert.equal(logout.status, 204);

        const after = await agent.get("/api/auth/me");
        assert.equal(after.status, 401);
    });

    it("invalidates every user session on logout-all", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-password",
            company_id: 1,
        });
        const first = request.agent(app);
        const second = request.agent(app);
        const credentials = {
            email: "test@example.com",
            password: "secret-password",
        };

        await first.post("/api/auth/login").send(credentials).expect(200);
        await second.post("/api/auth/login").send(credentials).expect(200);
        await first.post("/api/auth/logout-all").expect(204);

        await first.get("/api/auth/me").expect(401);
        await second.get("/api/auth/me").expect(401);
    });
});
