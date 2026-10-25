import "./env";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { closeAllSseClients, connectedClientCount } from "../sse/hub";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

let server: Server;
let port: number;

before(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
});

after(() => {
    closeAllSseClients();
    server.close();
});

afterEach(() => {
    closeAllSseClients();
    UserModel.resetForTests();
});

/** An open `/api/stream`: its connection id and whether the server ended it. */
async function openStream(cookie: string) {
    const response = await fetch(`http://127.0.0.1:${port}/api/stream`, {
        headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let text = "";
    let ended = false;

    const pump = (async () => {
        for (;;) {
            const result = await reader.read().catch(() => ({ done: true, value: undefined }));

            if (result.done) {
                ended = true;
                return;
            }

            text += decoder.decode(result.value, { stream: true });
        }
    })();

    const deadline = Date.now() + 2000;

    while (!/event: connected/.test(text)) {
        assert.ok(Date.now() < deadline, "no connected event");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const connectionId = JSON.parse(/data: (\{.*connection_id.*\})/.exec(text)?.[1] ?? "{}")
        .connection_id as string;

    return {
        connectionId,
        /** Waits a little and says whether the server ended the stream. */
        async endedSoon(ms = 300) {
            await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, ms))]);
            return ended;
        },
        cancel: () => reader.cancel().catch(() => undefined),
    };
}

/** A second session of the same person (another browser). */
async function secondSession(email: string) {
    const agent = request.agent(app);
    const response = await agent
        .post("/api/auth/login")
        .send({ email, password: "secret-password" });
    assert.equal(response.status, 200);
    const raw = response.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    return { agent, cookie: String(header).split(";")[0] };
}

describe("an open stream belongs to its session", () => {
    it("ends at logout, and only that session's stream", async () => {
        const first = await loginAs(1);
        const second = await secondSession("dispatcher-1@example.com");
        const mine = await openStream(first.cookie);
        const other = await openStream(second.cookie);

        await first.agent.post("/api/auth/logout").expect(204);

        assert.equal(await mine.endedSoon(), true);
        assert.equal(await other.endedSoon(), false);
        await other.cancel();
    });

    it("ends for every session of the person at logout-all", async () => {
        const first = await loginAs(1);
        const second = await secondSession("dispatcher-1@example.com");
        const someoneElse = await loginAs(1, "viewer");
        const a = await openStream(first.cookie);
        const b = await openStream(second.cookie);
        const c = await openStream(someoneElse.cookie);

        await first.agent.post("/api/auth/logout-all").expect(204);

        assert.equal(await a.endedSoon(), true);
        assert.equal(await b.endedSoon(), true);
        assert.equal(await c.endedSoon(), false);
        await c.cancel();

        const again = await fetch(`http://127.0.0.1:${port}/api/stream`, {
            headers: { Cookie: second.cookie },
        });
        assert.equal(again.status, 401);
    });

    it("ends the other sessions' streams when the password changes", async () => {
        const first = await loginAs(1);
        const second = await secondSession("dispatcher-1@example.com");
        const kept = await openStream(first.cookie);
        const revoked = await openStream(second.cookie);

        await first.agent
            .post("/api/auth/password")
            .send({ current_password: "secret-password", password: "another-password-1" })
            .expect(204);

        assert.equal(await revoked.endedSoon(), true);
        assert.equal(await kept.endedSoon(), false);
        await kept.cancel();
    });

    it("ends when the membership is removed", async () => {
        const admin = await loginAs(1);
        const viewer = await loginAs(1, "viewer");
        const viewerId = (await viewer.agent.get("/api/auth/me")).body.id as number;
        const stream = await openStream(viewer.cookie);

        await admin.agent.delete(`/api/auth/members/${viewerId}`).expect(204);

        assert.equal(await stream.endedSoon(), true);
        await viewer.agent.get("/api/auth/me").expect(401);
    });

    it("ends when the role changes, and the session keeps working with the new role", async () => {
        const admin = await loginAs(1);
        const viewer = await loginAs(1, "viewer");
        const viewerId = (await viewer.agent.get("/api/auth/me")).body.id as number;
        const stream = await openStream(viewer.cookie);

        await admin.agent
            .patch(`/api/auth/members/${viewerId}`)
            .send({ role: "dispatcher" })
            .expect(200);

        assert.equal(await stream.endedSoon(), true);
        const me = await viewer.agent.get("/api/auth/me").expect(200);
        assert.equal(me.body.role, "dispatcher");
    });

    it("ends when the session switches company", async () => {
        const person = await loginAs(1);
        const me = await person.agent.get("/api/auth/me");
        db.prepare(
            "INSERT INTO company_memberships (user_id, company_id, role) VALUES (?, 2, 'viewer')",
        ).run(me.body.id);
        const stream = await openStream(person.cookie);
        const otherCompany = await loginAs(2);
        const theirs = await openStream(otherCompany.cookie);

        await person.agent.post("/api/auth/company").send({ company_id: 2 }).expect(200);

        assert.equal(await stream.endedSoon(), true);
        assert.equal(await theirs.endedSoon(), false);
        await theirs.cancel();
    });

    it("ends when the company starts to require a second factor", async () => {
        const admin = await loginAs(1);
        const stream = await openStream(admin.cookie);
        const elsewhere = await loginAs(2);
        const otherStream = await openStream(elsewhere.cookie);

        // Set like the dispatcher would, from a session with a factor.
        db.prepare("UPDATE sessions SET mfa = 1").run();
        await admin.agent.patch("/api/auth/security").send({ totp_required: true }).expect(200);

        assert.equal(await stream.endedSoon(), true);
        assert.equal(await otherStream.endedSoon(), false);
        await otherStream.cancel();
    });

    it("cannot be steered by another person of the same company", async () => {
        const owner = await loginAs(1);
        const colleague = await loginAs(1, "viewer");
        const stream = await openStream(owner.cookie);

        const hijack = await colleague.agent
            .post("/api/stream/focus")
            .send({ connection_id: stream.connectionId, ids: [1] });
        assert.equal(hijack.status, 400);

        const own = await owner.agent
            .post("/api/stream/focus")
            .send({ connection_id: stream.connectionId, ids: [] });
        assert.equal(own.status, 200);
        await stream.cancel();
    });

    it("refuses more open streams per person than browsers plausibly need", async () => {
        const person = await loginAs(1);
        const open = [];

        for (let index = 0; index < 20; index += 1) {
            open.push(await openStream(person.cookie));
        }

        const extra = await fetch(`http://127.0.0.1:${port}/api/stream`, {
            headers: { Cookie: person.cookie },
        });
        assert.equal(extra.status, 429);
        assert.equal(((await extra.json()) as { code: string }).code, "STREAM_LIMIT");

        // Someone else of the company is not affected.
        const colleague = await loginAs(1, "viewer");
        const theirs = await openStream(colleague.cookie);
        await theirs.cancel();
        await Promise.all(open.map((stream) => stream.cancel()));
    });

    it("leaves no client behind once ended", async () => {
        const person = await loginAs(1);
        await openStream(person.cookie);
        assert.equal(connectedClientCount(), 1);

        await person.agent.post("/api/auth/logout").expect(204);
        assert.equal(connectedClientCount(), 0);
    });
});

describe("saving the company security settings", () => {
    it("keeps the streams open when no rule becomes stricter", async () => {
        const admin = await loginAs(1);
        const stream = await openStream(admin.cookie);

        await admin.agent.patch("/api/auth/security").send({ totp_required: false }).expect(200);

        assert.equal(await stream.endedSoon(), false);
        await stream.cancel();
    });
});
