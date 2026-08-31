import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";

afterEach(() => {
    UserModel.resetForTests();
});

describe("POST /api/auth/login", () => {
    it("sets a session cookie and returns the user", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-pass",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-pass",
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.email, "test@example.com");
        assert.equal(response.body.company_id, 1);
        assert.equal(response.body.role, "dispatcher");
        assert.equal(response.body.password_hash, undefined);
        const cookie = response.headers["set-cookie"]?.join(";") ?? "";
        assert.match(cookie, /fleet_session=/);
        assert.doesNotMatch(cookie, /Max-Age=/);
    });

    it("persists the cookie for seven days when remember is set", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-pass",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-pass",
            remember: true,
        });

        assert.equal(response.status, 200);
        assert.match(
            response.headers["set-cookie"]?.join(";") ?? "",
            /Max-Age=604800/,
        );
    });

    it("rejects a wrong password without saying which field failed", async () => {
        UserModel.create({
            name: "Test User",
            email: "test@example.com",
            password: "secret-pass",
            company_id: 1,
        });

        const response = await request(app).post("/api/auth/login").send({
            email: "test@example.com",
            password: "wrong",
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
            password: "secret-pass",
            company_id: 1,
        });

        const agent = request.agent(app);

        const anonymous = await agent.get("/api/auth/me");
        assert.equal(anonymous.status, 401);

        const login = await agent.post("/api/auth/login").send({
            email: "test@example.com",
            password: "secret-pass",
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
});
