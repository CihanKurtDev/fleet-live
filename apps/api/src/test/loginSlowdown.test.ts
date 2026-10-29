import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { setLoginClockForTests } from "../lib/loginAttempts";
import { UserModel } from "../models/user.model";

const PASSWORD = "secret-password";

afterEach(() => {
    UserModel.resetForTests();
});

let now = 1_000_000;

function login(email: string, password: string) {
    return request(app).post("/api/auth/login").send({ email, password });
}

async function failTimes(email: string, times: number) {
    for (let index = 0; index < times; index += 1) {
        const response = await login(email, "wrong-password-123");
        assert.equal(response.status, 401);
    }
}

describe("wrong passwords", () => {
    it("cost nothing for the first five tries", async () => {
        setLoginClockForTests(() => now);
        UserModel.create({ name: "Person", email: "person@example.com", password: PASSWORD, company_id: 1 });

        await failTimes("person@example.com", 5);
        await login("person@example.com", PASSWORD).expect(200);
    });

    it("make the next try wait, then let the right password in", async () => {
        setLoginClockForTests(() => now);
        UserModel.create({ name: "Person", email: "person@example.com", password: PASSWORD, company_id: 1 });

        await failTimes("person@example.com", 6);
        const waiting = await login("Person@Example.com", PASSWORD);
        assert.equal(waiting.status, 429);
        assert.equal(waiting.body.code, "LOGIN_SLOW_DOWN");
        assert.equal(waiting.headers["retry-after"], "2");
        assert.equal(waiting.body.details.retry_after, 2);

        now += 2_000;
        await login("person@example.com", PASSWORD).expect(200);
        // A right password starts over: five free tries again.
        await failTimes("person@example.com", 5);
        await login("person@example.com", PASSWORD).expect(200);
    });

    it("double the wait with every further wrong try, up to a minute", async () => {
        setLoginClockForTests(() => now);
        const waits: string[] = [];

        await failTimes("raten@example.com", 5);
        for (let index = 0; index < 8; index += 1) {
            await login("raten@example.com", "wrong-password-123").expect(401);
            const blocked = await login("raten@example.com", "wrong-password-123");
            waits.push(blocked.headers["retry-after"] as string);
            now += Number(blocked.headers["retry-after"]) * 1000;
        }

        assert.deepEqual(waits, ["2", "4", "8", "16", "32", "60", "60", "60"]);
    });

    it("are forgotten after a quarter of an hour", async () => {
        setLoginClockForTests(() => now);
        UserModel.create({ name: "Person", email: "person@example.com", password: PASSWORD, company_id: 1 });

        await failTimes("person@example.com", 5);
        now += 15 * 60 * 1000;
        await failTimes("person@example.com", 5);
        await login("person@example.com", PASSWORD).expect(200);
    });

    it("slow down an address without an account the same way", async () => {
        setLoginClockForTests(() => now);

        await failTimes("niemand@example.com", 6);
        const waiting = await login("niemand@example.com", "wrong-password-123");
        assert.equal(waiting.status, 429);
        assert.equal(waiting.body.code, "LOGIN_SLOW_DOWN");
    });
});
