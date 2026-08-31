import { randomBytes } from "node:crypto";
import type { AuthUser } from "@fleet-live/shared";
import { stmt } from "../db/statements";

const INSERT_SESSION = `
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (?, ?, datetime('now', ?))
`;

const SELECT_USER_BY_TOKEN = `
    SELECT u.id, u.name, u.email, u.company_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND s.expires_at > datetime('now')
`;

const DELETE_BY_TOKEN = `DELETE FROM sessions WHERE token = ?`;

const DELETE_EXPIRED = `
    DELETE FROM sessions
    WHERE expires_at <= datetime('now')
`;

export const SessionModel = {
    create(userId: number, persist: boolean): string {
        const token = randomBytes(32).toString("hex");
        stmt(INSERT_SESSION).run(
            userId,
            token,
            persist ? "+7 days" : "+12 hours",
        );

        return token;
    },

    findUser(token: string): AuthUser | undefined {
        stmt(DELETE_EXPIRED).run();

        return stmt(SELECT_USER_BY_TOKEN).get(token) as AuthUser | undefined;
    },

    delete(token: string) {
        stmt(DELETE_BY_TOKEN).run(token);
    },
};
