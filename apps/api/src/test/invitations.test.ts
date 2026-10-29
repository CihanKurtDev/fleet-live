import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { ensureCompanyInvites } from "../db/migrate";
import { takeMails } from "../lib/mailer";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

const TEST_PASSWORD = "secret-password";

afterEach(() => {
    takeMails();
    UserModel.resetForTests();
});

function tokenFrom(link: string): string {
    const token = new URL(link).searchParams.get("token");
    assert.ok(token);
    return token;
}

function existingAccount(email: string, companyId: number) {
    return UserModel.create({
        name: "Bestehend",
        email,
        password: TEST_PASSWORD,
        company_id: companyId,
        role: "viewer",
    });
}

async function signIn(email: string) {
    const agent = request.agent(app);
    const login = await agent
        .post("/api/auth/login")
        .send({ email, password: TEST_PASSWORD });
    assert.equal(login.status, 200);
    return { agent, me: login.body };
}

let foreignCount = 0;

/** A company whose name sorts before every test company, with its own dispatcher. */
async function foreignCompany() {
    const { agent } = await loginAs(3);
    foreignCount += 1;
    const created = await agent
        .post("/api/auth/companies")
        .send({ name: `AAA Fremdfirma ${foreignCount}` })
        .expect(201);
    return { agent, companyId: created.body.company_id as number };
}

describe("an invitation to an existing account", () => {
    it("changes nothing until the person accepts", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();

        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "dispatcher" })
            .expect(201);
        const [mail] = takeMails();
        assert.ok(mail);
        assert.equal(mail.to, "person@example.com");
        assert.match(mail.link, /\/konto#firmen$/);

        // The login used to pick the alphabetically first company: the foreign one.
        const { me } = await signIn("person@example.com");
        assert.equal(me.company_id, 1);
        assert.deepEqual(
            me.memberships.map((row: { company_id: number }) => row.company_id),
            [1],
        );
        assert.equal(me.invitations, 1);
    });

    it("is gone after declining and cannot be accepted then", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();
        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" })
            .expect(201);

        const { agent } = await signIn("person@example.com");
        const declined = await agent
            .delete(`/api/auth/invitations/${foreign.companyId}`)
            .expect(200);
        assert.equal(declined.body.invitations, 0);
        assert.equal(declined.body.memberships.length, 1);

        await agent
            .post(`/api/auth/invitations/${foreign.companyId}/accept`)
            .expect(404);
        await agent.delete(`/api/auth/invitations/${foreign.companyId}`).expect(404);
    });

    it("lets the person switch to the company after accepting", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();
        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" })
            .expect(201);

        const { agent } = await signIn("person@example.com");
        await agent
            .post("/api/auth/company")
            .send({ company_id: foreign.companyId })
            .expect(404);
        await agent
            .post(`/api/auth/invitations/${foreign.companyId}/accept`)
            .expect(200);
        const switched = await agent
            .post("/api/auth/company")
            .send({ company_id: foreign.companyId })
            .expect(200);
        assert.equal(switched.body.company_id, foreign.companyId);
        assert.equal(switched.body.role, "viewer");
    });

    it("cannot be sent twice, nor to a member", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();
        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" })
            .expect(201);

        const again = await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "dispatcher" });
        assert.equal(again.status, 409);
        assert.equal(again.body.fields.email, "Diese Person ist schon eingeladen.");

        const { agent: own } = await loginAs(1);
        const member = await own
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" });
        assert.equal(member.status, 409);
        assert.equal(member.body.fields.email, "Diese Person ist schon in der Firma.");
    });

    it("asks for a signed-in person", async () => {
        await request(app).get("/api/auth/invitations").expect(401);
        await request(app).post("/api/auth/invitations/1/accept").expect(401);
        await request(app).delete("/api/auth/invitations/1").expect(401);
    });
});

describe("the company side of an invitation", () => {
    it("shows open invitations in the team and can take them back", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();
        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" })
            .expect(201);

        const team = await foreign.agent.get("/api/auth/members").expect(200);
        const invited = team.body.data.find(
            (row: { email: string }) => row.email === "person@example.com",
        );
        assert.equal(invited.invited, true);
        assert.equal(invited.role, "viewer");
        assert.ok(
            team.body.data.some(
                (row: { email: string; invited: boolean }) =>
                    row.email === "dispatcher-3@example.com" && row.invited === false,
            ),
        );

        const withdrawn = await foreign.agent
            .delete(`/api/auth/invites/${invited.user_id}`)
            .expect(200);
        assert.equal(
            withdrawn.body.data.some((row: { email: string }) => row.email === "person@example.com"),
            false,
        );
        const { me } = await signIn("person@example.com");
        assert.equal(me.invitations, 0);
    });

    it("turns the mail link of a withdrawn invitation into a dead link", async () => {
        const { agent } = await loginAs(1);
        await agent
            .post("/api/auth/invites")
            .send({ email: "neu@example.com", role: "viewer" })
            .expect(201);
        const [mail] = takeMails();
        assert.ok(mail);
        const invited = UserModel.findByEmail("neu@example.com");
        assert.ok(invited);

        await agent.delete(`/api/auth/invites/${invited.id}`).expect(200);

        const accept = await request(app)
            .post("/api/auth/invites/accept")
            .send({ token: tokenFrom(mail.link), name: "Neu", password: "invited-password" });
        assert.equal(accept.status, 400);
        const login = await request(app)
            .post("/api/auth/login")
            .send({ email: "neu@example.com", password: "invited-password" });
        assert.equal(login.status, 401);
    });

    it("makes the new account a member only through its link", async () => {
        const { agent } = await loginAs(1);
        await agent
            .post("/api/auth/invites")
            .send({ email: "neu@example.com", role: "viewer" })
            .expect(201);
        const [mail] = takeMails();
        assert.ok(mail);

        const before = await agent.get("/api/auth/members").expect(200);
        assert.equal(
            before.body.data.find((row: { email: string }) => row.email === "neu@example.com")
                .invited,
            true,
        );

        const accepted = await request(app)
            .post("/api/auth/invites/accept")
            .send({ token: tokenFrom(mail.link), name: "Neu", password: "invited-password" })
            .expect(200);
        assert.equal(accepted.body.company_id, 1);
        assert.equal(accepted.body.role, "viewer");

        const after = await agent.get("/api/auth/members").expect(200);
        const row = after.body.data.find((member: { email: string }) => member.email === "neu@example.com");
        assert.equal(row.invited, false);
        assert.equal(row.name, "Neu");
    });

    it("is not open to viewers or other companies", async () => {
        existingAccount("person@example.com", 1);
        const foreign = await foreignCompany();
        await foreign.agent
            .post("/api/auth/invites")
            .send({ email: "person@example.com", role: "viewer" })
            .expect(201);
        const person = UserModel.findByEmail("person@example.com");
        assert.ok(person);

        const { agent: viewer } = await loginAs(1, "viewer");
        await viewer.delete(`/api/auth/invites/${person.id}`).expect(403);
        const { agent: other } = await loginAs(2);
        await other.delete(`/api/auth/invites/${person.id}`).expect(404);

        const { me } = await signIn("person@example.com");
        assert.equal(me.invitations, 1);
    });
});

describe("invitations from before this change", () => {
    it("become open invitations again when nobody accepted them", () => {
        const result = db
            .prepare(
                "INSERT INTO users (name, email, password_hash, email_verified_at) VALUES ('Alt', 'alt@example.com', NULL, NULL)",
            )
            .run();
        const userId = Number(result.lastInsertRowid);
        db.prepare(
            "INSERT INTO company_memberships (user_id, company_id, role) VALUES (?, 2, 'viewer')",
        ).run(userId);

        ensureCompanyInvites(db);

        assert.equal(
            db.prepare("SELECT COUNT(*) AS n FROM company_memberships WHERE user_id = ?").get(userId)
                ?.n,
            0,
        );
        assert.deepEqual(
            { ...db.prepare("SELECT company_id, role FROM company_invites WHERE user_id = ?").get(userId) },
            { company_id: 2, role: "viewer" },
        );
    });
});
