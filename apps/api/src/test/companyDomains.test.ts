import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { setTxtLookupForTests } from "../lib/dnsTxt";
import { seal } from "../lib/secretBox";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

afterEach(() => {
    setTxtLookupForTests(null);
    UserModel.resetForTests();
});

type Agent = ReturnType<typeof request.agent>;

/** DNS that answers with these TXT values for every name it is asked. */
function dnsAnswers(values: Record<string, string[]>) {
    setTxtLookupForTests(async (name) => (values[name] ?? []).map((value) => [value]));
}

function companyLogin(companyId: number) {
    db.prepare(
        "UPDATE companies SET sso_issuer = ?, sso_client_id = ?, sso_client_secret = ? WHERE id = ?",
    ).run("https://idp.example.com", "client", seal("secret-value"), companyId);
}

async function addDomain(agent: Agent, domain: string) {
    const added = await agent.post("/api/auth/domains").send({ domain }).expect(201);
    return added.body.data as { id: number; record_name: string; record_value: string };
}

function discover(email: string) {
    return request(app).post("/api/auth/sso/company/discover").send({ email });
}

describe("a company domain", () => {
    it("is confirmed by its TXT record and then leads to the company login", async () => {
        const { agent } = await loginAs(1);
        companyLogin(1);
        const domain = await addDomain(agent, "Rheinland.Example");
        assert.equal(domain.record_name, "_fleet-live.rheinland.example");
        assert.match(domain.record_value, /^fleet-live-verification=[0-9a-f]{32}$/);

        // Not confirmed yet: the sign-in page finds nothing.
        await discover("jemand@rheinland.example").expect(400);
        dnsAnswers({});
        const early = await agent.post(`/api/auth/domains/${domain.id}/verify`);
        assert.equal(early.status, 400);
        assert.match(early.body.error, /finden wir noch nicht/);

        dnsAnswers({ [domain.record_name]: ["v=spf1 -all", domain.record_value] });
        const verified = await agent.post(`/api/auth/domains/${domain.id}/verify`).expect(200);
        assert.ok(verified.body.data[0].verified_at);

        // Any address at the domain finds it, with or without an account.
        assert.equal((await discover("niemand@rheinland.example").expect(200)).body.company_id, 1);
        await discover("jemand@andere.example").expect(400);

        const audit = await agent.get("/api/auth/audit").expect(200);
        assert.deepEqual(
            audit.body.data.map((row: { action: string }) => row.action),
            ["domain_verified", "domain_added"],
        );
    });

    it("no longer reveals the company of a member without one", async () => {
        const { agent } = await loginAs(1);
        companyLogin(1);
        // The member's address used to be enough.
        await discover("dispatcher-1@example.com").expect(400);
        await agent.get("/api/auth/domains").expect(200);
    });

    it("needs a company login to lead anywhere", async () => {
        const { agent } = await loginAs(1);
        const domain = await addDomain(agent, "ohne-login.example");
        dnsAnswers({ [domain.record_name]: [domain.record_value] });
        await agent.post(`/api/auth/domains/${domain.id}/verify`).expect(200);

        await discover("a@ohne-login.example").expect(400);
    });

    it("can be proven by one company only", async () => {
        const { agent: first } = await loginAs(1);
        const { agent: second } = await loginAs(2);
        const mine = await addDomain(first, "geteilt.example");
        const theirs = await addDomain(second, "geteilt.example");
        dnsAnswers({ "_fleet-live.geteilt.example": [mine.record_value, theirs.record_value] });

        await first.post(`/api/auth/domains/${mine.id}/verify`).expect(200);
        const late = await second.post(`/api/auth/domains/${theirs.id}/verify`);
        assert.equal(late.status, 409);
        const again = await second.post("/api/auth/domains").send({ domain: "geteilt.example" });
        assert.equal(again.status, 409);
        assert.equal(again.body.fields.domain, "Diese Domain hat schon eine andere Firma bestätigt.");
    });

    it("stops leading to the login once removed", async () => {
        const { agent } = await loginAs(1);
        companyLogin(1);
        const domain = await addDomain(agent, "weg.example");
        dnsAnswers({ [domain.record_name]: [domain.record_value] });
        await agent.post(`/api/auth/domains/${domain.id}/verify`).expect(200);
        await discover("a@weg.example").expect(200);

        const removed = await agent.delete(`/api/auth/domains/${domain.id}`).expect(200);
        assert.deepEqual(removed.body.data, []);
        await discover("a@weg.example").expect(400);
        await agent.delete(`/api/auth/domains/${domain.id}`).expect(404);
    });

    it("says when DNS does not answer", async () => {
        const { agent } = await loginAs(1);
        const domain = await addDomain(agent, "langsam.example");
        setTxtLookupForTests(async () => {
            throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
        });

        const failed = await agent.post(`/api/auth/domains/${domain.id}/verify`);
        assert.equal(failed.status, 503);
        assert.equal(failed.body.code, "DNS_UNAVAILABLE");
    });

    it("takes only a plain domain and stays in its company", async () => {
        const { agent } = await loginAs(1);
        const bad = await agent.post("/api/auth/domains").send({ domain: "https://firma.de" });
        assert.equal(bad.status, 400);
        await agent.post("/api/auth/domains").send({ domain: "name@firma.de" }).expect(400);
        const domain = await addDomain(agent, "firma.example");
        await agent.post("/api/auth/domains").send({ domain: "firma.example" }).expect(409);

        const { agent: other } = await loginAs(2);
        await other.post(`/api/auth/domains/${domain.id}/verify`).expect(404);
        await other.delete(`/api/auth/domains/${domain.id}`).expect(404);
        const { agent: viewer } = await loginAs(1, "viewer");
        await viewer.get("/api/auth/domains").expect(403);
        await request(app).get("/api/auth/domains").expect(401);
    });
});
