import "./env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import {
    hashPassword,
    hashPasswordAsync,
    needsRehash,
    spendPasswordTime,
    verifyPassword,
    verifyPasswordAsync,
} from "../lib/password";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

const API_DIR = path.resolve(__dirname, "../..");

afterEach(() => {
    UserModel.resetForTests();
});

describe("password hashes", () => {
    it("verifies the same way sync and async", async () => {
        const stored = await hashPasswordAsync("correct horse");

        assert.ok(verifyPassword("correct horse", stored));
        assert.ok(await verifyPasswordAsync("correct horse", stored));
        assert.equal(await verifyPasswordAsync("wrong", stored), false);
        assert.equal(verifyPassword("wrong", stored), false);
    });

    it("keeps verifying a hash made with a lower cost", async () => {
        const old = hashPassword("correct horse", 512);

        assert.ok(old.startsWith("scrypt$512$"));
        assert.ok(await verifyPasswordAsync("correct horse", old));
    });

    it("asks for a new hash when the cost is lower, the value is plain or broken", () => {
        assert.equal(needsRehash(hashPassword("x")), false);
        assert.equal(needsRehash(hashPassword("x", 512)), true);
        assert.equal(needsRehash("plain-text-from-before"), true);
        assert.equal(needsRehash("scrypt$not$a$hash"), true);
    });

    it("still accepts a plain value from before hashing, and nothing broken", async () => {
        assert.ok(await verifyPasswordAsync("old", "old"));
        assert.equal(await verifyPasswordAsync("old", "other"), false);
        assert.equal(await verifyPasswordAsync("x", "scrypt$1$2"), false);
    });

    it("spends time for an unknown email without failing", async () => {
        await spendPasswordTime("anything");
    });

    it("uses the production cost outside of tests", () => {
        const base: Record<string, string | undefined> = { ...process.env };
        const result = spawnSync("npx tsx src/test/passwordCost.child.ts", {
            cwd: API_DIR,
            env: {
                ...base,
                NODE_ENV: "development",
                DATABASE_PATH: ":memory:",
                LOG_LEVEL: "silent",
            },
            encoding: "utf8",
            shell: true,
        });
        const output = `${result.stdout}\n${result.stderr}`;

        assert.equal(result.status, 0, output);
        assert.match(output, /prefix: scrypt\$65536/);
        assert.match(output, /rehash-own: false/);
    });
});

describe("sign-in with the new hashing", () => {
    it("replaces a weaker hash after a correct sign-in", async () => {
        const { agent } = await loginAs(1);
        const user = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(user);

        UserModel.setPasswordHash(user.id, hashPassword("secret-password", 512));
        await agent.post("/api/auth/logout");

        const response = await request(app)
            .post("/api/auth/login")
            .send({ email: "dispatcher-1@example.com", password: "secret-password" });

        assert.equal(response.status, 200);

        const after = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(after?.password_hash);
        assert.equal(needsRehash(after.password_hash), false);
        assert.ok(after.password_hash.startsWith("scrypt$1024$"));
    });

    it("leaves a weaker hash alone after a wrong password", async () => {
        await loginAs(1);
        const user = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(user);

        const weak = hashPassword("secret-password", 512);
        UserModel.setPasswordHash(user.id, weak);

        const response = await request(app)
            .post("/api/auth/login")
            .send({ email: "dispatcher-1@example.com", password: "wrong-password" });

        assert.equal(response.status, 401);
        assert.equal(
            UserModel.findByEmail("dispatcher-1@example.com")?.password_hash,
            weak,
        );
    });

    it("answers an unknown email like a wrong password", async () => {
        const unknown = await request(app)
            .post("/api/auth/login")
            .send({ email: "nobody@example.com", password: "secret-password" });
        const wrong = await request(app)
            .post("/api/auth/login")
            .send({ email: "dispatcher-1@example.com", password: "wrong-password" });

        assert.equal(unknown.status, 401);
        assert.equal(unknown.status, wrong.status);
        assert.deepEqual(unknown.body, wrong.body);
    });
});

describe("changing the password", () => {
    it("keeps this session, ends the others and stores a current hash", async () => {
        const { agent } = await loginAs(1);
        const other = await request
            .agent(app)
            .post("/api/auth/login")
            .send({ email: "dispatcher-1@example.com", password: "secret-password" });
        const otherCookie = String(other.headers["set-cookie"]?.[0]).split(";")[0];

        const response = await agent.post("/api/auth/password").send({
            current_password: "secret-password",
            password: "a-new-password-1",
        });

        assert.equal(response.status, 204);
        await agent.get("/api/auth/me").expect(200);
        await request(app)
            .get("/api/vehicles")
            .set("Cookie", otherCookie)
            .expect(401);

        const user = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(user?.password_hash);
        assert.equal(needsRehash(user.password_hash), false);
        assert.ok(await verifyPasswordAsync("a-new-password-1", user.password_hash));

        UserModel.setPasswordHash(user.id, hashPassword("secret-password"));
    });

    it("refuses a wrong current password", async () => {
        const { agent } = await loginAs(1);
        const response = await agent.post("/api/auth/password").send({
            current_password: "not-it",
            password: "a-new-password-1",
        });

        assert.equal(response.status, 400);
        assert.ok(response.body.fields?.current_password);
    });
});
