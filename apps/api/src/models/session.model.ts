import { randomBytes } from "node:crypto";
import type { AuthUser } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { presentUser } from "./authView";
import { UserModel } from "./user.model";

const INSERT_SESSION = `
    INSERT INTO sessions (user_id, company_id, token, expires_at, persistent)
    VALUES (?, ?, ?, datetime('now', ?), ?)
`;

const SELECT_SESSION = `
    SELECT user_id, company_id, persistent
    FROM sessions
    WHERE token = ?
      AND expires_at > datetime('now')
`;

const TOUCH_IDLE = `
    UPDATE sessions
    SET expires_at = datetime('now', '+15 minutes')
    WHERE token = ?
      AND persistent = 0
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

export const SessionModel = {
    create(userId: number, companyId: number, persist: boolean): string {
        const token = randomBytes(32).toString("hex");
        stmt(INSERT_SESSION).run(
            userId,
            companyId,
            token,
            persist ? "+7 days" : "+15 minutes",
            persist ? 1 : 0,
        );

        return token;
    },

    findUser(token: string): AuthUser | undefined {
        stmt(DELETE_EXPIRED).run();
        const row = stmt(SELECT_SESSION).get(token) as
            | { user_id: number; company_id: number; persistent: number }
            | undefined;

        if (!row) {
            return undefined;
        }

        if (row.persistent !== 1) {
            stmt(TOUCH_IDLE).run(token);
        }

        const user = UserModel.getById(row.user_id);

        if (!user) {
            return undefined;
        }

        return presentUser(user, row.company_id);
    },

    setCompany(token: string, companyId: number) {
        stmt("UPDATE sessions SET company_id = ? WHERE token = ?").run(
            companyId,
            token,
        );
    },

    delete(token: string) {
        stmt(DELETE_BY_TOKEN).run(token);
    },

    deleteForUser(userId: number) {
        stmt(DELETE_BY_USER).run(userId);
    },

    deleteForUserExcept(userId: number, token: string) {
        stmt(DELETE_OTHERS).run(userId, token);
    },
};
