import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { db } from "../db/database";
import { takeMails } from "../lib/mailer";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

afterEach(() => {
    takeMails();
    UserModel.resetForTests();
});

function roleIn(userId: number, companyId: number) {
    return (
        db
            .prepare("SELECT role FROM company_memberships WHERE user_id = ? AND company_id = ?")
            .get(userId, companyId) as { role: string } | undefined
    )?.role;
}

async function idOf(agent: ReturnType<typeof request.agent>) {
    return (await agent.get("/api/auth/me").expect(200)).body.id as number;
}

describe("members of another company", () => {
    it("cannot be changed or removed", async () => {
        const mine = await loginAs(1);
        const theirs = await loginAs(2, "viewer");
        const theirId = await idOf(theirs.agent);

        const patched = await mine.agent
            .patch(`/api/auth/members/${theirId}`)
            .send({ role: "dispatcher" });
        assert.equal(patched.status, 404);
        const removed = await mine.agent.delete(`/api/auth/members/${theirId}`);
        assert.equal(removed.status, 404);

        assert.equal(roleIn(theirId, 2), "viewer");
        await theirs.agent.get("/api/auth/me").expect(200);
    });

    it("are not listed", async () => {
        const mine = await loginAs(1);
        await loginAs(2);

        const members = await mine.agent.get("/api/auth/members").expect(200);
        assert.deepEqual(
            members.body.data.map((row: { email: string }) => row.email),
            ["dispatcher-1@example.com"],
        );
    });
});

describe("a viewer", () => {
    it("cannot raise their own role or manage the team", async () => {
        await loginAs(1);
        const viewer = await loginAs(1, "viewer");
        const viewerId = await idOf(viewer.agent);

        const raised = await viewer.agent
            .patch(`/api/auth/members/${viewerId}`)
            .send({ role: "dispatcher" });
        assert.equal(raised.status, 403);
        assert.equal(roleIn(viewerId, 1), "viewer");

        for (const call of [
            () => viewer.agent.get("/api/auth/members"),
            () => viewer.agent.post("/api/auth/invites").send({ email: "x@example.com", role: "dispatcher" }),
            () => viewer.agent.delete(`/api/auth/members/${viewerId}`),
            () => viewer.agent.get("/api/auth/security"),
            () => viewer.agent.patch("/api/auth/security").send({ totp_required: false }),
            () => viewer.agent.get("/api/export/vehicles"),
            () => viewer.agent.post("/api/import/preview").send({ csv: "a" }),
        ]) {
            assert.equal((await call()).status, 403);
        }
    });

    it("is a viewer again after switching into the company where they are one", async () => {
        const person = await loginAs(1);
        const personId = await idOf(person.agent);
        db.prepare(
            "INSERT INTO company_memberships (user_id, company_id, role) VALUES (?, 2, 'viewer')",
        ).run(personId);

        await person.agent.post("/api/auth/company").send({ company_id: 2 }).expect(200);
        const write = await person.agent.post("/api/drivers").send({ name: "Fremd" });
        assert.equal(write.status, 403);
    });
});

describe("the active company", () => {
    it("comes from the session, never from the body", async () => {
        const mine = await loginAs(1);

        const driver = await mine.agent
            .post("/api/drivers")
            .send({ name: "Eigener", company_id: 2 });
        assert.equal(driver.status, 201);
        const row = db.prepare("SELECT company_id FROM drivers WHERE id = ?").get(driver.body.data.id) as {
            company_id: number;
        };
        assert.equal(row.company_id, 1);

        takeMails();
        const invite = await mine.agent
            .post("/api/auth/invites")
            .send({ email: "neu@example.com", role: "viewer", company_id: 2 });
        assert.equal(invite.status, 201);
        const invited = UserModel.findByEmail("neu@example.com");
        assert.ok(invited);
        const invites = db
            .prepare("SELECT company_id, role FROM company_invites WHERE user_id = ?")
            .all(invited.id)
            .map((row) => ({ ...row }));
        assert.deepEqual(invites, [{ company_id: 1, role: "viewer" }]);
        assert.equal(roleIn(invited.id, 2), undefined);
    });

    it("cannot be switched to a company without membership", async () => {
        const mine = await loginAs(1);
        const switched = await mine.agent.post("/api/auth/company").send({ company_id: 2 });
        assert.equal(switched.status, 404);
        assert.equal((await mine.agent.get("/api/auth/me")).body.company_id, 1);
    });

    it("keeps at least one dispatcher", async () => {
        const mine = await loginAs(1);
        const myId = await idOf(mine.agent);

        const demoted = await mine.agent.patch(`/api/auth/members/${myId}`).send({ role: "viewer" });
        assert.equal(demoted.status, 403);
        const left = await mine.agent.delete(`/api/auth/members/${myId}`);
        assert.equal(left.status, 403);
        assert.equal(roleIn(myId, 1), "dispatcher");
    });
});

describe("the company login of another company", () => {
    it("cannot be linked by someone who is not a member", async () => {
        const mine = await loginAs(1);
        const started = await mine.agent
            .post("/api/auth/sso/link")
            .send({ provider: "company", company_id: 2 });
        assert.equal(started.status, 404);
    });

    it("keeps its secret out of every answer", async () => {
        const theirs = await loginAs(2);
        await theirs.agent
            .patch("/api/auth/security")
            .send({
                sso_issuer: "https://login.example.com",
                sso_client_id: "client",
                sso_client_secret: "very-secret",
            })
            .expect(200);
        const mine = await loginAs(1);

        const security = await mine.agent.get("/api/auth/security").expect(200);
        assert.equal(security.body.sso_issuer, null);
        assert.doesNotMatch(JSON.stringify(security.body), /very-secret/);
        const stored = db.prepare("SELECT sso_client_secret FROM companies WHERE id = 2").get() as {
            sso_client_secret: string;
        };
        assert.doesNotMatch(stored.sso_client_secret, /very-secret/);
    });
});
