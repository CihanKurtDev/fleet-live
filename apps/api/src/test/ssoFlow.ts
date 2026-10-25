import "./env";
/** The mocked identity provider and the steps of an OIDC login, for the SSO tests. */
import assert from "node:assert/strict";
import { afterEach, beforeEach } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { setOidcDriverForTests, type OidcProfile } from "../lib/oidc";
import { seal } from "../lib/secretBox";
import { UserModel } from "../models/user.model";

export const PASSWORD = "sso-link-password";
export const GOOGLE = "https://accounts.google.com";
export const IDP_A = "https://idp-a.example.com";
export const IDP_B = "https://idp-b.example.com";

/** What the mocked identity provider answers on the next callback. */
export const idp: { next: OidcProfile | Error; delayMs: number } = {
    next: new Error("no profile set"),
    delayMs: 0,
};

beforeEach(() => {
    idp.delayMs = 0;
    setOidcDriverForTests({
        async authorizationUrl(input) {
            return `https://idp.example/auth?state=${encodeURIComponent(input.state)}`;
        },
        async callback() {
            if (idp.delayMs) {
                await new Promise((resolve) => setTimeout(resolve, idp.delayMs));
            }

            if (idp.next instanceof Error) {
                throw idp.next;
            }

            return idp.next;
        },
    });
});

afterEach(() => {
    setOidcDriverForTests(null);
    UserModel.resetForTests();
});

export function profile(input: Partial<OidcProfile> & { email: string }): OidcProfile {
    return {
        issuer: GOOGLE,
        subject: `sub-${input.email}`,
        emailVerified: true,
        name: input.email,
        ...input,
    };
}

export function user(email: string, companyId = 1, role: "dispatcher" | "viewer" = "dispatcher") {
    return UserModel.create({
        name: email,
        email,
        password: PASSWORD,
        company_id: companyId,
        role,
    });
}

export function addMembership(userId: number, companyId: number, role: "dispatcher" | "viewer") {
    db.prepare(
        "INSERT INTO company_memberships (user_id, company_id, role) VALUES (?, ?, ?)",
    ).run(userId, companyId, role);
}

export function configureCompanyIdp(companyId: number, issuer: string, required = false) {
    db.prepare(
        `UPDATE companies
         SET sso_issuer = ?, sso_client_id = 'client', sso_client_secret = ?, sso_required = ?
         WHERE id = ?`,
    ).run(issuer, seal("client-secret"), required ? 1 : 0, companyId);
}

export function identities() {
    const rows = db
        .prepare("SELECT user_id, provider, issuer, subject FROM sso_identities ORDER BY id")
        .all() as { user_id: number; provider: string; issuer: string; subject: string }[];

    return rows.map((row) => ({ ...row }));
}

export function sessionCount() {
    return (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
}

export function stateFrom(location: string) {
    const state = new URL(location).searchParams.get("state");
    assert.ok(state);
    return state;
}

export function cookieValue(raw: string | string[] | undefined, name: string) {
    const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const found = all.find((value) => value.startsWith(`${name}=`));
    return found?.split(";")[0];
}

/** Starts a login at the public provider or a company's own login. */
export async function startLogin(provider: "google" | "company", companyId = 1) {
    const path =
        provider === "company"
            ? `/api/auth/sso/company/start?company_id=${companyId}`
            : "/api/auth/sso/google/start";
    const start = await request(app).get(path).redirects(0);
    assert.equal(start.status, 302);
    const sso = cookieValue(start.headers["set-cookie"], "fleet_sso");
    assert.ok(sso, "the start sets the state cookie");

    return { state: stateFrom(String(start.headers.location)), cookie: sso, provider };
}

export async function finish(flow: { state: string; cookie: string; provider: string }, extraCookie?: string) {
    const path =
        flow.provider === "company"
            ? "/api/auth/sso/company/callback"
            : `/api/auth/sso/${flow.provider}/callback`;

    return request(app)
        .get(`${path}?code=abc&state=${encodeURIComponent(flow.state)}`)
        .set("Cookie", [flow.cookie, ...(extraCookie ? [extraCookie] : [])].join("; "))
        .redirects(0);
}

export async function passwordLogin(email: string) {
    const agent = request.agent(app);
    const response = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
    return { agent, response, cookie: cookieValue(response.headers["set-cookie"], "fleet_session") };
}

/** Starts an explicit link as the signed-in owner. */
export async function startLink(
    agent: ReturnType<typeof request.agent>,
    body: { provider: "google" | "company"; company_id?: number },
) {
    const started = await agent.post("/api/auth/sso/link").send(body);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const sso = cookieValue(started.headers["set-cookie"], "fleet_sso");
    assert.ok(sso);

    return { state: stateFrom(started.body.url), cookie: sso, provider: body.provider };
}
