import { stmt } from "../db/statements";
import { hashToken, newToken } from "../lib/tokenHash";

export type TokenPurpose =
    | "verify_email"
    | "reset_password"
    | "invite"
    | "login_challenge"
    | "totp_setup"
    | "sso_state"
    | "sso_link";

export type AuthTokenRow = {
    id: number;
    user_id: number | null;
    purpose: TokenPurpose;
    token_hash: string;
    expires_at: string;
    used_at: string | null;
    company_id: number | null;
    role: string | null;
    payload: string | null;
};

const SELECT_COLUMNS = `
    SELECT id, user_id, purpose, token_hash, expires_at, used_at,
           company_id, role, payload
    FROM auth_tokens
`;

const SELECT_ACTIVE = `
    ${SELECT_COLUMNS}
    WHERE token_hash = ?
      AND purpose = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
`;

const SELECT_USED = `
    ${SELECT_COLUMNS}
    WHERE token_hash = ?
      AND purpose = ?
      AND used_at IS NOT NULL
`;

export const AuthTokenModel = {
    issue(input: {
        userId?: number | null;
        purpose: TokenPurpose;
        ttl: string;
        companyId?: number | null;
        role?: string | null;
        payload?: string | null;
    }): string {
        const token = newToken();

        stmt(
            `
            INSERT INTO auth_tokens (
                user_id, purpose, token_hash, expires_at, company_id, role, payload
            )
            VALUES (?, ?, ?, datetime('now', ?), ?, ?, ?)
            `,
        ).run(
            input.userId ?? null,
            input.purpose,
            hashToken(token),
            input.ttl,
            input.companyId ?? null,
            input.role ?? null,
            input.payload ?? null,
        );

        return token;
    },

    find(token: string, purpose: TokenPurpose): AuthTokenRow | undefined {
        return stmt(SELECT_ACTIVE).get(hashToken(token), purpose) as
            | AuthTokenRow
            | undefined;
    },

    findUsed(token: string, purpose: TokenPurpose): AuthTokenRow | undefined {
        return stmt(SELECT_USED).get(hashToken(token), purpose) as
            | AuthTokenRow
            | undefined;
    },

    /**
     * Uses a single-use token up and returns it, or nothing when it is unknown,
     * expired or was used: of two requests with the same token one wins.
     */
    claim(token: string, purpose: TokenPurpose): AuthTokenRow | undefined {
        const row = this.find(token, purpose);

        if (!row) {
            return undefined;
        }

        const result = stmt(
            "UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL",
        ).run(row.id);

        return Number(result.changes) === 1 ? row : undefined;
    },

    consume(id: number) {
        stmt(
            "UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(id);
    },

    setPayload(id: number, payload: string) {
        stmt("UPDATE auth_tokens SET payload = ? WHERE id = ?").run(
            payload,
            id,
        );
    },

    deleteForUser(userId: number, purpose: TokenPurpose) {
        stmt(
            "DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?",
        ).run(userId, purpose);
    },

    /** Invitation links of one company for one person. */
    deleteInvites(userId: number, companyId: number) {
        stmt(
            "DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'invite' AND company_id = ?",
        ).run(userId, companyId);
    },
};
