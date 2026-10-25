import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { seal } from "../lib/secretBox";
import {
    base32Decode,
    base32Encode,
    randomTotpSecret,
    totpCode,
} from "../lib/totp";
import { replaceRecoveryCodes } from "../models/account.model";
import { UserModel } from "../models/user.model";

const EMAIL = "second-factor@example.com";
const PASSWORD = "second-factor-password";
const STEP_MS = 30_000;

afterEach(() => {
    UserModel.resetForTests();
});

/** An account that has a second factor; returns its authenticator secret. */
function accountWithTotp() {
    const secret = base32Encode(randomTotpSecret());
    const user = UserModel.create({
        name: "Zwei Faktor",
        email: EMAIL,
        password: PASSWORD,
        company_id: 1,
        role: "dispatcher",
    });
    UserModel.setTotp(user.id, seal(secret), true);

    return { user, secret };
}

async function loginStep() {
    const response = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: PASSWORD });

    assert.equal(response.status, 200);
    return response.body as { step: string; challenge: string };
}

const confirm = (challenge: string, code: string) =>
    request(app).post("/api/auth/totp").send({ challenge, code });

describe("a login step for an existing second factor", () => {
    it("cannot be used to choose a new secret", async () => {
        const { user, secret } = accountWithTotp();
        const before = UserModel.getById(user.id)?.totp_secret;
        const step = await loginStep();
        assert.equal(step.step, "totp");

        const setup = await request(app)
            .post("/api/auth/totp/setup")
            .send({ challenge: step.challenge });
        assert.equal(setup.status, 403);
        assert.equal(setup.body.secret, undefined);

        // Even a code made from a secret the caller picked is not enough.
        const own = base32Encode(randomTotpSecret());
        const forged = await confirm(step.challenge, totpCode(base32Decode(own)));
        assert.equal(forged.status, 401);
        assert.equal(forged.headers["set-cookie"], undefined);
        assert.equal(UserModel.getById(user.id)?.totp_secret, before);

        // The real authenticator still works with the same step.
        const done = await confirm(step.challenge, totpCode(base32Decode(secret)));
        assert.equal(done.status, 200);
    });

    it("still lets an account without a factor set one up when the company requires it", async () => {
        const user = UserModel.create({
            name: "Neu",
            email: EMAIL,
            password: PASSWORD,
            company_id: 1,
            role: "dispatcher",
        });
        db.prepare("UPDATE companies SET totp_required = 1 WHERE id = 1").run();

        const step = await loginStep();
        assert.equal(step.step, "totp_enroll");

        const setup = await request(app)
            .post("/api/auth/totp/setup")
            .send({ challenge: step.challenge });
        assert.equal(setup.status, 200);

        const done = await confirm(
            step.challenge,
            totpCode(base32Decode(setup.body.secret as string)),
        );
        assert.equal(done.status, 200);
        assert.equal(done.body.recovery_codes.length, 8);
        assert.equal(UserModel.getById(user.id)?.totp_enabled, 1);
    });
});

describe("wrong codes", () => {
    it("use up a login step after five tries, even for the right code", async () => {
        const { secret } = accountWithTotp();
        const step = await loginStep();

        for (let attempt = 0; attempt < 4; attempt += 1) {
            const wrong = await confirm(step.challenge, "000000");
            assert.equal(wrong.status, 401);
        }

        const last = await confirm(step.challenge, "000000");
        assert.equal(last.status, 401);
        assert.match(last.body.error, /Melde dich neu an/);

        const right = await confirm(step.challenge, totpCode(base32Decode(secret)));
        assert.equal(right.status, 401);
        assert.equal(right.headers["set-cookie"], undefined);
    });

    it("lock the account across fresh login steps", async () => {
        const { secret } = accountWithTotp();

        // Four wrong codes per step, three steps: ten failures lock the account.
        for (let round = 0; round < 3; round += 1) {
            const step = await loginStep();

            for (let attempt = 0; attempt < 4; attempt += 1) {
                await confirm(step.challenge, "000000");
            }
        }

        const step = await loginStep();
        const locked = await confirm(step.challenge, totpCode(base32Decode(secret)));
        assert.equal(locked.status, 429);
        assert.equal(locked.body.code, "TOTP_RATE_LIMITED");
        assert.equal(locked.headers["set-cookie"], undefined);
    });
});

describe("a code counts once", () => {
    it("is refused a second time in the same time step", async () => {
        const { secret } = accountWithTotp();
        const code = totpCode(base32Decode(secret));

        const first = await loginStep();
        const done = await confirm(first.challenge, code);
        assert.equal(done.status, 200);

        const second = await loginStep();
        const replay = await confirm(second.challenge, code);
        assert.equal(replay.status, 401);

        // The next step's code is a new code.
        const next = await confirm(
            second.challenge,
            totpCode(base32Decode(secret), Date.now() + STEP_MS),
        );
        assert.equal(next.status, 200);
    });
});

describe("a recovery code", () => {
    it("counts once and leaves the second factor in place", async () => {
        const { user } = accountWithTotp();
        replaceRecoveryCodes(user.id, ["first-code-1", "second-code-2"]);

        const used = await confirm((await loginStep()).challenge, "first-code-1");
        assert.equal(used.status, 200);
        assert.equal(UserModel.getById(user.id)?.totp_enabled, 1);

        // Without the authenticator, the next login still asks for a factor.
        const next = await loginStep();
        assert.equal(next.step, "totp");
        const again = await confirm(next.challenge, "first-code-1");
        assert.equal(again.status, 401);
        const other = await confirm(next.challenge, "second-code-2");
        assert.equal(other.status, 200);
    });
});

describe("a second factor being set up", () => {
    it("keeps its secret out of the stored step, at login and in the account", async () => {
        UserModel.create({
            name: "Neu",
            email: EMAIL,
            password: PASSWORD,
            company_id: 1,
            role: "dispatcher",
        });
        db.prepare("UPDATE companies SET totp_required = 1 WHERE id = 1").run();
        const step = await loginStep();
        assert.equal(step.step, "totp_enroll");
        const atLogin = await request(app).post("/api/auth/totp/setup").send({ challenge: step.challenge });
        assert.equal(atLogin.status, 200);

        const payloads = () =>
            (db.prepare("SELECT payload FROM auth_tokens").all() as { payload: string | null }[])
                .map((row) => row.payload ?? "")
                .join("\n");
        assert.doesNotMatch(payloads(), new RegExp(atLogin.body.secret));

        const done = await confirm(step.challenge, totpCode(base32Decode(atLogin.body.secret)));
        assert.equal(done.status, 200);
        db.prepare("UPDATE companies SET totp_required = 0 WHERE id = 1").run();
    });

    it("keeps the secret of a set-up in the account out of the stored step", async () => {
        UserModel.create({ name: "Konto", email: EMAIL, password: PASSWORD, company_id: 1, role: "dispatcher" });
        const agent = request.agent(app);
        await agent.post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200);
        const setup = await agent.post("/api/auth/totp/setup").expect(200);

        const stored = (db.prepare("SELECT payload FROM auth_tokens WHERE purpose = 'totp_setup'").get() as {
            payload: string;
        }).payload;
        assert.doesNotMatch(stored, new RegExp(setup.body.secret));

        await agent
            .post("/api/auth/totp/confirm")
            .send({ setup_token: setup.body.setup_token, code: totpCode(base32Decode(setup.body.secret)) })
            .expect(200);
    });
});
