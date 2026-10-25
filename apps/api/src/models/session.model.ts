import { randomBytes } from "node:crypto";
import type { AuthUser } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { hashToken } from "../lib/tokenHash";
import { presentUser } from "./authView";
import { policyGap, type SessionProof } from "./sessionPolicy";
import { UserModel } from "./user.model";

/**
 * The cookie carries the token; the table keeps only its hash (like every
 * other token of the app), so a copy of the database holds no usable session.
 * The column is still called `token`.
 */
const INSERT_SESSION = `
    INSERT INTO sessions (
        user_id, company_id, token, expires_at, persistent, mfa, sso_company_id
    )
    VALUES (?, ?, ?, datetime('now', ?), ?, ?, ?)
`;

const SELECT_SESSION = `
    SELECT user_id, company_id, persistent, mfa, sso_company_id
    FROM sessions
    WHERE token = ?
      AND expires_at > datetime('now')
`;

/** A session without a "remember me" ends 15 minutes after its last use. */
const IDLE_MINUTES = 15;

/**
 * Pushes the end of an idle session out, at most once a minute: the end only
 * moves when it is already more than a minute behind "now + 15 minutes".
 */
const TOUCH_IDLE = `
    UPDATE sessions
    SET expires_at = datetime('now', '+${IDLE_MINUTES} minutes')
    WHERE token = ?
      AND persistent = 0
      AND expires_at < datetime('now', '+${IDLE_MINUTES - 1} minutes')
`;

const DELETE_BY_TOKEN = `DELETE FROM sessions WHERE token = ?`;
const DELETE_BY_USER = `DELETE FROM sessions WHERE user_id = ?`;
const DELETE_OTHERS = `
    DELETE FROM sessions
    WHERE user_id = ?
      AND token <> ?
`;
const DELETE_EXPIRED = `
    DELETE FROM sessions
    WHERE expires_at <= datetime('now')
`;

const DELETE_OLD_TOKENS = `
    DELETE FROM auth_tokens
    WHERE expires_at <= datetime('now', '-7 days')
`;

/** Expired rows are removed in a sweep, not on every request. */
const PURGE_EVERY_MS = 60_000;
let lastPurge = 0;

type SessionRow = {
    user_id: number;
    company_id: number;
    persistent: number;
    mfa: number;
    sso_company_id: number | null;
};

export type OpenSession = {
    user: AuthUser;
    proof: SessionProof;
};

const NO_PROOF: SessionProof = { mfa: false, ssoCompanyId: null };

export const SessionModel = {
    create(
        userId: number,
        companyId: number,
        persist: boolean,
        proof: SessionProof = NO_PROOF,
    ): string {
        const token = randomBytes(32).toString("hex");
        stmt(INSERT_SESSION).run(
            userId,
            companyId,
            hashToken(token),
            persist ? "+7 days" : `+${IDLE_MINUTES} minutes`,
            persist ? 1 : 0,
            proof.mfa ? 1 : 0,
            proof.ssoCompanyId,
        );

        return token;
    },

    /**
     * The person and proof of a session. An expired session is never found,
     * swept or not; neither is one that the company rules no longer admit
     * (a second factor or the company login that became required, a removed
     * membership): such a row is deleted, the next request goes to the login.
     * `touch` moves the end of an idle session; a stream check does not.
     */
    find(token: string, touch = true): OpenSession | undefined {
        this.purgeExpiredIfDue();
        const hash = hashToken(token);
        const row = stmt(SELECT_SESSION).get(hash) as SessionRow | undefined;

        if (!row) {
            return undefined;
        }

        const proof: SessionProof = {
            mfa: row.mfa === 1,
            ssoCompanyId: row.sso_company_id,
        };

        if (policyGap(row.user_id, row.company_id, proof) !== null) {
            stmt(DELETE_BY_TOKEN).run(hash);
            return undefined;
        }

        if (touch && row.persistent !== 1) {
            stmt(TOUCH_IDLE).run(hash);
        }

        const record = UserModel.getById(row.user_id);
        const user = record ? presentUser(record, row.company_id) : undefined;

        return user ? { user, proof } : undefined;
    },

    findUser(token: string): AuthUser | undefined {
        return this.find(token)?.user;
    },

    /** The session passed a second factor (set up during the session). */
    setMfa(token: string) {
        stmt("UPDATE sessions SET mfa = 1 WHERE token = ?").run(hashToken(token));
    },

    purgeExpired() {
        stmt(DELETE_EXPIRED).run();
        // Single-use tokens stay a week past their end (a used confirmation
        // link still answers "already confirmed"), then they go too.
        stmt(DELETE_OLD_TOKENS).run();
        lastPurge = Date.now();
    },

    purgeExpiredIfDue(now = Date.now()) {
        if (now - lastPurge >= PURGE_EVERY_MS) {
            this.purgeExpired();
        }
    },

    setCompany(token: string, companyId: number) {
        stmt("UPDATE sessions SET company_id = ? WHERE token = ?").run(
            companyId,
            hashToken(token),
        );
    },

    delete(token: string) {
        stmt(DELETE_BY_TOKEN).run(hashToken(token));
    },

    deleteForUser(userId: number) {
        stmt(DELETE_BY_USER).run(userId);
    },

    deleteForUserExcept(userId: number, token: string) {
        stmt(DELETE_OTHERS).run(userId, hashToken(token));
    },

    resetForTests() {
        lastPurge = 0;
    },
};
