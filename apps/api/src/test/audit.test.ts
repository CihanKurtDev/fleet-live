import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { formatAuditEvent, type AuditEvent } from "@fleet-live/shared";
import { app } from "../app";
import { db } from "../db/database";
import { takeMails } from "../lib/mailer";
import { AuditModel } from "../models/audit.model";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

const PASSWORD = "secret-password";

afterEach(() => {
    takeMails();
    UserModel.resetForTests();
});

function account(email: string, name: string, companyId: number, role: "dispatcher" | "viewer" = "viewer") {
    return UserModel.create({ name, email, password: PASSWORD, company_id: companyId, role });
}

async function audit(agent: ReturnType<typeof request.agent>) {
    const response = await agent.get("/api/auth/audit").expect(200);
    return response.body as { data: AuditEvent[]; meta: { total: number; page: number; pageCount: number } };
}

describe("the company log", () => {
    it("tells invitations, role changes and removals, newest first", async () => {
        const { agent } = await loginAs(1);
        const member = account("mitglied@example.com", "Mitglied", 1);

        await agent
            .post("/api/auth/invites")
            .send({ email: "neu@example.com", role: "viewer" })
            .expect(201);
        const invited = UserModel.findByEmail("neu@example.com");
        assert.ok(invited);
        await agent.delete(`/api/auth/invites/${invited.id}`).expect(200);
        await agent
            .patch(`/api/auth/members/${member.id}`)
            .send({ role: "dispatcher" })
            .expect(200);
        // Saving the same role again changes nothing and writes nothing.
        await agent
            .patch(`/api/auth/members/${member.id}`)
            .send({ role: "dispatcher" })
            .expect(200);
        await agent.delete(`/api/auth/members/${member.id}`).expect(204);

        const { data, meta } = await audit(agent);
        assert.equal(meta.total, 4);
        assert.deepEqual(
            data.map((row) => formatAuditEvent(row)),
            [
                "Mitglied (mitglied@example.com) entfernt",
                "Rolle von Mitglied (mitglied@example.com): Nur lesen → Dispatcher",
                "Einladung an neu@example.com zurückgezogen",
                "neu@example.com als Nur lesen eingeladen",
            ],
        );
        assert.ok(data.every((row) => row.actor_name === "dispatcher 1"));
    });

    it("keeps an accepted or declined invitation in the inviting company", async () => {
        account("person@example.com", "Person", 2);
        const { agent } = await loginAs(1);
        await agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "dispatcher" })
            .expect(201);

        const person = request.agent(app);
        await person
            .post("/api/auth/login")
            .send({ email: "person@example.com", password: PASSWORD })
            .expect(200);
        await person.post("/api/auth/invitations/1/accept").expect(200);

        const { data } = await audit(agent);
        assert.equal(data[0]?.action, "invite_accepted");
        assert.equal(data[0]?.actor_name, "Person");
        assert.equal(formatAuditEvent(data[0] as AuditEvent), "Einladung angenommen, Rolle Dispatcher");

        // Company 2 is where the person came from; nothing of company 1 shows there.
        const { agent: theirs } = await loginAs(2);
        assert.equal((await audit(theirs)).meta.total, 0);
    });

    it("keeps the names of an account that is gone", async () => {
        const { agent } = await loginAs(1);
        await agent
            .post("/api/auth/invites")
            .send({ email: "weg@example.com", role: "viewer" })
            .expect(201);
        db.prepare("DELETE FROM users WHERE email = ?").run("weg@example.com");

        const [row] = (await audit(agent)).data;
        assert.equal(row?.target_email, "weg@example.com");
        assert.equal(formatAuditEvent(row as AuditEvent), "weg@example.com als Nur lesen eingeladen");
    });

    it("pages through a long log", async () => {
        const { agent } = await loginAs(1);
        const actor = UserModel.findByEmail("dispatcher-1@example.com");
        assert.ok(actor);

        for (let index = 0; index < 51; index += 1) {
            AuditModel.record({ companyId: 1, action: "company_created", actorId: actor.id });
        }

        const first = await audit(agent);
        assert.equal(first.data.length, 50);
        assert.equal(first.meta.pageCount, 2);
        const second = await agent.get("/api/auth/audit?page=2").expect(200);
        assert.equal(second.body.data.length, 1);
        await agent.get("/api/auth/audit?page=0").expect(400);
    });

    it("is for dispatchers of the company only", async () => {
        await request(app).get("/api/auth/audit").expect(401);
        const { agent: viewer } = await loginAs(1, "viewer");
        await viewer.get("/api/auth/audit").expect(403);
    });

    it("starts with the company a person creates", async () => {
        const { agent } = await loginAs(1);
        const created = await agent
            .post("/api/auth/companies")
            .send({ name: "Protokoll Test GmbH" })
            .expect(201);
        assert.ok(created.body.company_id);

        const { data } = await audit(agent);
        assert.deepEqual(
            data.map((row) => row.action),
            ["company_created"],
        );
    });
});
