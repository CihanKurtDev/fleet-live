import "./env";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

const API_DIR = path.resolve(__dirname, "../..");

afterEach(() => {
    UserModel.resetForTests();
});

function runChild(file: string, env: Record<string, string | undefined>) {
    const base: Record<string, string | undefined> = { ...process.env };
    delete base.NODE_ENV;
    delete base.ALLOW_DEMO_ACCOUNTS;

    const result = spawnSync(`npx tsx src/test/${file}`, {
        cwd: API_DIR,
        env: { ...base, LOG_LEVEL: "silent", TELEMETRY_TICK_MS: "0", ...env },
        encoding: "utf8",
        shell: true,
    });

    return {
        status: result.status,
        output: `${result.stdout}\n${result.stderr}`,
    };
}

describe("import bodies are read after the sign-in", () => {
    // A body that cannot be parsed shows whether the parser ran: if it did,
    // the answer would be a parse error and not the sign-in or role answer.
    const broken = "{ not json";

    it("answers 401 to a request without a session", async () => {
        const response = await request(app)
            .post("/api/import/preview")
            .set("Content-Type", "application/json")
            .send(broken);

        assert.equal(response.status, 401);
    });

    it("answers 403 to a viewer", async () => {
        const { agent } = await loginAs(1, "viewer");
        const response = await agent
            .post("/api/import/preview")
            .set("Content-Type", "application/json")
            .send(broken);

        assert.equal(response.status, 403);
    });

    it("still reads a dispatcher's body", async () => {
        const { agent } = await loginAs(1);
        const response = await agent
            .post("/api/import/preview")
            .set("Content-Type", "application/json")
            .send(broken);

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "BAD_REQUEST");
    });

    it("answers 413, not 500, to a body over the general limit", async () => {
        const { agent } = await loginAs(1);
        const response = await agent
            .post("/api/vehicles")
            .set("Content-Type", "application/json")
            .send(JSON.stringify({ license_plate: "x".repeat(40_000) }));

        assert.equal(response.status, 413);
        assert.equal(response.body.code, "PAYLOAD_TOO_LARGE");
    });
});

describe("a broken session cookie", () => {
    it("is treated as signed out, not as a server error", async () => {
        const response = await request(app)
            .get("/api/auth/me")
            .set("Cookie", "fleet_session=%");

        assert.equal(response.status, 401);
    });
});

describe("the process environment", () => {
    it("refuses to start without NODE_ENV", () => {
        const result = runChild("configGuard.child.ts", {});

        assert.notEqual(result.status, 0);
        assert.match(result.output, /NODE_ENV/);
    });

    it("starts with NODE_ENV set", () => {
        const result = runChild("configGuard.child.ts", {
            NODE_ENV: "development",
        });

        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /config: ok/);
    });

    it("creates the demo accounts only when asked for", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "fleet-live-demo-"));

        try {
            const without = runChild("demoAccounts.child.ts", {
                NODE_ENV: "development",
                DATABASE_PATH: path.join(dir, "without.db"),
            });
            assert.equal(without.status, 0, without.output);
            assert.match(without.output, /demo-accounts: 0/);

            const asked = runChild("demoAccounts.child.ts", {
                NODE_ENV: "development",
                ALLOW_DEMO_ACCOUNTS: "true",
                DATABASE_PATH: path.join(dir, "asked.db"),
            });
            assert.equal(asked.status, 0, asked.output);
            assert.match(asked.output, /demo-accounts: 2/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
