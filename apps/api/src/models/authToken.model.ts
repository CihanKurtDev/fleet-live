import { stmt } from "../db/statements";
import { hashToken, newToken } from "../lib/tokenHash";

export type TokenPurpose =
    | "verify_email"
    | "reset_password"
    | "invite"
    | "login_challenge"
    | "totp_setup"
    | "sso_state";

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

const SELECT_ACTIVE = `
    SELECT id, user_id, purpose, token_hash, expires_at, used_at,
           company_id, role, payload
    FROM auth_tokens
    WHERE token_hash = ?
      AND purpose = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
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
};
